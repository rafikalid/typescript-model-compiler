import ts from "typescript";
import { FormatResponse, formattedInputField, FormattedInputNode, FormattedInputObject, formattedOutputField, FormattedOutputNode, FormattedOutputObject } from "./formatted-model";
import {
	Field,
	FieldType,
	InputField,
	List,
	Kind,
	Node,
	ObjectLiteral,
	OutputField,
	Param,
	PlainObject,
	Reference,
	InputPlainObject,
	OutputPlainObject
} from './model';

/** Format parsed results to generate usable model */
export function format(
	root: Map<string, Node | ObjectLiteral>
): FormatResponse {
	const result: FormatResponse = {
		input: new Map(),
		output: new Map()
	};
	const inputMap = result.input;
	const outputMap = result.output;
	const resolvedGenerics: Map<string, PlainObject> = new Map();
	//* Go through nodes
	const rootQueue = Array.from(root.entries());
	for (let qi = 0; qi < rootQueue.length; ++qi) {
		let [nodeName, node] = rootQueue[qi];
		switch (node.kind) {
			case Kind.BASIC_SCALAR:
			case Kind.SCALAR:
			case Kind.ENUM:
				inputMap.set(nodeName, node);
				outputMap.set(nodeName, node);
				break;
			case Kind.UNION:
				inputMap.set(nodeName, node);
				outputMap.set(nodeName, node);
				// Resolve types
				for (
					let i = 0, types = node.types, len = types.length;
					i < len; ++i
				) {
					let ref = types[i];
					// fix reference
					if (!root.has(ref.name)) ref.name = ref.oName;
					// Resolve generics
					ref = _resolveReference(
						ref,
						undefined,
						nodeName,
						undefined
					);
					types[i] = ref;
				}
				break;
			case Kind.PLAIN_OBJECT:
			case Kind.OBJECT_LITERAL: {
				// Ignore generic objects
				if (node.generics != null) break;
				//* Inherited classes (used for sorting fields)
				let inherited = node.inherit?.map(c => c.name);
				//* Input object
				let inputNode = node.input;
				if (inputNode.visibleFields.size) {
					let formattedNode: FormattedInputObject = {
						kind: Kind.FORMATTED_INPUT_OBJECT,
						name: node.name,
						escapedName: node.escapedName,
						after: inputNode.after,
						before: inputNode.after,
						deprecated: inputNode.deprecated,
						jsDoc: compileJsDoc(inputNode.jsDoc),
						fields: _formatFields(node, inherited, true)
					}
					inputMap.set(nodeName, formattedNode);
				}
				//* Output Object
				let outputNode = node.output;
				if (outputNode.visibleFields.size) {
					let formattedNode: FormattedOutputObject = {
						kind: Kind.FORMATTED_OUTPUT_OBJECT,
						name: node.name,
						escapedName: node.escapedName,
						after: outputNode.after,
						before: outputNode.after,
						deprecated: outputNode.deprecated,
						jsDoc: compileJsDoc(outputNode.jsDoc),
						fields: _formatFields(node, inherited, false)
					}
					outputMap.set(nodeName, formattedNode);
				}
				break;
			}
			default:
				let neverV: never = node;
				throw new Error(`Unknown kind`);
		}
	}
	//* Return
	return result;

	/** Resolve generic type */
	function _resolveReference(
		ref: Reference,
		field: InputField | OutputField | undefined,
		className: string,
		inheritedFrom: string | undefined
	): Reference {
		var refNode = root.get(ref.name);
		//* Case normal reference
		if (refNode != null && ref.params == null) return ref;
		//* Case Generic or Logical entity
		var escapedName = _getGenericEscapedName(ref);
		var gEntity = resolvedGenerics.get(escapedName);
		if (gEntity == null) {
			// Check has not entity with same name as this one escaped name
			if (root.has(escapedName))
				throw new Error(
					`Found entity "${escapedName}" witch equals to the escaped name of generic: ${_getGenericName(
						ref
					)} at ${ref.fileName}`
				);
			// logical entity (like "Omit" & "Partial")
			if (refNode == null)
				gEntity = _getLogicEntity(
					ref,
					escapedName,
					field,
					className,
					inheritedFrom
				);
			else if (refNode.kind !== Kind.PLAIN_OBJECT)
				throw new Error(
					`Expected PlainObject as reference of generic "${_getGenericName(
						ref
					)}". Got "${Kind[refNode.kind]}" at "${inheritedFrom ?? className
					}.${field?.name}" at ${ref.fileName}`
				);
			else {
				let name = _getGenericName(ref);
				let refNodeInput = refNode.input;
				let refNodeOutput = refNode.output;
				gEntity = {
					kind: Kind.PLAIN_OBJECT,
					name: name,
					escapedName: escapedName,
					fileNames: refNode.fileNames,
					inherit: refNode.inherit,
					generics: undefined,
					input: {
						after: refNodeInput.after,
						before: refNodeInput.before,
						deprecated: refNodeInput.deprecated,
						fields: _resolveGenericFields(refNode, refNodeInput, ref),
						jsDoc: refNodeInput.jsDoc.concat(`@Generic ${name}`),
						ownedFields: refNodeInput.ownedFields,
						visibleFields: refNodeInput.visibleFields
					},
					output: {
						after: refNodeOutput.after,
						before: refNodeOutput.before,
						deprecated: refNodeOutput.deprecated,
						fields: _resolveGenericFields(refNode, refNodeOutput, ref),
						jsDoc: refNodeOutput.jsDoc.concat(`@Generic ${name}`),
						ownedFields: refNodeOutput.ownedFields,
						visibleFields: refNodeOutput.visibleFields
					}
				};
			}
			// Push to generics
			resolvedGenerics.set(escapedName, gEntity);
			rootQueue.push([escapedName, gEntity]);
		}
		return {
			kind: Kind.REF,
			fileName: ref.fileName,
			name: escapedName,
			oName: escapedName,
			fullName: undefined,
			params: undefined,
			visibleFields: undefined
		};
	}
	/** Resolve generic types */
	function _resolveType<T extends FieldType | Param | undefined>(
		type: T,
		field: InputField | OutputField,
		className: string,
		inheritedFrom: string | undefined
	): T {
		if (type == null) return type;
		// Check if field has generic type
		var p: FieldType | Param = type;
		var q: (FieldType | Param)[] = [];
		while (p.kind !== Kind.REF) {
			q.push(p);
			p = p.type!;
			if (p == null) return type;
		}
		// fix reference
		if (root.has(p.name) === false) p.name = p.oName;
		// Generics
		var resolvedRef: FieldType | Param = _resolveReference(
			p,
			field,
			className,
			inheritedFrom
		);
		if (resolvedRef === p) return type;
		if (q.length !== 0) {
			q.reverse();
			for (let i = 0, len = q.length; i < len; ++i) {
				resolvedRef = { ...q[i], type: resolvedRef } as List | Param;
			}
		}
		return resolvedRef as T;
	}

	/** Generate logic entities: like Partials & Omit */
	function _getLogicEntity(
		ref: Reference,
		escapedName: string,
		field: InputField | OutputField | undefined,
		className: string,
		inheritedFrom: string | undefined
	): PlainObject {
		// Check reference node
		if (ref.visibleFields == null)
			throw new Error(
				`Unexpected Logical Reference expression at "${inheritedFrom ?? className
				}.${field?.name}" at ${ref.fileName}`
			);
		// Prepare entity
		var name = _getGenericName(ref);
		// var partialNode = (root.get(ref.name) ?? { jsDoc: [], input: {}, output: {} }) as PlainObject;
		var partialNode = root.get(ref.name) as PlainObject | undefined;
		if (partialNode == null)
			throw new Error(`Missing entity "${ref.name}" for Logical Reference expression at "${inheritedFrom ?? className
				}.${field?.name}" at ${ref.fileName}`);

		const partialInput = partialNode.input;
		const partialOutput = partialNode.output;
		const entity: PlainObject = {
			kind: Kind.PLAIN_OBJECT,
			name: name,
			escapedName: escapedName,
			generics: undefined,
			inherit: partialNode?.inherit,
			input: {
				...partialInput,
				fields: new Map()
			},
			output: {
				...partialOutput,
				fields: new Map()
			},
			fileNames: partialNode.fileNames
		};
		// Return entity
		return entity;
	}

	/** Format Plain object fields */
	function _formatFields<T extends boolean>(
		node: PlainObject | ObjectLiteral,
		inherited: string[] | undefined,
		isInput: T
	) {
		type TField = T extends true ? formattedInputField : formattedOutputField;
		const resolvedFields: TField[] = [];
		const inputOutputNode = isInput ? node.input : node.output;
		inputOutputNode.visibleFields.forEach(function (v, fieldName) {
			var field = inputOutputNode.fields.get(fieldName);
			let jsDoc: string[];
			if (field == null) {
				let obj = root.get(v.className);
				if (obj == null)
					throw new Error(
						`Missing entity "${v.className}" inherited to "${node.name}.${fieldName}" at ${node.fileNames.join(", ")}`
					);
				if (obj.kind != Kind.PLAIN_OBJECT)
					throw new Error(`Could not inherit "${Kind[obj.kind]}". at "${node.name}.${fieldName}" at ${node.fileNames.join(", ")}`);

				field = (isInput ? obj.input : obj.output).fields.get(fieldName);
				if (field == null) {
					// warn(
					// 	`FORMAT>> Ignored field "${inheritedFrom}" super of "${node.name}.${fieldName}" at ${obj.fileName}`
					// );
					return;
				}
				jsDoc = field.jsDoc.concat(`@inherit-from ${field.className}`);
			} else {
				jsDoc = field.jsDoc;
			}
			// Field
			const result = {
				...field,
				jsDoc: compileJsDoc(jsDoc),
				required: !(v.flags & ts.SymbolFlags.Optional),
				type: _resolveType(field.type, field, node.name, field.className)
			} as TField;
			if (!isInput) (result as formattedOutputField).param = _resolveType((field as OutputField).param, field, node.name, field.className);
			// Flags
			resolvedFields.push(result);
		});
		//* Sort fields
		resolvedFields.sort(function (a, b) {
			if (a.className === b.className) return a.idx - b.idx;
			else if (a.className == null) return -1;
			else if (b.className == null) return 1;
			else if (inherited == null) return 0;
			else
				return (
					inherited.indexOf(b.className) -
					inherited.indexOf(a.className)
				);
		});
		return resolvedFields;
	}
}


