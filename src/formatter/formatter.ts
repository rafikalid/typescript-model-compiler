import {
	FormattedInputNode,
	FormattedInputObject,
	FormattedOutputNode,
	FormattedOutputObject
} from './formatter-model';
import {
	Field,
	FieldType,
	InputField,
	List,
	ModelKind,
	Node,
	OutputField,
	Param,
	PlainObject,
	Reference
} from 'tt-model';
import ts from 'typescript';
import { warn } from '@src/utils/log';

/** Format parsed results to generate usable model */
export function format(root: Map<string, Node>): FormatResponse {
	const result: FormatResponse = {
		input: new Map(),
		output: new Map()
	};
	const inputMap = result.input;
	const outputMap = result.output;
	/** Resolved generics */
	const resolvedGenerics: Map<string, PlainObject> = new Map();
	//* Go through nodes
	var rootQueue = Array.from(root.entries());
	var rootQueueIdx = 0;
	while (rootQueueIdx < rootQueue.length) {
		let [nodeName, node] = rootQueue[rootQueueIdx++];
		switch (node.kind) {
			case ModelKind.BASIC_SCALAR:
			case ModelKind.SCALAR:
			case ModelKind.ENUM:
				inputMap.set(nodeName, node);
				outputMap.set(nodeName, node);
				break;
			case ModelKind.UNION:
				inputMap.set(nodeName, node);
				outputMap.set(nodeName, node);
				// Resolve types
				for (
					let i = 0, types = node.types, len = types.length;
					i < len;
					++i
				) {
					let ref = types[i];
					if (ref.params != null) {
						ref = _resolveGeneric(
							ref,
							undefined,
							nodeName,
							undefined
						);
						types[i] = ref;
					}
				}
				break;
			case ModelKind.PLAIN_OBJECT:
				// Ignore generic objects
				if (node.generics != null) break;
				//* Resolve fields
				let inputFields: FormattedInputObject['fields'] = [];
				let outputFields: FormattedOutputObject['fields'] = [];
				//* Inherited classes (used for sorting fields)
				let inherited: string[] | undefined;
				if (node.inherit != null) {
					inherited = [];
					for (
						let i = 0, cl = node.inherit, len = cl.length;
						i < len;
						++i
					) {
						inherited.push(cl[i].name);
					}
				}
				//* Resolve fields
				let resolvedFields: ResolvedFieldInterface[] = [];
				node.visibleFields.forEach(function (v, fieldName) {
					var f = (node as PlainObject).fields.get(fieldName);
					var inheritedFrom: string | undefined;
					if (f == null) {
						let obj = root.get(v.className) as PlainObject;
						if (obj == null)
							throw new Error(
								`Missing entity "${
									v.className
								}" inherited to "${
									node.name
								}.${fieldName}" at ${
									(node as PlainObject).fileName
								}`
							);
						f = obj.fields.get(fieldName);
						inheritedFrom = `${obj.name}.${fieldName}`;
						if (f == null) {
							warn(
								`FORMAT>> Ignored field "${inheritedFrom}" super of "${node.name}.${fieldName}" at ${obj.fileName}`
							);
							return;
						}
					}
					// Flags
					var isRequired = !(v.flags & ts.SymbolFlags.Optional);
					resolvedFields.push({
						field: f,
						required: isRequired,
						inheritedFrom: inheritedFrom,
						index: f.idx,
						className: f.className!
					});
				});
				//* Sort fields
				resolvedFields.sort(function (a, b) {
					if (a.className === b.className) return a.index - b.index;
					else if (a.className === null) return -1;
					else if (b.className === null) return 1;
					else if (inherited == null) return 0;
					else
						return (
							inherited.indexOf(b.className) -
							inherited.indexOf(a.className)
						);
				});
				//* Load fields
				for (let i = 0, len = resolvedFields.length; i < len; ++i) {
					let {
						field: f,
						inheritedFrom,
						className,
						required: isRequired
					} = resolvedFields[i];
					// Input field
					if (f.input != null) {
						let fin = f.input;
						inputFields.push({
							kind: fin.kind,
							alias: f.alias,
							name: fin.name,
							deprecated: fin.deprecated,
							defaultValue: fin.defaultValue,
							jsDoc:
								inheritedFrom == null
									? fin.jsDoc
									: _sortJsDoc(
											fin.jsDoc.concat(
												`@inherit-from ${inheritedFrom}`
											)
									  ),
							required: isRequired,
							type: _resolveType(
								fin.type,
								fin,
								className,
								inheritedFrom
							),
							asserts: fin.asserts,
							validate: fin.validate
						});
					}
					if (f.output != null) {
						let fout = f.output;
						outputFields.push({
							kind: fout.kind,
							name: fout.name,
							alias: fout.alias,
							deprecated: fout.deprecated,
							jsDoc:
								inheritedFrom == null
									? fout.jsDoc
									: _sortJsDoc(
											fout.jsDoc.concat(
												`@inherit-from ${inheritedFrom}`
											)
									  ),
							method: fout.method,
							param:
								fout.param == null
									? undefined
									: _resolveType(
											fout.param,
											fout,
											className,
											inheritedFrom
									  ),
							required: isRequired,
							type: _resolveType(
								fout.type,
								fout,
								className,
								inheritedFrom
							)
						});
					}
				}
				//* Entities
				let nodeJsDoc = _sortJsDoc(node.jsDoc);
				if (inputFields.length !== 0) {
					// Create object
					let formattedInputObj: FormattedInputObject = {
						kind: ModelKind.FORMATTED_INPUT_OBJECT,
						name: node.name,
						escapedName: node.escapedName,
						deprecated: node.deprecated,
						jsDoc: nodeJsDoc,
						fields: inputFields
					};
					inputMap.set(nodeName, formattedInputObj);
				}
				if (outputFields.length !== 0) {
					let formattedOutputObj: FormattedOutputObject = {
						kind: ModelKind.FORMATTED_OUTPUT_OBJECT,
						name: node.name,
						escapedName: node.escapedName,
						deprecated: node.deprecated,
						jsDoc: nodeJsDoc,
						fields: outputFields
					};
					outputMap.set(nodeName, formattedOutputObj);
				}
				break;
			case ModelKind.OBJECT_LITERAL:
				{
					// TODO Implement object literals
					throw new Error('Object literal are not supported yet.');
					// //* Resolve fields
					// let inputFields: FormattedInputObject['fields'] = [];
					// let outputFields: FormattedOutputObject['fields'] = [];
					// //* Load fields
					// node.fields.forEach(function (field, fieldName) {
					// 	// Input field
					// 	if (field.input != null) {
					// 		let fin = field.input;
					// 		inputFields.push({
					// 			kind: fin.kind,
					// 			alias: fin.alias,
					// 			name: fin.name,
					// 			deprecated: fin.deprecated,
					// 			defaultValue: fin.defaultValue,
					// 			jsDoc: fin.jsDoc,
					// 			required: fin.required,
					// 			type: _resolveType(
					// 				fin.type,
					// 				fin,
					// 				field.className!,
					// 				undefined
					// 			),
					// 			asserts: fin.asserts,
					// 			validate: fin.validate,
					// 		});
					// 	}
					// 	if (field.output != null) {
					// 		let fout = field.output;
					// 		outputFields.push({
					// 			kind: fout.kind,
					// 			name: fout.name,
					// 			alias: fout.alias,
					// 			deprecated: fout.deprecated,
					// 			jsDoc: fout.jsDoc,
					// 			method: fout.method,
					// 			param:
					// 				fout.param == null
					// 					? undefined
					// 					: _resolveType(
					// 							fout.param,
					// 							fout,
					// 							field.className!,
					// 							undefined
					// 					  ),
					// 			required: fout.required,
					// 			type: _resolveType(
					// 				fout.type,
					// 				fout,
					// 				field.className!,
					// 				undefined
					// 			),
					// 		});
					// 	}
					// });
					// //* Entities
					// let nodeJsDoc = _sortJsDoc(node.jsDoc);
					// if (inputFields.length !== 0) {
					// 	// Create object
					// 	let formattedInputObj: FormattedInputObject = {
					// 		kind: ModelKind.FORMATTED_INPUT_OBJECT,
					// 		name: undefined,
					// 		escapedName: undefined,
					// 		deprecated: node.deprecated,
					// 		jsDoc: nodeJsDoc,
					// 		fields: inputFields,
					// 	};
					// 	inputMap.set(nodeName, formattedInputObj);
					// }
					// if (outputFields.length !== 0) {
					// 	let formattedOutputObj: FormattedOutputObject = {
					// 		kind: ModelKind.FORMATTED_OUTPUT_OBJECT,
					// 		name: undefined,
					// 		escapedName: undefined,
					// 		deprecated: node.deprecated,
					// 		jsDoc: nodeJsDoc,
					// 		fields: outputFields,
					// 	};
					// 	outputMap.set(nodeName, formattedOutputObj);
					// }
				}
				break;
			default:
				let neverV: never = node;
				// @ts-ignore
				throw new Error(`Unknown kind: ${ModelKind[neverV.kind]}`);
		}
	}
	return result;

	/** Resolve generic types */
	function _resolveType<T extends FieldType | Param>(
		type: T,
		field: InputField | OutputField,
		className: string,
		inheritedFrom: string | undefined
	): T {
		// Check if field has generic type
		var p: FieldType | Param = type;
		while (p.kind !== ModelKind.REF) {
			p = p.type!;
			if (p == null) return type;
		}
		if (p.params == null) return type;
		// Resolve generic reference
		var q: (FieldType | Param)[] = [];
		p = type;
		while (p.kind !== ModelKind.REF) {
			q.push(p);
			p = p.type!;
		}
		var resolvedRef: FieldType | Param = _resolveGeneric(
			p,
			field,
			className,
			inheritedFrom
		);
		if (q.length !== 0) {
			q.reverse();
			for (let i = 0, len = q.length; i < len; ++i) {
				resolvedRef = { ...q[i], type: resolvedRef } as List | Param;
			}
		}
		return resolvedRef as T;
	}
	/** Resolve generic type */
	function _resolveGeneric(
		ref: Reference,
		field: InputField | OutputField | undefined,
		className: string,
		inheritedFrom: string | undefined
	): Reference {
		var refNode = root.get(ref.name);
		if (refNode == null) {
			if (ref.name === 'Partial')
				return _getPartial(ref, field, className, inheritedFrom);
			else
				throw new Error(
					`Missing generic entity "${ref.name}" referenced by "${
						inheritedFrom ?? className
					}.${field?.name}" at ${ref.fileName}`
				);
		}
		if (refNode.kind !== ModelKind.PLAIN_OBJECT)
			throw new Error(
				`Expected PlainObject as reference of generic "${_getGenericName(
					ref
				)}". Got "${ModelKind[refNode.kind]}" at "${
					inheritedFrom ?? className
				}.${field?.name}" at ${ref.fileName}`
			);
		var escapedName = _getGenericEscapedName(ref);
		if (root.has(escapedName))
			throw new Error(
				`Found entity "${escapedName}" witch equals to the escaped name of generic: ${_getGenericName(
					ref
				)} at ${ref.fileName}`
			);
		var gEntity = resolvedGenerics.get(escapedName);
		if (gEntity == null) {
			let name = _getGenericName(ref);
			gEntity = {
				kind: ModelKind.PLAIN_OBJECT,
				name: name,
				escapedName: escapedName,
				deprecated: refNode.deprecated,
				jsDoc: _sortJsDoc(refNode.jsDoc.concat(`@Generic ${name}`)),
				fields: _resolveGenericFields(refNode, ref),
				fileName: refNode.fileName,
				generics: undefined,
				inherit: refNode.inherit,
				ownedFields: refNode.ownedFields,
				visibleFields: refNode.visibleFields
			};
			resolvedGenerics.set(escapedName, gEntity);
			rootQueue.push([escapedName, gEntity]);
		}
		return {
			kind: ModelKind.REF,
			fileName: ref.fileName,
			name: escapedName,
			params: undefined,
			visibleFields: undefined
		};
	}

	/** Generate partial node */
	function _getPartial(
		ref: Reference,
		field: InputField | OutputField | undefined,
		className: string,
		inheritedFrom: string | undefined
	): Reference {
		var c: FieldType;
		if (
			ref.params == null ||
			ref.params.length !== 1 ||
			(c = ref.params[0]).kind !== ModelKind.REF ||
			c.params != null
		)
			throw new Error(
				`Unexpected Partial expression at "${
					inheritedFrom ?? className
				}.${field?.name}" at ${ref.fileName}`
			);
		let partialNode = root.get(c.name);
		if (partialNode == null)
			throw new Error(
				`Missing entity "${c.name}" at "${inheritedFrom ?? className}.${
					field?.name
				}" at ${ref.fileName}`
			);
		if (partialNode.kind !== ModelKind.PLAIN_OBJECT)
			throw new Error(
				`Expected PlainObject as reference of generic "${
					inheritedFrom ?? className
				}.${field?.name}". Got "${ModelKind[partialNode.kind]}" at ${
					ref.fileName
				}`
			);
		// Check escaped name
		var escapedName = _getGenericEscapedName(ref);
		if (root.has(escapedName))
			throw new Error(
				`Found entity "${escapedName}" witch equals to the escaped name of generic: ${_getGenericName(
					ref
				)} at ${ref.fileName}`
			);
		// Visible fields
		var visibleFields = new Map();
		partialNode.visibleFields.forEach(function (f, fname) {
			visibleFields.set(fname, {
				flags: ts.SymbolFlags.Optional,
				className: f.className
			});
		});
		// result
		var name = _getGenericName(ref);
		var gEntity: PlainObject = {
			kind: ModelKind.PLAIN_OBJECT,
			name: name,
			escapedName: escapedName,
			deprecated: partialNode.deprecated,
			jsDoc: _sortJsDoc(partialNode.jsDoc.concat(`@Partial ${name}`)),
			fields: partialNode.fields,
			fileName: partialNode.fileName,
			generics: undefined,
			inherit: partialNode.inherit,
			ownedFields: partialNode.ownedFields,
			visibleFields: visibleFields
		};
		rootQueue.push([escapedName, gEntity]);
		// return reference
		return {
			kind: ModelKind.REF,
			fileName: ref.fileName,
			name: escapedName,
			params: undefined,
			visibleFields: undefined
		};
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
function _sortJsDoc(arr: string[]) {
	var arr2 = [];
	for (let i = 0, len = arr.length; i < len; ++i) {
		let t = arr[i]?.trim();
		if (t && arr2.indexOf(t) === -1) arr2.push(t);
	}
	return arr2.sort((a, b) => {
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
	});
}

/** Format response */
export interface FormatResponse {
	input: Map<string, FormattedInputNode>;
	output: Map<string, FormattedOutputNode>;
}

/** Resolved fields */
interface ResolvedFieldInterface {
	field: Field;
	required: boolean;
	inheritedFrom: string | undefined;
	index: number;
	className: string;
}

// Get generic escaped name
function _getGenericEscapedName(ref: FieldType): string {
	switch (ref.kind) {
		case ModelKind.REF:
			if (ref.params == null) return ref.name;
			else
				return `${ref.name}_${ref.params
					.map(_getGenericEscapedName)
					.join('_')}`;
		case ModelKind.LIST:
			return '_' + _getGenericEscapedName(ref.type);
		default:
			let t: never = ref;
			throw new Error('Unsupported kind');
	}
}
// Get generic name
function _getGenericName(ref: FieldType): string {
	switch (ref.kind) {
		case ModelKind.REF:
			if (ref.params == null) return ref.name;
			else
				return `${ref.name}<${ref.params
					.map(_getGenericName)
					.join(', ')}>`;
		case ModelKind.LIST:
			return _getGenericName(ref.type) + '[]';
		default:
			let t: never = ref;
			throw new Error('Unsupported kind');
	}
}

function _resolveGenericFields(
	refNode: PlainObject,
	ref: Reference
): Map<string, Field> {
	var generics = refNode.generics;
	if (generics == null) return refNode.fields;
	var fields: Map<string, Field> = new Map();
	var params = ref.params!;
	if (generics.length !== params.length)
		throw new Error(
			`Unexpected params length on ${refNode.name} and ${ref.name} at ${ref.fileName}`
		);
	// Map param
	refNode.fields.forEach(function (field, fieldName) {
		var f: Field = {
			alias: field.alias,
			input: field.input && _resolve(field.input),
			output: field.output && _resolve(field.output),
			className: field.className,
			idx: field.idx
		};
		fields.set(fieldName, f);
	});
	return fields;
	/** Resolve */
	function _resolve<
		T extends InputField | OutputField | FieldType | Param | undefined
	>(f: T): T {
		var r: T;
		if (f == null) return f;
		switch (f.kind) {
			case ModelKind.INPUT_FIELD:
			case ModelKind.LIST:
			case ModelKind.PARAM:
				r = { ...f, type: _resolve(f.type) };
				break;
			case ModelKind.OUTPUT_FIELD:
				r = { ...f, type: _resolve(f.type), param: _resolve(f.param) };
				break;
			case ModelKind.REF:
				let i = generics!.indexOf(f.name);
				if (i === -1) r = f;
				else r = params[i] as T;
				break;
			default:
				//@ts-ignore
				throw new Error(`Unexpected kind: ${ModelKind[f.kind]}`);
		}
		return r;
	}
}
