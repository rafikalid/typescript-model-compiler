import { getNodePath } from "@utils/node-path";
import ts from "typescript";
import type { Compiler } from "..";
import { Kind } from "./kind";
import { Annotation, DefaultScalarNode, EnumMemberNode, FieldType, ListNode, MethodNode, Node, ObjectNode, ParamNode, RefNode, ResolverClassNode, RootNode, ScalarNode, UnionNode, ValidatorClassNode } from "./model";
import { cleanType, doesTypeHaveNull } from "./utils";
import { defaultScalars } from 'tt-model';

const LITERAL_ENTITY_DEFAULT_NAME = 'NAMELESS';

/** 
 * Parse schema
 */
export function parseSchema(compiler: Compiler, program: ts.Program, files: readonly string[]) {
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
	const HELPER_CLASSES: (ResolverClassNode | ValidatorClassNode | ScalarNode | UnionNode)[] = [];
	const LITERAL_OBJECTS: LiteralObject[] = [];
	/** Save reference for check */
	const INPUT_REFERENCES: Map<string, ts.Node> = new Map();
	const OUTPUT_REFERENCES: Map<string, ts.Node> = new Map();
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
					const implemented = _getImplementedEntities(entityNode);
					let entity: Node | undefined;
					let isImplementation: boolean; // If is @entity or @resolver or validators
					if (implemented.type === HelperClass.ENTITY) {
						// Check if has @entity jsDoc tag
						if (jsDocTags == null) {
							_ignoreEntity(entityName, '@entity', tsNode);
							continue rootLoop;
						}
						else if (jsDocTags.has('resolvers')) {
							isImplementation = true; // If methods are resolvers or entity methods
							if (isInput) continue rootLoop;// Not an input class
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
					} else {
						let kind: Kind;
						switch (implemented.type) {
							case HelperClass.RESOLVERS:
								// Check jsDoc annotations
								if (jsDocTags != null) {
									if (jsDocTags.has('input')) throw `Could not use "@input" with "resolversOf" at: ${getNodePath(entityNode)}`;
									if (jsDocTags.has('entity')) throw `Could not use "@entity" with "resolversOf" at: ${getNodePath(entityNode)}`;
								}
								if (isInput) continue rootLoop;
								kind = Kind.RESOLVER_CLASS;
								break;
							case HelperClass.VALIDATORS:
								// Check jsDoc annotations
								if (jsDocTags != null) {
									if (jsDocTags.has('output')) throw `Could not use "@output" with "validatorsOf" at: ${getNodePath(entityNode)}`;
									if (jsDocTags.has('entity')) throw `Could not use "@entity" with "validatorsOf" at: ${getNodePath(entityNode)}`;
								}
								if (!isInput) continue rootLoop;
								kind = Kind.VALIDATOR_CLASS;
								break;
							case HelperClass.SCALAR:
								if (jsDocTags != null) {
									if (jsDocTags.has('output')) throw `Could not use "@output" with "Scalar" at: ${getNodePath(entityNode)}`;
									if (jsDocTags.has('input')) throw `Could not use "@input" with "Scalar" at: ${getNodePath(entityNode)}`;
									if (jsDocTags.has('entity')) throw `Could not use "@entity" with "Scalar" at: ${getNodePath(entityNode)}`;
								}
								kind = Kind.SCALAR;
								break;
							case HelperClass.UNION:
								if (jsDocTags != null) {
									if (jsDocTags.has('output')) throw `Could not use "@output" with "Union" at: ${getNodePath(entityNode)}`;
									if (jsDocTags.has('input')) throw `Could not use "@input" with "Union" at: ${getNodePath(entityNode)}`;
									if (jsDocTags.has('entity')) throw `Could not use "@entity" with "Union" at: ${getNodePath(entityNode)}`;
								}
								kind = Kind.UNION;
								break;
							default: {
								let n: never = implemented.type;
								continue rootLoop;
							}
						}
						// Entity
						//Entity
						const entity2 = {
							kind,
							name: entityName,
							isInput,
							jsDoc,
							jsDocTags,
							tsNodes: [entityNode],
							entities: implemented.entities,
							annotations,
							fields: new Map()
						};
						entity = entity2;
						HELPER_CLASSES.push(entity2);
						isImplementation = true;
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
				case ts.SyntaxKind.PropertyDeclaration:
				case ts.SyntaxKind.MethodDeclaration:
				case ts.SyntaxKind.PropertySignature:
				case ts.SyntaxKind.MethodSignature: {
					const propertyNode = tsNode as ts.PropertySignature | ts.MethodDeclaration | ts.PropertyDeclaration;
					if (parentNode == null) continue rootLoop;
					if (
						parentNode.kind != Kind.OBJECT &&
						parentNode.kind != Kind.VALIDATOR_CLASS &&
						parentNode.kind != Kind.RESOLVER_CLASS &&
						parentNode.kind != Kind.SCALAR &&
						parentNode.kind != Kind.UNION
					)
						throw `Unexpected parent node "${Kind[parentNode.kind]}" for property "${_getNodeName(tsNode)}" at ${getNodePath(tsNode)}`;
					if (entityName == null)
						throw `Missing name for property at ${getNodePath(tsNode)}`;
					const className = (propertyNode.parent as ts.ClassLikeDeclaration).name?.getText();
					//* Method
					let propMethod: ts.Node | undefined = tsNode;
					let isMethod = false;
					let propType: ts.Type;
					let propSignature: ts.Signature | undefined;
					let propTypeNode = propertyNode.type;
					if (
						ts.isMethodDeclaration(propMethod) ||
						(
							(propMethod = (propMethod as ts.PropertySignature).initializer) &&
							(
								ts.isFunctionLike(propMethod) ||
								(propMethod = typeChecker.getTypeAtLocation(propMethod).symbol?.declarations?.[0]) &&
								ts.isFunctionLike(propMethod)
							)
						)
					) {
						isMethod = true;
						propSignature = typeChecker.getSignatureFromDeclaration(propMethod);
						if (propSignature == null) throw `Fail to get method signature at ${getNodePath(tsNode)}`;
						propType = typeChecker.getReturnTypeOfSignature(propSignature);
						propTypeNode = typeChecker.typeToTypeNode(propType, tsNode, undefined);
						if (propTypeNode == null)
							throw `Could not resolve typeNode for type ${typeChecker.typeToString(propType)} at ${getNodePath(tsNode)}`;
					} else if (propTypeNode != null) {
						propType = typeChecker.getTypeAtLocation(propTypeNode);
					} else {
						throw `Please define the type of ${parentNode.name}.${entityName} at ${getNodePath(tsNode)}`;
						// throw `To minimize errors, please define explicitly the return value for ${parentNode.name}.${entityName} at ${getNodePath(tsNode)}`;
					}
					//* Get type info
					const cleanedType = cleanType(typeChecker, propType);
					//* Method
					let method: MethodNode | undefined;
					if (isMethod) {
						// Ignore if is entity (not implementation)
						if (!isImplementation) continue rootLoop;
						if (className == null) throw `Unexpected anonymous class for method implementation at ${getNodePath(tsNode)}`;
						method = {
							kind: Kind.METHOD,
							class: className,
							name: entityName,
							isStatic: tsNode.modifiers?.some(n => n.kind === ts.SyntaxKind.StaticKeyword) ?? false,
							params: [],
							tsNode: tsNode,
							type: {
								kind: Kind.REF,
								isAsync: cleanedType.hasPromise,
								isInput,
								jsDoc,
								jsDocTags,
								name: cleanedType.name,
								tsNodes: [tsNode]
							}
						};
						// Resolve params
						propSignature!.parameters?.forEach(param => {
							const d = param.declarations?.[0];
							if (d == null)
								throw `Fail to get param ${param.name} at ${getNodePath(tsNode)}`
							Q.push({
								isImplementation,
								isInput,
								tsNode: d,
								entityName: param.name,
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
						parentNode.fields.set(entityName, field);
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
						tsNode: propTypeNode,//_nodeType(propType, tsNodeType),
						entityName,
						parentNode: field,
						tsNodeType: propType //tsNodeType
					});
					break;
				}
				case ts.SyntaxKind.Parameter: {
					if (parentNode == null || parentNode.kind != Kind.METHOD)
						throw `Expected parentNode for PARAM as METHOD or FUNCTION. get ${parentNode == null ? 'undefined' : Kind[parentNode.kind]} at: ${getNodePath(tsNode)}`;
					const paramNode = tsNode as ts.ParameterDeclaration;
					const isOptional = paramNode.questionToken != null || paramNode.type == null ||
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
					//* Remove null, undefined and Promise
					const cleanResult = cleanType(typeChecker, tsNodeType);
					const types = cleanResult.types;
					const typesLen = types.length;
					if (typesLen === 0)
						throw `Field has empty type: "${_getNodeName(tsNode)}" at ${getNodePath(tsNode)}`;
					const typeName = cleanResult.name;
					let staticValue: string | number | undefined
					if (typesLen == 1) {
						// Check if static value
						const tp = types[0];
						const dec = tp.symbol?.valueDeclaration;
						if (dec == null) { }
						else if (dec.kind === ts.SyntaxKind.EnumMember)
							staticValue = typeChecker.getConstantValue(dec as ts.EnumMember);
						else if (dec.kind === ts.SyntaxKind.NumericLiteral)
							staticValue = Number((dec as ts.NumericLiteral).text);
						else if (dec.kind === ts.SyntaxKind.StringLiteral)
							staticValue = (dec as ts.StringLiteral).text;
					}
					// TODO resolve generics (including arrays)
					//* Add as reference
					let tpRef: FieldType;
					if (staticValue == null) {
						tpRef = {
							kind: Kind.REF,
							isInput,
							jsDoc,
							jsDocTags,
							name: typeName,
							tsNodes: [tsNode],
							isAsync: cleanResult.hasPromise
						};
						//* Add reference for check
						(isInput ? INPUT_REFERENCES : OUTPUT_REFERENCES).set(typeName, tsNode);
						//* resolve generics
						types.forEach(type => {
							if ((type as ts.TypeReference).typeArguments?.length) {
								const typeRef = type as ts.TypeReference;
								const typeRefNode = typeChecker.typeToTypeNode(typeRef, undefined, undefined);
								if (typeRefNode == null)
									errors.push(`Could not create node from type ${typeChecker.typeToString(type)} at ${getNodePath(tsNode)}`);
								else {
									const typeName = _getNodeName(typeRefNode);
									const targetMap = isInput ? INPUT_ENTITIES : OUTPUT_ENTITIES;
									if (targetMap.has(typeName)) { }
									else if (ts.isArrayTypeNode(typeRefNode)) {
										Q.push({
											isInput,
											tsNode: typeRefNode,
											tsNodeType: type,
											entityName: typeName,
											parentNode: undefined,
											tsNodeSymbol: type.symbol,
											isImplementation
										});
									} else {
										//* Resolve generics
										const entity: ObjectNode = {
											kind: Kind.OBJECT,
											annotations: [],
											fields: new Map(),
											inherit: [],
											isClass: false,
											isInput,
											jsDoc: [], //TODO get from original entity
											jsDocTags: new Map(), //TODO get from original tag
											name: typeName,
											tsNodes: []// TODO get from original entity
										};
										targetMap.set(typeName, entity);
										type.getProperties().forEach(s => {
											const dec = s.valueDeclaration ?? s.declarations?.[0] as ts.PropertyDeclaration | undefined;
											if (dec == null) {
												errors.push(`Could not find property declaration for "${typeName}.${s.name}" at ${getNodePath(tsNode)}`);
												return;
											}
											const propType = typeChecker.getTypeOfSymbolAtLocation(s, typeRefNode);
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
									}
								}
							}
						});
					} else {
						tpRef = {
							kind: Kind.STATIC_VALUE,
							isInput,
							jsDoc,
							jsDocTags,
							isAsync: cleanResult.hasPromise,
							name: typeName,
							value: staticValue,
							tsNodes: [tsNode]
						};
					}
					parentNode.type = tpRef;
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
						tsNodes: [tsNode],
						isAsync: false
					};
					parentNode.type = type;
					break;
				}
				case ts.SyntaxKind.ArrayType: {
					// if (parentNode == null) continue rootLoop;
					// if (
					// 	parentNode.kind !== Kind.FIELD &&
					// 	parentNode.kind !== Kind.LIST &&
					// 	parentNode.kind !== Kind.PARAM
					// )
					// 	throw `Unexpected parent node "${Kind[parentNode.kind]}" for "ArrayType" at: ${getNodePath(tsNode)}`;
					const targetMap = isInput ? INPUT_ENTITIES : OUTPUT_ENTITIES;
					const entityName = typeChecker.typeToString(tsNodeType);
					if (!targetMap.has(entityName)) {
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
							name: typeChecker.typeToString(arrType),
							type: undefined
						};
						targetMap.set(entityName, listNode);
						// parentNode.type = listNode;
						Q.push({
							isImplementation,
							isInput,
							tsNode: arrEl, //_nodeType(arrEl, arrType),
							tsNodeType: arrType,
							entityName,
							parentNode: listNode
						});
					}
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
					const name = entityName ?? LITERAL_ENTITY_DEFAULT_NAME;
					const entity: ObjectNode = {
						kind: Kind.OBJECT,
						annotations,
						name: name,
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
						name: name,
						isInput,
						jsDoc,
						jsDocTags,
						tsNodes: [tsNode],
						isAsync: false
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

	//* Add helpers
	HELPER_CLASSES.forEach(function (helper) {
		const targetMap = helper.isInput ? INPUT_ENTITIES : OUTPUT_ENTITIES;
		switch (helper.kind) {
			case Kind.SCALAR: {
				helper.entities.forEach(name => {
					if (targetMap.has(name))
						errors.push(`Duplicated entity scalar "${name}" at ${getNodePath(helper.tsNodes)} and ${getNodePath(targetMap.get(name)!.tsNodes)}`);
					else
						targetMap.set(name, helper);
				});
				break;
			}
			case Kind.UNION: {
				helper.entities.forEach(name => {
					if (targetMap.has(name))
						errors.push(`Duplicated entity union "${name}" at ${getNodePath(helper.tsNodes)} and ${getNodePath(targetMap.get(name)!.tsNodes)}`);
					else
						targetMap.set(name, helper);
				});
				break;
			}
			case Kind.RESOLVER_CLASS:
			case Kind.VALIDATOR_CLASS: {
				const isResolvers = helper.kind === Kind.RESOLVER_CLASS;
				helper.entities.forEach(name => {
					const entity = targetMap.get(name);
					if (entity == null) {
						const ignoredEntity = IGNORED_ENTITIES.get(name);
						if (ignoredEntity == null)
							errors.push(`Missing ${isResolvers ? 'output' : 'input'} entity "${name}" has ${isResolvers ? 'resolvers' : 'validators'} at ${getNodePath(helper.tsNodes)}`);
						else
							ignoredEntity.forEach(e => {
								errors.push(`Missing ${e.missing === '@entity' ? '"@entity" or "@resolvers" jsDoc tag' :
									e.missing === 'export' ? '"export" keyword' :
										'Something'
									} on entity ${name} at ${getNodePath(e.tsNode)}`);
							});
					} else if (entity.kind !== Kind.OBJECT)
						errors.push(`Could not add ${isResolvers ? 'resolvers' : 'validators'} to ${Kind[entity.kind]} at ${getNodePath(entity.tsNodes)}`);
					else {
						if (helper.jsDocTags != null)
							_mergeJsDocTags(entity.jsDocTags, helper.jsDocTags);
						entity.annotations.push(...helper.annotations);
						// Merge fields
						const fields = entity.fields;
						helper.fields.forEach((field, fieldName) => {
							const targetField = fields.get(fieldName);
							if (targetField == null) {
								fields.set(fieldName, field);
							} else if (targetField.method != null)
								errors.push(`Field ${entity.name}.${fieldName} already has a ${isResolvers ? 'resolver' : 'validator'} at ${getNodePath(targetField.tsNodes)}. ${isResolvers ? 'resolver' : 'validator'} at ${getNodePath(field.tsNodes)}`);
							else {
								targetField.method = field.method;
								targetField.jsDoc.push(...field.jsDoc);
								targetField.annotations.push(...field.annotations);
								// jsDoc tags
								if (targetField.jsDocTags == null) targetField.jsDocTags = field.jsDocTags;
								else if (field.jsDocTags != null) _mergeJsDocTags(targetField.jsDocTags, field.jsDocTags);
							}
						});
					}
				});
				break;
			}
			default: {
				let n: never = helper;
			}
		}
	});
	//* Add default scalars
	Object.keys(defaultScalars).forEach(scalarName => {
		// Create entity
		const entity: DefaultScalarNode = {
			kind: Kind.DEFAULT_SCALAR,
			name: scalarName,
			class: defaultScalars[scalarName as keyof typeof defaultScalars],
			isInput: false,
			jsDoc: [],
			jsDocTags: undefined,
			tsNodes: []
		}
		// Add to input entities
		if (!INPUT_ENTITIES.has(scalarName)) INPUT_ENTITIES.set(scalarName, entity);
		// Add to output entities
		if (!OUTPUT_ENTITIES.has(scalarName)) OUTPUT_ENTITIES.set(scalarName, entity);
	});
	//* Check for missing entities
	INPUT_REFERENCES.forEach((tsNode, ref) => {
		if (!INPUT_ENTITIES.has(ref))
			errors.push(`Missing input entity ${ref} referenced at ${getNodePath(tsNode)}`);
	});
	OUTPUT_REFERENCES.forEach((tsNode, ref) => {
		if (!OUTPUT_ENTITIES.has(ref))
			errors.push(`Missing output entity ${ref} referenced at ${getNodePath(tsNode)}`);
	});
	//* Throw errors if found
	if (errors.length) throw new Error(`Parsing Errors: \n\t - ${errors.join('\n\t- ')}`);
	//* Add nameless entities
	LITERAL_OBJECTS.forEach(({ isInput, ref, entity }) => {
		const targetMap = isInput ? INPUT_ENTITIES : OUTPUT_ENTITIES;
		const entityName = entity.name;
		let name = entityName;
		let i = 0;
		do {
			if (targetMap.has(name)) {
				name = `${entityName}_${++i}`;
			} else {
				entity.name = ref.name = name;
				targetMap.set(name, entity);
				break;
			}
		} while (true);
	});
	//* Return
	return {
		input: INPUT_ENTITIES,
		output: OUTPUT_ENTITIES,
		// ignored: IGNORED_ENTITIES
		// HELPER_CLASSES
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

	/** @private get type name */
	function _getGenuineTypeName(tsTypeNode: ts.TypeNode): string {
		return typeChecker.typeToString(typeChecker.getTypeFromTypeNode(tsTypeNode));
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
	function _getImportLib(typeName: ts.Node) {
		const importSpecifier = typeChecker.getSymbolAtLocation(typeName)?.declarations?.[0];
		if (importSpecifier != null && ts.isImportSpecifier(importSpecifier)) {
			const lib = importSpecifier.parent.parent.parent.moduleSpecifier.getText().slice(1, -1);
			return {
				name: lib,
				isFromPackage: compiler._isPackageName(lib),
				propertyName: (importSpecifier.propertyName ?? importSpecifier.name).getText()
			}
		}
	}

	/** Sort type as union */
	function _typeSort(a: string, b: string): number {
		return a.localeCompare(b);
	}

	/**
	 * Check if a class is a helper class
	 */
	function _getImplementedEntities(tsEntity: ts.ClassDeclaration | ts.InterfaceDeclaration): { type: HelperClass, entities: string[] } {
		const entities: string[] = [];
		let resultType = HelperClass.ENTITY;
		tsEntity.heritageClauses?.forEach(close => {
			close.types.forEach(type => {
				//* Get type and name
				const lib = _getImportLib(type.expression)
				//* check if from
				let cType: HelperClass;
				if (!lib?.isFromPackage) {
					cType = HelperClass.ENTITY;
					entities.push(_getGenuineTypeName(type));
				} else switch (lib.propertyName) {
					case 'ValidatorsOf':
					case 'ResolversOf': {
						const isInterface = tsEntity.kind === ts.SyntaxKind.InterfaceDeclaration;
						if (isInterface)
							throw `An interface could not extends "${lib.propertyName}" at: ${getNodePath(type)}`;
					}
					case 'Scalar':
					case 'Union': {
						const targetType = type.typeArguments?.[0];
						if (targetType == null)
							throw `Missing type for "${lib.propertyName}" at: ${getNodePath(type)}`;
						entities.push(_getGenuineTypeName(targetType));
						switch (lib.propertyName) {
							case 'ValidatorsOf': cType = HelperClass.VALIDATORS; break;
							case 'ResolversOf': cType = HelperClass.RESOLVERS; break;
							case 'Scalar': cType = HelperClass.SCALAR; break;
							case 'Union': cType = HelperClass.UNION; break;
							default: {
								let n: never = lib.propertyName;
								cType = HelperClass.ENTITY;// Make typescript happy :D
							}
						}
						break;
					}
					default: {
						cType = HelperClass.ENTITY;
						entities.push(_getGenuineTypeName(type));
					}
				}
				// Check implements same generics
				if (resultType !== cType && resultType !== HelperClass.ENTITY)
					throw `Could not implement "ResolversOf", "ValidatorsOf", "Scalar" and "Union" at the same time. at ${getNodePath(tsEntity)}`;
				resultType = cType;
			});
		});
		return { type: resultType, entities };
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

/** Helper class return value */
export enum HelperClass {
	RESOLVERS,
	VALIDATORS,
	ENTITY,
	SCALAR,
	UNION
}