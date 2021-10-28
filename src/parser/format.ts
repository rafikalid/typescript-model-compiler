import ts from "typescript";
import { FormatResponse, formattedInputField, FormattedInputNode, FormattedInputObject, formattedOutputField, FormattedOutputObject, FormattedOutputNode } from './formatted-model';
import { parse } from './parser';
import { InputNode, OutputNode, InputObject, OutputObject } from './model';
import {
	FieldType,
	InputField,
	List,
	Kind,
	OutputField,
	Param,
	Reference
} from './model';

/** Format parsed results to generate usable model */
export function format(
	root: ReturnType<typeof parse>
): FormatResponse {
	return {
		input: _resolveEntities(root.input, root.inputHelperEntities),
		output: _resolveEntities(root.output, root.outputHelperEntities)
	};
}

/** Resolve entities */
function _resolveEntities(map: Map<string, InputNode>, helperEntities: Map<string, InputObject>): Map<string, FormattedInputNode>;
function _resolveEntities(map: Map<string, OutputNode>, helperEntities: Map<string, OutputObject>): Map<string, FormattedOutputNode>;
function _resolveEntities<T extends InputNode | OutputNode>(map: Map<string, T>, helperEntities: Map<string, T>) {
	const result: Map<string, FormattedInputNode | FormattedOutputNode> = new Map();
	map.forEach((node, nodeName) => {
		switch (node.kind) {
			case Kind.BASIC_SCALAR:
			case Kind.SCALAR:
			case Kind.ENUM:
				result.set(nodeName, node);
				break;
			case Kind.UNION: {
				result.set(nodeName, node);
				// Check types found
				let missingTypes = node.types.filter(t => !result.has(t.name));
				if (missingTypes.length > 0)
					throw `Missing types [${missingTypes.map(t => t.name).join(', ')}] on union "${node.name}" at ${node.fileNames.join(', ')}`;
				break;
			}
			case Kind.INPUT_OBJECT:
			case Kind.OUTPUT_OBJECT: {
				let isInput = node.kind === Kind.INPUT_OBJECT;
				let entity: FormattedInputNode | FormattedOutputNode = {
					kind: isInput ? Kind.FORMATTED_INPUT_OBJECT : Kind.FORMATTED_OUTPUT_OBJECT,
					name: node.name,
					escapedName: _escapeEntityName(node.name),
					//TODO  resolve fields
					fields: Array.from(node.fields.values() as Iterable<InputField>),
					before: node.before == null ? [] : [node.before],
					after: node.after == null ? [] : [node.after],
					jsDoc: _compileJsDoc(node.jsDoc),
					deprecated: node.deprecated
				}
				break;
			}
			default:
				let neverV: never = node;
				throw new Error(`Unknown kind:` + neverV);
		}
	});
	return result;
}

/** Escape entity name */
function _escapeEntityName(name: string) {
	return name.replace(/[<\[,|.-]/g, '_')
		.replace(/\W/g, '');
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
function _compileJsDoc(arr: string[]): string | undefined {
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