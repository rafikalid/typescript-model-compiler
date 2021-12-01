import { FormattedEnum, FormattedEnumMember, formattedInputField, FormattedInputNode, FormattedNode, formattedOutputField, FormattedOutputNode } from './formatted-model';
import { parse } from './parser';
import { InputNode, OutputNode, InputObject, OutputObject, InputField } from './model';
import {
	Kind,
	OutputField
} from './model';

/** Format parsed results to generate usable model */
export function format(
	root: ReturnType<typeof parse>
) {
	return {
		input: _resolveEntities(root.input, root.inputHelperEntities),
		output: _resolveEntities(root.output, root.outputHelperEntities),
		rootConfig: root.rootConfig
	};
}

/** Resolve entities */
function _resolveEntities(map: Map<string, InputNode>, helperEntities: Map<string, InputObject>): Map<string, FormattedInputNode>;
function _resolveEntities(map: Map<string, OutputNode>, helperEntities: Map<string, OutputObject>): Map<string, FormattedOutputNode>;
function _resolveEntities(map: Map<string, InputNode | OutputNode>, helperEntities: Map<string, InputObject | OutputObject>) {
	const result: Map<string, FormattedInputNode | FormattedOutputNode> = new Map();
	map.forEach((node, nodeName) => {
		switch (node.kind) {
			case Kind.BASIC_SCALAR:
			case Kind.SCALAR:
				(node as any as FormattedNode).jsDoc = _compileJsDoc(node.jsDoc);
				result.set(nodeName, node as any as FormattedInputNode);
				break;
			case Kind.UNION: {
				(node as any as FormattedNode).jsDoc = _compileJsDoc(node.jsDoc);
				result.set(nodeName, node as any as FormattedInputNode);
				// Check types found
				let missingTypes = node.types.filter(t => !result.has(t.name));
				if (missingTypes.length > 0)
					throw `Missing types [${missingTypes.map(t => t.name).join(', ')}] on union "${node.name}" at ${node.fileNames.join(', ')}`;
				break;
			}
			case Kind.INPUT_OBJECT: {
				let entity: FormattedInputNode = {
					kind: Kind.FORMATTED_INPUT_OBJECT,
					name: node.name,
					escapedName: node.escapedName!,
					fields: _formatInputFields(node.fields),
					wrappers: node.wrappers,
					before: node.before,
					after: node.after,
					jsDoc: _compileJsDoc(node.jsDoc),
					deprecated: node.deprecated
				}
				result.set(nodeName, entity);
				break;
			}
			case Kind.OUTPUT_OBJECT: {
				let entity: FormattedOutputNode = {
					kind: Kind.FORMATTED_OUTPUT_OBJECT,
					name: node.name,
					escapedName: node.escapedName!,
					fields: _formatOutputFields(node.fields as Map<string, OutputField>),
					wrappers: node.wrappers,
					before: node.before,
					after: node.after,
					jsDoc: _compileJsDoc(node.jsDoc),
					deprecated: node.deprecated
				}
				result.set(nodeName, entity);
				break;
			}
			case Kind.ENUM: {
				(node as any as FormattedEnum).jsDoc = _compileJsDoc(node.jsDoc);
				result.set(nodeName, node as any as FormattedEnum);
				for (let i = 0, members = node.members, len = members.length; i < len; ++i) {
					let member = members[i];
					(member as any as FormattedEnumMember).jsDoc = _compileJsDoc(member.jsDoc);
				}
				break;
			}
			default:
				let neverV: never = node;
				throw new Error(`Unknown kind:` + neverV);
		}
	});
	return result;

	/** Format input fields */
	function _formatInputFields(fields: Map<string, InputField>): formattedInputField[] {
		const result: formattedInputField[] = [];
		fields.forEach(function (field) {
			// Look for implementation
			const fieldImp = field.className ? helperEntities.get(field.className)?.fields.get(field.name) as InputField : undefined;
			// Create formatted field
			const formattedField: formattedInputField = {
				kind: Kind.INPUT_FIELD,
				name: field.name,
				alias: field.alias,
				required: field.required,
				asserts: field.asserts,
				className: field.className,
				defaultValue: field.defaultValue,
				deprecated: field.deprecated,
				fileNames: field.fileNames,
				idx: field.idx,
				jsDoc: _compileJsDoc(fieldImp ? field.jsDoc.concat(fieldImp.jsDoc) : field.jsDoc),
				method: field.method,
				type: field.type
			};
			if (formattedField.method == null && fieldImp != null && fieldImp.method != null) {
				formattedField.method = fieldImp.method;
				formattedField.type = fieldImp.type;
			}
			result.push(formattedField);
		});
		return result;
	}
	/** Format output fields */
	function _formatOutputFields(fields: Map<string, OutputField>): formattedOutputField[] {
		const result: formattedOutputField[] = [];
		fields.forEach(function (field) {
			// Look for implementation
			const fieldImp = field.className ? helperEntities.get(field.className)?.fields.get(field.name) as OutputField : undefined;
			// Create formatted field
			const formattedField: formattedOutputField = {
				kind: Kind.OUTPUT_FIELD,
				name: field.name,
				alias: field.alias,
				required: field.required,
				className: field.className,
				defaultValue: field.defaultValue,
				deprecated: field.deprecated,
				fileNames: field.fileNames,
				idx: field.idx,
				jsDoc: _compileJsDoc(fieldImp ? field.jsDoc.concat(fieldImp.jsDoc) : field.jsDoc),
				method: field.method,
				type: field.type,
				param: field.param
			};
			if (formattedField.method == null && fieldImp != null && fieldImp.method != null) {
				formattedField.method = fieldImp.method;
				formattedField.type = fieldImp.type;
				formattedField.param = fieldImp.param;
			}
			result.push(formattedField);
		});
		return result;
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
/** Compile js Doc */
function _compileJsDoc(arr: string[] | string | undefined): string | undefined {
	if (arr == null) return undefined;
	else if (typeof arr === 'string') return arr;
	else {
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
}