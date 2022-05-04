import { ResolvedPattern } from "@compiler/resolve-patterns";
import { Kind } from "@parser/kind";
import { AnyNode, FieldNode, ListNode, Node, ParamNode, ParamType, RefNode, RootNode, StaticValueNode, Annotation, StaticValueResponse, ObjectNode } from "@parser/model";
import type { parseSchema } from "@parser/parse";
import { getNodePath } from "@utils/node-path";
import { JsDocAnnotationMethod, JsDocAnnotationMethodResult } from "tt-model";
import ts from "typescript";
import { Compiler } from "..";
import { _convertAnnotation } from "./element";
import { JsDocUtilsImp } from "./jsDoc-utils";
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
	/** Annotation handler result map */
	const AnnotationHandlerMap = new Map<JsDocAnnotationMethod, JsDocAnnotationMethodResult>();
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
			//* Apply annotations
			let { before: codeBefore, after: codeAfter } = _applyAnnotations(entity);
			// Decorator annotations
			const decorators = (entity as any).decorators as Annotation[];
			if (decorators != null) {
				codeBefore ??= [];
				codeAfter ??= [];
				decorators.forEach(function (annotation, annotationName) {
					// Get annotation 
					console.log('====> Annotation', annotationName, annotation);
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
		let { before: codeBefore, after: codeAfter } = _applyAnnotations(field);
		// Return
		return {
			kind: Kind.FIELD,
			name: field.name,
			alias: field.alias ?? field.name,
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
	/** Apply annotations */
	function _applyAnnotations(node: FieldNode | RootNode) {
		const annotations = node.annotations;
		let before: ts.Statement[] | undefined;
		let after: ts.Statement[] | undefined;
		if (annotations.length > 0) {
			before = [];
			after = [];
			// Group annotations
			const jsDocGrouped = new Map<string, Annotation[]>();
			const decoGrouped = new Map<JsDocAnnotationMethod, Annotation[]>();
			for (let i = 0, len = annotations.length; i < len; ++i) {
				const a = annotations[i];
				if (a.isFromPackage || a.kind === Kind.JSDOC_TAG) {
					const r = jsDocGrouped.get(a.name);
					if (r == null) jsDocGrouped.set(a.name, [a]);
					else r.push(a);
				} else if (a.kind === Kind.DECORATOR) {
					const r = decoGrouped.get(a.handler);
					if (r == null) decoGrouped.set(a.handler, [a]);
					else r.push(a);
				} else throw new Error(`Unexpected annotation kind: ${a.kind} at ${getNodePath(a.tsNode)}`);
			}
			// Exec jsDoc and package annotations
			jsDocGrouped.forEach(_applyAnnotation);
			// Exec Decorators
			decoGrouped.forEach(_applyAnnotation);
		}
		return {
			before,
			after
		}
		/** Apply each annotation */
		function _applyAnnotation(annotations: Annotation[]) {
			const firstAnnotation = annotations[0]!;
			try {
				if (firstAnnotation.isFromPackage) {
					switch (firstAnnotation.name) {
						case 'assert':
							//TODO assert
							console.log('>> Assert: ', firstAnnotation.params);
							break;
						case 'orderBy':
							//TODO Order by
							console.log('>> OrderBy: ', firstAnnotation.params);
							break;
						default:
							throw `Unexpected package tag "${firstAnnotation.name}"`;
					}
				} else {
					// Are grouped by handler
					const result = _execHandler(firstAnnotation.handler, firstAnnotation.name);
					// parse JSDoc arguments
					if (result.jsDocArgParser != null && firstAnnotation.kind === Kind.JSDOC_TAG) {
						for (let i = 0, len = annotations.length; i < len; ++i) {
							const a = annotations[i];
							if (a.params.length > 1)
								throw `Unexpected param count for jsDoc tag "${a.name}" at ${getNodePath(a.tsNode)}`;
							a.params = result.jsDocArgParser(a.params[0]?.name ?? '') as StaticValueResponse[];
						}
					}
					// Exec
					const r = result.exec(_convertAnnotation(node, data, annotations), JsDocUtilsImp);
					if (r.before != null) _appendCode(before!, r.before);
					if (r.after != null) _appendCode(after!, r.after);
				}
			} catch (err: any) {
				errors.push(`Error when executing annotation "${firstAnnotation.name}" at: ${getNodePath(firstAnnotation.tsNode)}. Caused by: ${err?.stack ?? err}`);
			}
		}
	}
	/** Get annotation handler result */
	function _execHandler(handler: JsDocAnnotationMethod, annotationName: string) {
		let result = AnnotationHandlerMap.get(handler);
		if (result == null) {
			result = handler(JsDocUtilsImp, annotationName);
			// Add root code (like imports)
			result.root && _appendCode(ROOT_CODE, result.root);
			// Map handler
			AnnotationHandlerMap.set(handler, result);
		}
		return result;
	}
	/** Append root, before or after code */
	function _appendCode(target: ts.Statement[], code: string | ts.Statement | ts.Statement[]): void {
		if (typeof code === 'string')
			target.push(ts.factory.createExpressionStatement(ts.factory.createIdentifier(code)));
		else if (Array.isArray(code))
			target.push(...code);
		else target.push(code);
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
