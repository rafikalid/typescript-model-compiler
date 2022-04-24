import { ResolvedPattern } from "@compiler/resolve-patterns";
import { Kind } from "@parser/kind";
import { AnyNode, FieldNode, ListNode, Node, ParamNode, ParamType, RefNode, RootNode, StaticValueNode, Decorator, JsDocTag, Annotation } from "@parser/model";
import type { parseSchema } from "@parser/parse";
import { getNodePath } from "@utils/node-path";
import ts from "typescript";
import { Compiler } from "..";
import { FormattedField, FormattedFieldType, FormattedMethod, FormattedParamNode, FormattedRootNode } from "./model";
import { ScalarParser, ScalarParsers, _resolveScalars } from "./resolve-scalars";

/**
 * Format parsed data
 */
export function format(
	compiler: Compiler,
	compilerOptions: ts.CompilerOptions,
	data: ReturnType<typeof parseSchema>,
	parseOptions: ResolvedPattern,
	scalars: ScalarParsers,
) {
	return {
		input: _format(compiler, compilerOptions, data.input, parseOptions, scalars.input, true),
		output: _format(compiler, compilerOptions, data.output, parseOptions, scalars.output, false)
	};
}

/** Format input entities */
function _format(
	compiler: Compiler,
	compilerOptions: ts.CompilerOptions,
	data: Map<string, RootNode | undefined>,
	parseOptions: ResolvedPattern,
	scalars: ScalarParser,
	isInput: boolean
) {
	const result: Map<string, FormattedRootNode> = new Map();
	//* format entities
	const errors: string[] = [];
	/**
	 * Root code to add to page root context
	 * Usually contains import statements
	 */
	const ROOT_CODE: ts.Statement[] = [];
	data.forEach(function (entity) {
		try {

			if (entity == null) return;
			const entityName = entity.name;
			if (result.has(entityName)) return; // Entity mapped twice
			// Compile jsDoc
			const jsDoc = _compileJsDoc(entity.jsDoc);
			let formattedEntity: FormattedRootNode;
			// Before and after
			const annotations = _groupAnnotations((entity as any).annotations, entity.jsDocTags);
			//* Apply annotations
			let codeBefore: ts.Statement[] | undefined;
			let codeAfter: ts.Statement[] | undefined;
			if (annotations != null) {
				codeBefore = [];
				codeAfter = [];
				annotations.forEach(function (annotation, annotationName) {
					// Get annotation 
				});
			}
			//TODO
			// Add formatted entity
			switch (entity.kind) {
				case Kind.SCALAR: {
					let field: FieldNode | undefined;
					formattedEntity = {
						kind: Kind.SCALAR,
						name: entityName,
						jsDoc,
						annotations,
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
						annotations,
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
						annotations,
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
						annotations,
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
						annotations,
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
		//TODO
		// Method
		let formattedMethod: FormattedMethod | undefined;
		const method = field.method;
		if (method == null) { }
		else if (method.type == null)
			throw `Missing return type for method "${method.name}" at: ${getNodePath(method.tsNode)}`;
		else {
			// Check input values
			let inputs = method.params.filter(p => p.paramType == ParamType.INPUT);
			if (inputs.length > 1) {
				const inputNames = inputs.map(i => `"${i.name}: ${i.type?.name}"`).join(', ');
				throw `Expected one input argument for the ${field.isInput ? 'validator' : 'resolver'} "${field.parent.name}.${field.name}". Got ${inputNames} at ${getNodePath(method.tsNode)}`;
			}
			// Format method
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
		// Before and after
		const annotations = _groupAnnotations(field.annotations, field.jsDocTags);
		const codeBefore: ts.Statement[] = [];
		const codeAfter: ts.Statement[] = [];
		// Return
		return {
			kind: Kind.FIELD,
			name: field.name,
			before: codeBefore,
			after: codeAfter,
			jsDoc: _compileJsDoc(field.jsDoc),
			annotations,
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
			paramType: param.paramType,
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
/** Format annotations */
function _groupAnnotations(decorators: Decorator[] | undefined, jsDocTags: JsDocTag[]): Map<string, Annotation[]> | undefined {
	if ((decorators == null || decorators.length === 0) && jsDocTags.length === 0) return;
	const result: Map<string, Annotation[]> = new Map();
	// Add annotations
	if (decorators != null)
		for (let i = 0, len = decorators.length; i < len; ++i) {
			const a = decorators[i];
			const r = result.get(a.name);
			if (r == null) result.set(a.name, [a]);
			else r.push(a);
		}
	// Add jsDoc tags
	for (let i = 0, len = jsDocTags.length; i < len; ++i) {
		const a = jsDocTags[i];
		const r = result.get(a.name);
		if (r == null) result.set(a.name, [a]);
		else r.push(a);
	}
	return result;
}