/** Sort jsDoc */
const sortJsDocKeywords = [
	'Generic',
	'Partial',
	'implements',
	'extends',
	'inherit-from'
];
function compileJsDoc(arr: string[]): string | undefined {
	var arr2 = [];
	for (let i = 0, len = arr.length; i < len; ++i) {
		let t = arr[i]?.trim();
		if (t && arr2.indexOf(t) === -1) arr2.push(t);
	}
	if (arr2.length === 0) return undefined
	else return arr2.sort((a, b) => {
		if (a.startsWith('@')) {
			if (b.startsWith('@')) {
				let i = a.indexOf(' ');
				let at = i === -1 ? a : a.substr(0, i);
				i = b.indexOf(' ');
				let bt = i === -1 ? b : b.substr(0, i);
				return (
					sortJsDocKeywords.indexOf(at) -
					sortJsDocKeywords.indexOf(bt)
				);
			} else return 1;
		} else return -1;
	}).join("\n");
}

// Get generic escaped name
function _getGenericEscapedName(ref: Reference): string {
	return (
		ref.fullName
			?.replace(/[>\]]/g, '')
			.replace(/[<\],|]/g, '_')
			.replace(/\W/g, '') ?? _getGenericEscapedNameE(ref)
	);
}
function _getGenericEscapedNameE(ref: FieldType): string {
	switch (ref.kind) {
		case Kind.REF:
			if (ref.params == null) return ref.name;
			else
				return `${ref.name}_${ref.params
					.map(_getGenericEscapedNameE)
					.join('_')}`;
		case Kind.LIST:
			return '_' + _getGenericEscapedNameE(ref.type);
		default:
			let t: never = ref;
			throw new Error('Unsupported kind');
	}
}
// Get generic name
function _getGenericName(ref: Reference): string {
	return ref.fullName ?? _getGenericNameE(ref);
}
function _getGenericNameE(ref: FieldType): string {
	switch (ref.kind) {
		case Kind.REF:
			if (ref.params == null) return ref.name;
			else
				return `${ref.name}<${ref.params
					.map(_getGenericNameE)
					.join(', ')}>`;
		case Kind.LIST:
			return _getGenericNameE(ref.type) + '[]';
		default:
			let t: never = ref;
			throw new Error('Unsupported kind');
	}
}

