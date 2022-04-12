import { getNodePath } from "@utils/node-path";
import ts from "typescript";
import { getImplementedEntities, HelperClass } from "./class-implemented-entities";
import { isAsync } from "./is-async";
import { Kind } from "./kind";
import { Annotation, EnumMemberNode, FieldNode, ListNode, MethodNode, Node, ObjectNode, ParamNode, RefNode, ResolverClassNode, RootNode, ValidatorClassNode } from "./model";
import { cleanType, doesTypeHaveNull } from "./utils";

/** 
 * Parse schema
 */
export function parseSchema(program: ts.Program, files: readonly string[]) {
	//* Prepare
	const typeChecker = program.getTypeChecker();
	const tsNodePrinter = ts.createPrinter({
		omitTrailingSemicolon: false,
		removeComments: true
	});
	//* Store values
	const IGNORED_ENTITIES: Map<string, IgnoredEntity[]> = new Map();
	const INPUT_ENTITIES: Map<string, RootNode> = new Map();
	const OUTPUT_ENTITIES: Map<string, RootNode> = new Map();
	const RESOLVERS: ResolverClassNode[] = [];
	const VALIDATORS: ValidatorClassNode[] = [];
	const LITERAL_OBJECTS: LiteralObject[] = [];
	//* Prepare queue
	const Q: QueueItem[] = [];
	for (let i = 0, len = files.length; i < len; ++i) {
		let srcFile = program.getSourceFile(files[i]);
		if (srcFile == null) throw new Error(`File included in pattern but not in your files to compile: ${files[i]}`);
		_queueChildren(true, srcFile); // Read as input entities
		_queueChildren(false, srcFile);// Read as output entities
	}
	//* Iterate over all nodes
	const errors: string[] = [];
	rootLoop: for (let Qi = 0; Qi < Q.length; ++Qi) {
		try {
			//* Get next item
			const QItem = Q[Qi];
			const { tsNode, parentNode, isInput, isImplementation, entityName } = QItem;
			const tsNodeType = QItem.tsNodeType ?? typeChecker.getTypeAtLocation(tsNode);
			const tsNodeSymbol = QItem.tsNodeSymbol ?? tsNodeType.symbol;
			//* Parse jsDoc
			const jsDoc: string[] = tsNodeSymbol?.getDocumentationComment(typeChecker).map(e => e.text) ?? [];
			let jsDocTags: Map<string, (string | undefined)[]> | undefined; // Map<annotationName, annotationValue>
			const foundJsDocTags = tsNodeSymbol?.getJsDocTags();
			if (foundJsDocTags != null && foundJsDocTags.length > 0) {
				jsDocTags = new Map();
				for (let i = 0, len = foundJsDocTags.length; i < len; ++i) {
					const tag = foundJsDocTags[i];
					const tagText = tag.text?.map(c => c.text).join("\n").trim();
					// Ignore
					switch (tag.name) {
						case 'ignore':
							continue rootLoop;
						case 'input':
							if (!isInput) continue rootLoop;
							break;
						case 'output':
							if (isInput) continue rootLoop;
							break;
					}
					// Save tag
					const tags = jsDocTags.get(tag.name);
					if (tags == null) jsDocTags.set(tag.name, [tagText]);
					else tags.push(tag.name);
				}
			}
			//* Parse decorators
			const annotations: Annotation[] = [];
			//TODO parse decorators
			//TODO ignore if @ignore found
			//* Parse node
			switch (tsNode.kind) {
				case ts.SyntaxKind.InterfaceDeclaration:
				case ts.SyntaxKind.ClassDeclaration: {
					const entityNode = tsNode as ts.ClassDeclaration | ts.InterfaceDeclaration;
					const isClass = tsNode.kind === ts.SyntaxKind.ClassDeclaration;
					//* Ignore generic interfaces and classes
					if (entityNode.typeParameters != null) continue rootLoop;
					//* Get entity name
					if (entityNode.name == null) throw `Unexpected anonymous ${isClass ? 'class' : 'interface'} at ${getNodePath(entityNode)}`;
					const entityName = _getFullQualifiedName(entityNode.name);
					//* Check has export keyword
					const hasExportKeyword = tsNode.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
					if (!hasExportKeyword) {
						_ignoreEntity(entityName, 'export', tsNode);
						continue rootLoop;
					}
					//* Get implemented or inherited entities
					const implemented = getImplementedEntities(typeChecker, entityNode, _getNodeName);
					let entity: Node | undefined;
					let isImplementation: boolean; // If is @entity or @resolver or validators
					switch (implemented.type) {
						case HelperClass.ENTITY:
							// Check if has @entity jsDoc tag
							if (jsDocTags == null) {
								_ignoreEntity(entityName, '@entity', tsNode);
								continue rootLoop;
							}
							else if (jsDocTags.has('resolvers')) {
								isImplementation = true; // If methods are resolvers or entity methods
								if (jsDocTags.has('entity'))
									throw `@entity and @resolvers are exclusive. at ${getNodePath(tsNode)}`;
							}
							else if (jsDocTags.has('entity')) {
								isImplementation = false;
							} else {
								_ignoreEntity(entityName, '@entity', tsNode);
								continue rootLoop;
							}
							// Create entity
							const targetMap = isInput ? INPUT_ENTITIES : OUTPUT_ENTITIES;
							entity = targetMap.get(entityName);
							if (entity == null) {
								entity = {
									kind: Kind.OBJECT,
									isInput,
									name: entityName,
									annotations,
									fields: new Map(),
									inherit: implemented.entities,
									isClass,
									jsDoc,
									jsDocTags,
									tsNodes: [entityNode]
								};
								targetMap.set(entityName, entity);
							} else if (entity.kind !== Kind.OBJECT) {
								throw new Error(`Duplicated entity ${entityName} as Object and ${Kind[entity.kind]} at ${getNodePath(entityNode)} and ${getNodePath(entity.tsNodes)}`);
							} else {
								entity.annotations.push(...annotations);
								entity.jsDoc.push(...jsDoc);
								entity.inherit.push(...implemented.entities);
								entity.tsNodes.push(entityNode);
								_mergeJsDocTags(entity.jsDocTags, jsDocTags);
							}
							break;
						case HelperClass.RESOLVERS:
							// Check jsDoc annotations
							if (jsDocTags != null) {
								if (jsDocTags.has('input')) throw `Could not use "@input" with "resolversOf" at: ${getNodePath(entityNode)}`;
								if (jsDocTags.has('entity')) throw `Could not use "@entity" with "resolversOf" at: ${getNodePath(entityNode)}`;
							}
							if (isInput) continue rootLoop;
							//Entity
							entity = {
								kind: Kind.RESOLVER_CLASS,
								name: entityName,
								isInput,
								jsDoc,
								jsDocTags,
								tsNodes: [entityNode],
								entities: implemented.entities,
								annotations,
								fields: new Map()
							};
							RESOLVERS.push(entity);
							isImplementation = true;
							break;
						case HelperClass.VALIDATORS:
							// Check jsDoc annotations
							if (jsDocTags != null) {
								if (jsDocTags.has('output')) throw `Could not use "@output" with "validatorsOf" at: ${getNodePath(entityNode)}`;
								if (jsDocTags.has('entity')) throw `Could not use "@entity" with "validatorsOf" at: ${getNodePath(entityNode)}`;
							}
							if (!isInput) continue rootLoop;
							//Entity
							entity = {
								kind: Kind.VALIDATOR_CLASS,
								name: entityName,
								isInput,
								jsDoc,
								jsDocTags,
								tsNodes: [entityNode],
								entities: implemented.entities,
								annotations,
								fields: new Map()
							};
							VALIDATORS.push(entity);
							isImplementation = true;
							break;
						default: {
							let n: never = implemented.type;
							continue rootLoop;
						}
					}
					//* Go through properties
					tsNodeType.getProperties().forEach(s => {
						const dec = s.valueDeclaration ?? s.declarations?.[0];
						if (dec == null) return;
						const propType = typeChecker.getTypeOfSymbolAtLocation(s, entityNode);
						Q.push({
							isInput,
							tsNode: dec,
							tsNodeType: propType,
							entityName: s.name,
							parentNode: entity,
							tsNodeSymbol: s,
							isImplementation
						});
					});
					break;
				}
				case ts.SyntaxKind.PropertySignature:
				case ts.SyntaxKind.MethodDeclaration:
				case ts.SyntaxKind.PropertyDeclaration: {
					const propertyNode = tsNode as ts.PropertySignature | ts.MethodDeclaration | ts.PropertyDeclaration;
					if (parentNode == null) continue rootLoop;
					if (
						parentNode.kind != Kind.OBJECT &&
						parentNode.kind != Kind.VALIDATOR_CLASS &&
						parentNode.kind != Kind.RESOLVER_CLASS
					)
						throw `Unexpected parent node "${Kind[parentNode.kind]}" for property "${_getNodeName(tsNode)}" at ${getNodePath(tsNode)}`;
					if (entityName == null)
						throw `Missing name for property at ${getNodePath(tsNode)}`;
					const className = (propertyNode.parent as ts.ClassLikeDeclaration).name?.getText();
					const isMethod = tsNode.kind === ts.SyntaxKind.MethodDeclaration;
					// Check type
					if (propertyNode.type == null) {
						if (isMethod) throw `To minimize errors, please define explicitly the return value for ${parentNode.name}.${entityName} at ${getNodePath(tsNode)}`;
						else throw `Please define the type of ${parentNode.name}.${entityName} at ${getNodePath(tsNode)}`;
					}
					//* Method
					let method: MethodNode | undefined;
					if (isMethod) {
						// Ignore if is entity (not implementation)
						if (!isImplementation) continue rootLoop;
						if (className == null) throw `Unexpected anonymous class for method implementation at ${getNodePath(tsNode)}`;
						const tsMethod = tsNode as ts.MethodDeclaration;
						method = {
							kind: Kind.METHOD,
							class: className,
							name: entityName,
							isAsync: isAsync(typeChecker, tsMethod),
							isStatic: tsNode.modifiers?.some(n => n.kind === ts.SyntaxKind.StaticKeyword) ?? false,
							params: [],
							tsNode: tsMethod
						};
						// Resolve params
						tsMethod.parameters?.forEach(param => {
							if (param.type != null)
								Q.push({
									isImplementation,
									isInput,
									tsNode: param,
									entityName: param.name.getText(),
									parentNode: method
								});
						});
					}
					// Add field
					let field = parentNode.fields.get(entityName);
					const isOptional = propertyNode.questionToken == null || propertyNode.type == null ||
						doesTypeHaveNull(typeChecker, typeChecker.getTypeFromTypeNode(propertyNode.type));
					if (field == null) {
						field = {
							kind: Kind.FIELD,
							isInput,
							annotations,
							jsDoc,
							jsDocTags,
							className,
							name: entityName,
							tsNodes: [propertyNode],
							method,
							required: !isOptional,
							idx: propertyNode.parent.getChildren().indexOf(propertyNode),
							type: undefined
						};
					} else {
						if (field.method != null && method)
							throw `Duplicate ${isInput ? 'validator' : 'resolver'} for ${parentNode.name}.${entityName} at ${getNodePath(field.method.tsNode)} and ${getNodePath(method.tsNode)}`;
						field.method = method;
						field.annotations.push(...annotations);
						field.jsDoc.push(...jsDoc);
						field.tsNodes.push(tsNode);
						if (jsDocTags != null) {
							if (field.jsDocTags == null) field.jsDocTags = jsDocTags;
							else _mergeJsDocTags(field.jsDocTags, jsDocTags);
						}
					}
					// resolve type
					Q.push({
						isImplementation,
						isInput,
						tsNode: _nodeType(propertyNode.type, tsNodeType),
						entityName,
						parentNode: field,
						tsNodeType: tsNodeType
					});
					break;
				}
				case ts.SyntaxKind.Parameter: {
					if (parentNode == null || parentNode.kind != Kind.METHOD)
						throw `Expected parentNode for PARAM as METHOD or FUNCTION. get ${parentNode == null ? 'undefined' : Kind[parentNode.kind]} at: ${getNodePath(tsNode)}`;
					const paramNode = tsNode as ts.ParameterDeclaration;
					const isOptional = paramNode.questionToken == null || paramNode.type == null ||
						doesTypeHaveNull(typeChecker, typeChecker.getTypeFromTypeNode(paramNode.type));
					const param: ParamNode = {
						kind: Kind.PARAM,
						name: paramNode.name.getText(),
						required: !isOptional,
						isInput,
						jsDoc,
						jsDocTags,
						tsNodes: [paramNode],
						type: undefined
					};
					parentNode.params.push(param);
					Q.push({
						isImplementation,
						isInput,
						tsNode: paramNode.type!,//_nodeType(paramNode.type!, tsNodeType),
						entityName,
						parentNode: param
					});
					break;
				}
				case ts.SyntaxKind.LastTypeNode:
				case ts.SyntaxKind.TypeReference:
				case ts.SyntaxKind.IntersectionType:
				case ts.SyntaxKind.UnionType: {
					if (parentNode == null) continue rootLoop;
					if (
						parentNode.kind !== Kind.FIELD &&
						parentNode.kind !== Kind.LIST &&
						parentNode.kind !== Kind.PARAM
					)
						throw `Unexpected parentNode "${Kind[parentNode.kind]}"`;
					console.log('========================', Kind[parentNode.kind], ' ::', (parentNode as FieldNode).name);
					console.log('=>', _getNodeName(tsNode));
					// const unionNode = tsNode as ts.UnionTypeNode;
					// const f = ts.factory;
					// const awaitedType = f.createTypeReferenceNode(
					// 	f.createIdentifier("Awaited"),
					// 	[tsNode as ts.TypeNode]
					// );
					// const awaitedType = rmPromises(typeChecker, unionNode);
					// console.log('sa>>', _getNodeName(awaitedType));
					// rmPromises(typeChecker, awaitedType);
					// const tt = typeChecker.getTypeFromTypeNode(tsNode as ts.TypeNode);
					const t2 = typeChecker.getNonNullableType(tsNodeType);
					console.log('===tsNodeType==>tps: ', typeChecker.typeToString(tsNodeType));
					console.log('===s==>tps: ', typeChecker.typeToString(t2));
					// console.log('result: >', cleanType(typeChecker, tt).text);
					// const t = typeChecker.typeToTypeNode(typeChecker.getTypeAtLocation(awaitedType), undefined, undefined);
					// console.log(t == null ? ' >shit<' : _getNodeName(t));
					//TODO here ----------------------------
					break;
				}
				case ts.SyntaxKind.StringKeyword:
				case ts.SyntaxKind.BooleanKeyword:
				case ts.SyntaxKind.NumberKeyword:
				case ts.SyntaxKind.SymbolKeyword:
				case ts.SyntaxKind.BigIntKeyword: {
					if (parentNode == null) continue rootLoop;
					if (
						parentNode.kind !== Kind.FIELD &&
						parentNode.kind !== Kind.LIST &&
						parentNode.kind !== Kind.PARAM
					)
						throw `Unexpected parent node "${Kind[parentNode.kind]}" for "${ts.SyntaxKind[tsNode.kind]}" at: ${getNodePath(tsNode)}`;
					const type: RefNode = {
						kind: Kind.REF,
						isInput,
						jsDoc,
						jsDocTags,
						name: _getNodeName(tsNode),
						tsNodes: [tsNode]
					};
					parentNode.type = type;
					break;
				}
				case ts.SyntaxKind.ArrayType: {
					if (parentNode == null) continue rootLoop;
					if (
						parentNode.kind !== Kind.FIELD &&
						parentNode.kind !== Kind.LIST &&
						parentNode.kind !== Kind.PARAM
					)
						throw `Unexpected parent node "${Kind[parentNode.kind]}" for "ArrayType" at: ${getNodePath(tsNode)}`;
					const tsArray = tsNode as ts.ArrayTypeNode;
					const arrEl = tsArray.elementType;
					const arrType = (tsNodeType as ts.TypeReference).typeArguments?.[0]!;
					const isOptional = doesTypeHaveNull(typeChecker, arrType);
					const listNode: ListNode = {
						kind: Kind.LIST,
						isInput,
						jsDoc,
						jsDocTags,
						required: !isOptional,
						tsNodes: [tsNode],
						type: undefined
					};
					parentNode.type = listNode;
					Q.push({
						isImplementation,
						isInput,
						tsNode: arrEl, //_nodeType(arrEl, arrType),
						tsNodeType: arrType,
						entityName,
						parentNode: listNode
					});
					break;
				}
				case ts.SyntaxKind.EnumDeclaration: {
					const enumNode = tsNode as ts.EnumDeclaration;
					const entityName = _getFullQualifiedName(enumNode.name);
					const targetMap = isInput ? INPUT_ENTITIES : OUTPUT_ENTITIES;
					let entity = targetMap.get(entityName);
					if (entity != null)
						throw `Duplicate ${isInput ? 'input' : 'output'} entity "${entityName}" at ${getNodePath(tsNode)} and ${getNodePath(entity.tsNodes)}`;
					entity = {
						kind: Kind.ENUM,
						name: entityName,
						isInput,
						jsDoc,
						jsDocTags,
						tsNodes: [tsNode],
						members: []
					};
					targetMap.set(entityName, entity);
					// Resolve children
					enumNode.members.forEach(member => {
						Q.push({
							isImplementation,
							isInput,
							tsNode: member,
							parentNode: entity
						});
					});
					break;
				}
				case ts.SyntaxKind.EnumMember: {
					if (parentNode == null || parentNode.kind != Kind.ENUM)
						throw `Unexpected ENUM MEMBER "${entityName}" at: ${getNodePath(tsNode)}`;
					const enumMemberNode = tsNode as ts.EnumMember;
					let enumMember: EnumMemberNode = {
						kind: Kind.ENUM_MEMBER,
						name: enumMemberNode.name.getText(),
						value: typeChecker.getConstantValue(enumMemberNode)!,
						jsDoc: jsDoc,
						isInput,
						jsDocTags,
						tsNodes: [tsNode]
					};
					parentNode.members.push(enumMember);
					break;
				}
				case ts.SyntaxKind.TypeLiteral: {
					//* Anonymous object
					if (parentNode == null) continue rootLoop;
					if (
						parentNode.kind !== Kind.FIELD &&
						parentNode.kind !== Kind.LIST &&
						parentNode.kind !== Kind.PARAM
					)
						throw `Unexpected parent node "${Kind[parentNode.kind]}" for "TypeLiteral" at: ${getNodePath(tsNode)}`;
					const entity: ObjectNode = {
						kind: Kind.OBJECT,
						annotations,
						name: '',
						fields: new Map(),
						inherit: [],
						isInput,
						isClass: false,
						jsDoc,
						jsDocTags: jsDocTags ?? new Map(),
						tsNodes: [tsNode]
					};
					const ref: RefNode = {
						kind: Kind.REF,
						name: entityName ?? '',
						isInput,
						jsDoc,
						jsDocTags,
						tsNodes: [tsNode]
					};
					parentNode.type = ref;
					LITERAL_OBJECTS.push({ entity, isInput, ref });
					//* Go through properties
					tsNodeType.getProperties().forEach(s => {
						const dec = s.valueDeclaration ?? s.declarations?.[0];
						if (dec == null) return;
						const propType = typeChecker.getTypeOfSymbolAtLocation(s, tsNode);
						Q.push({
							isInput,
							tsNode: dec,
							tsNodeType: propType,
							entityName: s.name,
							parentNode: entity,
							tsNodeSymbol: s,
							isImplementation
						});
					});
					break;
				}
				case ts.SyntaxKind.SyntaxList:
				case ts.SyntaxKind.ModuleDeclaration:
				case ts.SyntaxKind.ModuleBlock:
					_queueChildren(isInput, tsNode, parentNode);
					break;
				case ts.SyntaxKind.TupleType:
					throw `Tuples are not supported, did you mean Array of type? at ${getNodePath(tsNode)}`;
				case ts.SyntaxKind.TypeOperator: {
					console.log('FOUND typeOperator: ', _getNodeName(tsNode), '>>', getNodePath(tsNode));
					//FIXME Check what TypeOperatorNode do!
					// let tp = (node as ts.TypeOperatorNode).type;
					// visitor.push(tp, typeChecker.getTypeAtLocation(tp), pDesc, srcFile, isInput);
					break;
				}
			}
		} catch (err) {
			if (typeof err === 'string') errors.push(err);
			else throw err;
		}
	}
	//* Throw errors if found
	if (errors.length) throw new Error(`Parsing Errors: \n\t - ${errors.join('\n\t- ')} `);

	//* Add default scalars
	//TODO
	//* Add helpers
	//TODO
	//* Add nameless entities
	//TODO
	//* Return
	return {
		input: INPUT_ENTITIES,
		output: OUTPUT_ENTITIES,
		ignored: IGNORED_ENTITIES
	}

	/** @private Add all children to queue */
	function _queueChildren(isInput: boolean, tsNode: ts.Node, parentNode?: Node, entityName?: string) {
		for (let i = 0, children = tsNode.getChildren(), len = children.length; i < len; ++i) {
			const child = children[i];
			Q.push({
				isInput,
				isImplementation: false,
				tsNode: child,
				parentNode,
				entityName
			});
		}
	}

	/** @private get node name */
	function _getNodeName(tsNode: ts.Node): string {
		return tsNodePrinter.printNode(ts.EmitHint.Unspecified, tsNode, tsNode.getSourceFile());
	}

	/** @private add missing entity */
	function _ignoreEntity(name: string, missing: 'export' | '@entity', tsNode: ts.Node) {
		const info: IgnoredEntity = { tsNode, missing };
		const v = IGNORED_ENTITIES.get(name);
		if (v == null) IGNORED_ENTITIES.set(name, [info]);
		else v.push(info);
	}

	/** @private Get node type, support generics */
	function _nodeType(parentNode: ts.TypeNode, type: ts.Type): ts.TypeNode {
		try {
			return typeChecker.typeToTypeNode(
				type, parentNode,
				ts.NodeBuilderFlags.AllowUniqueESSymbolType | ts.NodeBuilderFlags.UseAliasDefinedOutsideCurrentScope
			) ?? parentNode;
		} catch (err) {
			console.error('TYPE ERROR>>', err);
			console.log('===', typeChecker.typeToString(type));
			console.log('===', parentNode.getText());
			return parentNode;
		}
	}

	/** @private Get node full qualified name including parent namespace */
	function _getFullQualifiedName(tsNode: ts.Node): string {
		const entityName = _getNodeName(tsNode);
		if (tsNode.parent.kind === ts.SyntaxKind.SourceFile) return entityName;
		else {
			let n: string[] = [entityName];
			let p: ts.Node = tsNode;
			while ((p = p.parent) && p.kind !== ts.SyntaxKind.SourceFile) {
				if (ts.isModuleDeclaration(p) && p.name != null) {
					n.push(p.name.getText());
				}
			}
			return n.reverse().join('.');
		}
	}

	/** @private return lib path */
	function _getImportLib(typeName: ts.EntityName): { lib: string, name: string } | undefined {
		const importSpecifier = typeChecker.getSymbolAtLocation(typeName)?.declarations?.[0];
		if (importSpecifier != null && ts.isImportSpecifier(importSpecifier)) {
			return {
				lib: importSpecifier.parent.parent.parent.moduleSpecifier.getText().slice(1, -1),
				name: (importSpecifier.propertyName ?? importSpecifier.name).getText()
			}
		}
	}
}

/**
 * Queue
 */
interface QueueItem {
	/** Is input field */
	isInput: boolean
	/** if methods are "resolvers", "validators" or ignore them (entity methods for internal use) */
	isImplementation: boolean,
	/** parent node */
	parentNode?: Node
	/** Typescript node */
	tsNode: ts.Node
	/** Node type */
	tsNodeType?: ts.Type
	/** Node symbol: useful for generics */
	tsNodeSymbol?: ts.Symbol
	/** Entity name: use for nameless objects */
	entityName?: string
}

/** Ignored entities */
export interface IgnoredEntity {
	tsNode: ts.Node,
	/** Ignored due to missing export keyword or @entity jsDoc tag */
	missing: 'export' | '@entity'
}

/** Nameless literal objects */
export interface LiteralObject {
	entity: ObjectNode,
	isInput: boolean,
	ref: RefNode
}

/** Get node name signature */
export type GetNodeNameSignature = (node: ts.Node) => string


//* Merge jsDoc tags
function _mergeJsDocTags(target: Map<string, (string | undefined)[]>, src: Map<string, (string | undefined)[]>) {
	src.forEach(function (value, key) {
		const v = target.get(key);
		if (v == null) target.set(key, value);
		else v.push(...value);
	});
}
