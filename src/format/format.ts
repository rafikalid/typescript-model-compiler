import { Kind } from "@parser/kind";
import { AnyNode, FieldNode, ListNode, Node, ParamNode, RefNode, RootNode, StaticValueNode } from "@parser/model";
import type { parseSchema } from "@parser/parse";
import { getNodePath } from "@utils/node-path";
import ts from "typescript";
import { Compiler } from "..";
import { FormattedField, FormattedFieldType, FormattedMethod, FormattedParamNode, FormattedRootNode } from "./model";
import { _resolveScalars } from "./resolve-scalars";

/**
 * Format parsed data
 */
export function format(compiler: Compiler, compilerOptions: ts.CompilerOptions, data: ReturnType<typeof parseSchema>) {
	return {
		input: _format(compiler, compilerOptions, data.input, true),
		output: _format(compiler, compilerOptions, data.output, false)
	};
}

/** Format input entities */
function _format(compiler: Compiler, compilerOptions: ts.CompilerOptions, data: Map<string, RootNode | undefined>, isInput: boolean) {
	//* Resolver scalar parsers
	const scalars = _resolveScalars(compiler, compilerOptions, data);
	const result: Map<string, FormattedRootNode> = new Map();
	//* format entities
	const errors: string[] = [];
	data.forEach(function (entity) {
		try {

			if (entity == null) return;
			const entityName = entity.name;
			if (result.has(entityName)) return; // Entity mapped twice
			// Compile jsDoc
			const jsDoc = _compileJsDoc(entity.jsDoc);
			let formattedEntity: FormattedRootNode;
			// Before and after
			const codeBefore: ts.Statement[] = [];
			const codeAfter: ts.Statement[] = [];
			//TODO
			// Add formatted entity
			switch (entity.kind) {
				case Kind.SCALAR: {
					let field: FieldNode | undefined;
					formattedEntity = {
						kind: Kind.SCALAR,
						name: entityName,
						jsDoc,
						before: codeBefore,
						after: codeAfter,
						// Fields
						parse: (field = entity.fields.get('parse')) && _formatField(field, true),
						serialize: (field = entity.fields.get('serialize')) && _formatField(field, true),
						fromDB: (field = entity.fields.get('fromDB')) && _formatField(field, true),
						toDB: (field = entity.fields.get('toDB')) && _formatField(field, true),
						default: (field = entity.fields.get('default')) && _formatField(field, true),
						defaultOutput: (field = entity.fields.get('defaultOutput')) && _formatField(field, true),
						mock: (field = entity.fields.get('mock')) && _formatField(field, true)
					};
					break;
				}
				case Kind.ENUM:
					if (entity.members.length === 0)
						throw `Expected member for enum "${entityName}" at: ${getNodePath(entity.tsNodes)}`;
					formattedEntity = {
						kind: Kind.ENUM,
						name: entityName,
						jsDoc,
						before: codeBefore,
						after: codeAfter,
						members: entity.members.map(member => ({
							kind: Kind.ENUM_MEMBER,
							name: member.name,
							jsDoc: _compileJsDoc(member.jsDoc),
							value: member.value
						}))
					};
					break;
				case Kind.LIST: {
					if (entity.type == null)
						throw `Missing type for list "${entity.name}" at: ${getNodePath(entity.tsNodes)}`;
					// Entity
					formattedEntity = {
						kind: Kind.LIST,
						name: entityName,
						jsDoc,
						before: codeBefore,
						after: codeAfter,
						type: _resolveReference(entity.type)
					};
					break;
				}
				case Kind.OBJECT:
					formattedEntity = {
						kind: Kind.OBJECT,
						name: entityName,
						jsDoc,
						before: codeBefore,
						after: codeAfter,
						fields: Array.from(entity.fields.values()).map(_formatField)
					};
					break;
				case Kind.UNION: {
					const resolve = entity.fields.get('resolve');
					if (resolve == null)
						throw `Missing resolver for union "${entityName}" at: ${getNodePath(entity.tsNodes)}`;
					formattedEntity = {
						kind: Kind.UNION,
						name: entityName,
						jsDoc,
						before: codeBefore,
						after: codeAfter,
						tsNodes: entity.tsNodes,
						resolve: _formatField(resolve)
					};
					break;
				}
				default: {
					let n: never = entity;
					const e = entity as RootNode;
					throw `Unexpected kind "${Kind[e.kind]}" for "${e.name}" at: ${getNodePath(entity)}`;
				}
			}
			result.set(entityName, formattedEntity);
		} catch (err) {
			if (typeof err === 'string') errors.push(err);
			else throw err;
		}
	});

	//* Throw errors if found
	if (errors.length) throw new Error(`Parsing Errors: \n\t- ${errors.join('\n\t- ')}`);
	//* Return
	return result;

	/** Format fields */
	function _formatField(field: FieldNode, ignoreType?: boolean | number): FormattedField {
		// if (field.className == null)
		// 	throw `Missing className for field "${field.parent.name}.${field.name}" at ${getNodePath(field.tsNodes)}`;
		// Before and after
		const codeBefore: ts.Statement[] = [];
		const codeAfter: ts.Statement[] = [];
		//TODO
		// Method
		let formattedMethod: FormattedMethod | undefined;
		const method = field.method;
		if (method == null) { }
		else if (method.type == null)
			throw `Missing return type for method "${method.name}" at: ${getNodePath(method.tsNode)}`;
		else {
			formattedMethod = {
				kind: Kind.METHOD,
				class: method.class,
				isAsync: method.type.isAsync,
				isStatic: method.isStatic,
				name: method.name,
				params: method.params.map(_resolveParams),
				path: method.tsNode.getSourceFile().fileName,
				type: _resolveReference(method.type)
			};
		}
		// type
		const type = isInput ? field.type : field.method?.type ?? field.type;
		if (type == null && ignoreType === true)
			throw `Missing type for ${isInput ? 'input' : 'output'} field "${field.parent.name}.${field.name}" at ${getNodePath(field.tsNodes)}`;
		// Return
		return {
			kind: Kind.FIELD,
			name: field.name,
			before: codeBefore,
			after: codeAfter,
			jsDoc: _compileJsDoc(field.jsDoc),
			required: field.required,
			className: field.className,
			idx: field.idx,
			method: formattedMethod,
			type: type ? _resolveReference(type) : {
				kind: Kind.STATIC_VALUE,
				value: 'undefined',
				isAsync: false
			}
		}
	}

	/** Resolve params */
	function _resolveParams(param: ParamNode): FormattedParamNode {
		if (param.type == undefined)
			throw `Expected type for param "${param.name}" at: ${getNodePath(param.tsNodes)}`;
		return {
			kind: Kind.PARAM,
			name: param.name,
			required: param.required,
			isParentObject: param.isParentObject,
			type: _resolveReference(param.type, true)
		}
	}
	/** Resolve reference or static value */
	function _resolveReference(type: RefNode | StaticValueNode | AnyNode, isParam?: boolean): FormattedFieldType {
		if (type.kind === Kind.REF) {
			let entityName = type.name;
			if (!type.isFromPackage) {
				const targetEntity = data.get(entityName);
				if (targetEntity != null)
					entityName = targetEntity.name;
				else if (!isParam)
					throw `Missing entity "${entityName}" referenced at: ${getNodePath(type.tsNodes)}`;
			}
			return {
				kind: Kind.REF,
				isAsync: type.isAsync,
				name: entityName
			}
		} else if (type.kind === Kind.STATIC_VALUE) {
			return {
				kind: Kind.STATIC_VALUE,
				value: type.value,
				isAsync: false
			}
		} else if (type.kind === Kind.ANY) {
			return {
				kind: Kind.ANY,
				isAsync: false
			}
		} else {
			const n: never = type;
			throw (`Unexpected type "${Kind[(type as any).kind]}" at: ${getNodePath((type as any).tsNodes)}`)
		}
	}
}


// /** Sort jsDoc */
// const sortJsDocKeywords = [
// 	'Generic',
// 	'Partial',
// 	'Implements',
// 	'Extends',
// 	'Inherit-from'
// ];
/** Compile jsDoc */
function _compileJsDoc(arr: string[]): string | undefined {
	const result = arr
		.filter((v, i, arr) => i === arr.indexOf(v)) // remove duplications
		.sort((a, b) => {
			if (a.startsWith('@')) {
				if (b.startsWith('@')) {
					let i = a.indexOf(' ');
					const at = i === -1 ? a : a.slice(0, i);
					i = b.indexOf(' ');
					const bt = i === -1 ? b : b.slice(0, i);
					return at.localeCompare(bt);
					// return (
					// 	sortJsDocKeywords.indexOf(at) -
					// 	sortJsDocKeywords.indexOf(bt)
					// );
				} else return 1;
			} else return -1;
		});
	return result.length ? result.join("\n") : undefined;
}