function _resolveGenericFields<T extends InputPlainObject | OutputPlainObject>(
	refNode: PlainObject,
	refInputOutput: T,
	ref: Reference
): Map<string, T extends InputPlainObject ? InputField : OutputField> {
	type TField = T extends InputPlainObject ? InputField : OutputField;
	type TReturn = Map<string, TField>;
	const generics = refNode.generics;
	if (generics == null)
		return refInputOutput.fields as TReturn;
	var fields: TReturn = new Map();
	var params = ref.params!;
	if (generics.length !== params.length)
		throw new Error(`Unexpected params length on ${refNode.name} and ${ref.name} at ${ref.fileName}`);
	// Map param
	refInputOutput.fields.forEach(function (field, fieldName) {
		var f: InputField | OutputField = {
			...field,
			type: _resolve(field.type)
		};
		if (f.kind === Kind.OUTPUT_FIELD && f.param != null) {
			f.param = _resolve(f.param);
		}
		fields.set(fieldName, f as TField);
	});
	return fields;

	/** Resolve type */
	function _resolve<T extends FieldType | Param | undefined>(type: T): T {
		if (type == null) return type;
		let r: T;
		switch (type!.kind) {
			case Kind.LIST:
			case Kind.PARAM:
				r = { ...type, type: _resolve(type.type) };
				break;
			case Kind.REF:
				let i = generics!.indexOf(type.name);
				if (i === -1) r = type;
				else r = params[i] as T;
				break;
			default:
				let nver: never = type;
				throw new Error('Fail');
		}
		return r;
	}
}

