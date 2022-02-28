//** PARSE TYPESCRIPT DATA

import { E, errorFile, TError } from "@src/utils/error";
import { warn } from "@src/utils/log";
import ts from "typescript";
import { AssertOptions, BasicScalar, Enum, EnumMember, InputField, Kind, List, MethodDescriptor, Node, OutputField, Param, Reference, Scalar, Union, InputNode, InputObject, OutputObject, OutputNode, AllNodes } from './model';
import { NodeVisitor } from "./visitor";
import Yaml from 'yaml';
const parseYaml = Yaml.parse;
//@ts-ignore
import { DEFAULT_SCALARS, RootConfig as RootConfigTTModel } from "tt-model";
import { FunctionExpr, RootConfig } from "..";
import { PACKAGE_NAME } from "@src/config";

const IS_OF_TYPE_NULL = ts.TypeFlags.Undefined | ts.TypeFlags.Null;

/** Function name validator */
const FX_REGEX = /^\w+$/;

/**
 * Extract Model from typescript code
 */
export function parse(files: readonly string[], program: ts.Program) {
	//* Init
	const INPUT_ENTITIES: Map<string, InputNode> = new Map();
	const OUTPUT_ENTITIES: Map<string, OutputNode> = new Map();
	/** Contains validator functions */
	const INPUT_VALIDATORS: Map<string, FunctionExpr> = new Map();
	/** Contains resolver functions */
	const OUTPUT_RESOLVERS: Map<string, FunctionExpr> = new Map();
	//* Literal objects had no with missing name like Literal objects
	const LITERAL_OBJECTS: { node: InputObject | OutputObject, isInput: boolean | undefined, ref: Reference }[] = [];
	/** Root wrappers: wrap root controller */
	const rootConfig: RootConfig = {
		before: [],
		after: [],
		wrappers: []
	};
	/** Helper entities */
	const inputHelperEntities: Map<string, InputObject[]> = new Map();
	const outputHelperEntities: Map<string, OutputObject[]> = new Map();
	/** Print Node Names */
	const tsNodePrinter = ts.createPrinter({
		omitTrailingSemicolon: false,
		removeComments: true
	});
	/** Node Factory */
	const factory = ts.factory;
	/** Type Checker */
	const typeChecker = program.getTypeChecker();
	/** Parsing Errors */
	const errors: string[] = [];
	/** Node Visitor */
	const visitor = new NodeVisitor();
	//* Parse file and put root children into visitor's queue
	for (let i = 0, len = files.length; i < len; ++i) {
		let srcFile = program.getSourceFile(files[i])!;
		visitor.pushChildren(typeChecker, srcFile, undefined, srcFile, undefined, undefined);
	}
	//* Iterate over all nodes
	const it = visitor.it();
	rootLoop: while (true) {
		try {
			//* Get next item
			let item = it.next();
			if (item.done) break;
			let { node, nodeType, parentDescriptor: pDesc, srcFile, isInput, entityName, isResolversImplementation, propertyType, symbol: nodeSymbol } = item.value;
			let fileName = srcFile.fileName;
			if (nodeSymbol == null) nodeSymbol = nodeType.symbol;
			//* Extract jsDoc && Metadata
			let asserts: string[] | undefined;
			let deprecated: string | undefined;
			let defaultValue: string | undefined;
			let fieldAlias: string | undefined;
			let jsDoc: string[] = nodeSymbol?.getDocumentationComment(typeChecker).map(e => e.text) ?? [];
			/** Do order fields by name */
			let orderByName: boolean | undefined;
			// Parse JsDocTags
			let jsDocTags = nodeSymbol?.getJsDocTags();
			let resolverFx: string[] = [];
			let validatorFx: string[] = [];
			if (jsDocTags != null && jsDocTags.length) {
				for (let i = 0, len = jsDocTags.length; i < len; ++i) {
					let tag = jsDocTags[i];
					let tagText = tag.text?.map(c => c.text).join("\n").trim();
					jsDoc.push(tag.text == null ? `@${tag.name}` : `@${tag.name} ${tagText}`);
					switch (tag.name) {
						case 'ignore':
						case 'virtual':
							// Ignore this Node
							continue rootLoop;
						case 'deprecated':
							deprecated = tagText ?? '';
							break;
						case 'assert':
							if (tagText) {
								// FIXME check using multiple lines for jsdoc tag
								if (!tagText.startsWith('{'))
									tagText = `{${tagText}}`;
								(asserts ??= []).push(tagText);
							}
							break;
						case 'default':
							defaultValue = tagText;
							break;
						case 'input':
							if (isInput === false) continue rootLoop;
							isInput = true;
							break;
						case 'output':
							if (isInput === true) continue rootLoop;
							isInput = false;
							break;
						case 'alias':
							if (tagText) {
								let t = tagText.match(/^\w+/);
								if (t != null) fieldAlias = t[0];
							}
							break;
						case 'resolvers':
							/** Interpret methods as resolvers */
							isResolversImplementation = true;
							break;
						case 'ordered':
							orderByName = true;
							break;
						/** Link resolver to an interface field */
						case 'resolver':
							if (tagText == null || !FX_REGEX.test(tagText))
								throw `Illegal resolver's name "${tagText}" at ${errorFile(srcFile, node)}`;
							resolverFx.push(tagText);
							break;
						case 'inputValidator':
							if (tagText == null || !FX_REGEX.test(tagText))
								throw `Illegal validator's name "${tagText}" at ${errorFile(srcFile, node)}`;
							validatorFx.push(tagText);
							break;
						// default:
						// 	console.log('>>>ANNOTATION>>', tag.name, '=>', tagText);
						// 	break;
					}
				}
			}
			// ADD decorators as part of description
			node.decorators?.forEach(function (deco) {
				jsDoc.push(deco.getText());
			});
			//* Parse Node Specific Info
			switch (node.kind) {
				case ts.SyntaxKind.InterfaceDeclaration:
				case ts.SyntaxKind.ClassDeclaration: {
					if (
						node.modifiers == null ||
						node.modifiers.every(modifier => modifier.kind !== ts.SyntaxKind.ExportKeyword)
					) {
						warn(`Ignored ${ts.SyntaxKind[node.kind]} due to missing "export" keyword at ${errorFile(srcFile, node)}`);
						continue rootLoop;
					}
					let nodeEntity = node as ts.ClassDeclaration | ts.InterfaceDeclaration;
					//* Check if it is a helper entity (class that implements ValidatorsOf or ResolversOf)
					let implementedEntities: string[] | undefined = undefined;
					let inheritedEntities: string[] | undefined = undefined;
					if (nodeEntity.heritageClauses != null) {
						let isInterface = ts.isInterfaceDeclaration(node);
						for (let i = 0, clauses = nodeEntity.heritageClauses, len = clauses.length; i < len; ++i) {
							for (let j = 0, types = clauses[i].types, jLen = types.length; j < jLen; ++j) {
								let type = types[j];
								let typeSymbol = typeChecker.getSymbolAtLocation(type.expression);
								if (typeSymbol == null || typeSymbol.name == null)
									throw `Could not resolve type "${type.expression.getText()}" at ${errorFile(srcFile, type)}`;
								switch (typeSymbol.name) {
									case 'ValidatorsOf':
									case 'ResolversOf': {
										let resolverConfig = typeSymbol.name;
										if (isInterface)
											throw `An interface could not extends "${resolverConfig}". at ${errorFile(srcFile, type)}`;
										let isResolversOf = resolverConfig === 'ResolversOf';
										if (isInput === isResolversOf)
											throw `Could not implement "${resolverConfig}" for ${isResolversOf ? 'output' : 'input'} only entities. at ${errorFile(srcFile, type)}`;
										let t = type.typeArguments![0] as ts.TypeReferenceNode;
										// if (!ts.isTypeReferenceNode(t) || !typeChecker.getTypeFromTypeNode(t).isClassOrInterface())
										// 	throw `Expected "${resolverConfig}" argument to reference a "class" or "interface" at ${errorFile(srcFile, t)}`;
										// let typeName = typeChecker.getSymbolAtLocation(t.typeName)!.name;
										(implementedEntities ??= []).push(_getNodeName(t.typeName, srcFile));
										isInput = !isResolversOf;
										break;
									}
									default: {
										let refName = _getNodeName(type, srcFile);
										(inheritedEntities ??= []).push(refName);
										//TODO resolve referenced entity
										// let nRef: Reference = {
										// 	kind: Kind.REF,
										// 	fileName: fileName,
										// 	name: typeSymbol.name,
										// 	oName: typeSymbol.name,
										// 	fullName: undefined,
										// 	params:
										// 		type.typeArguments == null
										// 			? undefined
										// 			: [],
										// 	visibleFields: undefined
										// };
										// visitor.push(type.typeArguments, nRef, srcFile);
										// (inherited ??= []).push(nRef);
										// //TODO resolve real nodes names
										// jsDoc.push(`@Extends ${type.getText()}`);
									}
								}
							}
						}
					}

					// Get entity name
					if (entityName == null) {
						if (nodeEntity.name == null) throw `Unexpected anonymous class at ${errorFile(srcFile, node)}`;
						entityName = nodeEntity.name.getText();
					}
					// Get qualified name
					entityName = _getEntityQualifiedName(nodeEntity, entityName);
					// Check if is entity or entity implementation (ie: resolvers or generic entity)
					let isImplementation = implementedEntities != null;
					isResolversImplementation = isImplementation || isResolversImplementation; // Set by @entity or helper class
					if (!isImplementation && nodeEntity.typeParameters?.length) {
						isImplementation = true;
						implementedEntities = [entityName];
					}
					// Resolve: First we check for INPUT and than for OUTPUT
					for (let k = 0, isResolveInput = false; k < 2; k++) {
						// Escape if is explicitly input or output and we checking for other type
						if (isInput === !isResolveInput) continue;
						type ObjectType = InputObject | OutputObject;
						let TARGET_MAP = isResolveInput ? INPUT_ENTITIES : OUTPUT_ENTITIES;
						let entity: InputNode | OutputNode | undefined;
						if (!isImplementation) entity = TARGET_MAP.get(entityName);
						if (entity == null) {
							entity = {
								kind: isResolveInput ? Kind.INPUT_OBJECT : Kind.OUTPUT_OBJECT,
								name: entityName,
								escapedName: escapeEntityName(entityName),
								fields: new Map(),
								deprecated: deprecated,
								fileNames: [fileName],
								inherit: inheritedEntities,
								jsDoc: jsDoc,
								wrappers: undefined,
								before: undefined,
								after: undefined,
								ownedFieldsCount: 0,
								orderByName,
								convert: undefined
							};
							if (isImplementation) {
								let targetM = (isResolveInput ? inputHelperEntities : outputHelperEntities) as Map<string, InputObject[] | OutputObject[]>;
								for (let l = 0, lLen = implementedEntities!.length; l < lLen; ++l) {
									let entityName = implementedEntities![l];
									let targetLst = targetM.get(entityName);
									if (targetLst == null) targetM.set(entityName, [entity as InputObject]);
									else (targetLst as InputObject[]).push(entity as InputObject);
								}
							}
							else
								(TARGET_MAP as Map<string, ObjectType>).set(entityName, entity as ObjectType);
						} else if (entity.kind === Kind.SCALAR) {
							// Do nothing, just keep entity as scalar
							break;
						} else if (entity.kind !== (isResolveInput ? Kind.INPUT_OBJECT : Kind.OUTPUT_OBJECT)) {
							throw `Entity "${entityName}" has multiple types:\n\t> ${isResolveInput ? 'INPUT_OBJECT' : 'OUTPUT_OBJECT'
							} at : ${fileName}\n\t> ${Kind[entity.kind]} at ${entity.fileNames.join(', ')}`;
						} else {
							if (inheritedEntities != null)
								(entity.inherit ??= []).push(...inheritedEntities);
							entity.fileNames.push(fileName);
							entity.deprecated ??= deprecated;
							entity.orderByName ??= orderByName;
							// JsDoc
							entity.jsDoc.push(...jsDoc);
						}
						// Go through properties
						for (let i = 0, props = nodeType.getProperties(), len = props.length; i < len; ++i) {
							let s = props[i];
							let dec = s.valueDeclaration ?? s.declarations?.[0];
							if (dec == null) continue;
							let propType = typeChecker.getTypeOfSymbolAtLocation(s, node);
							visitor.push(dec, propType, entity, srcFile, isResolveInput, s.name, isResolversImplementation, undefined, s);
						}
						// next: resolve input
						isResolveInput = true;
					}
					break;
				}
				case ts.SyntaxKind.PropertySignature:
				case ts.SyntaxKind.MethodDeclaration:
				case ts.SyntaxKind.PropertyDeclaration: {
					if (pDesc == null) continue;
					if (
						pDesc.kind !== Kind.INPUT_OBJECT &&
						pDesc.kind !== Kind.OUTPUT_OBJECT
					)
						continue;
					if (entityName == null) {
						throw `Unexpected missing field name at ${errorFile(srcFile, node)}`;
					}
					let propertyNode = node as ts.PropertySignature | ts.MethodDeclaration | ts.PropertyDeclaration;
					let className = (propertyNode.parent as ts.ClassLikeDeclaration).name?.getText();
					let method: MethodDescriptor | undefined;
					let isMethod = node.kind === ts.SyntaxKind.MethodDeclaration;
					if (isMethod) {
						if (isResolversImplementation) {
							if (className == null) throw `Missing class name for method "${pDesc.name}.${entityName}" at ${errorFile(srcFile, node)}`;
							method = {
								fileName: fileName,
								className: className,
								name: entityName,
								isAsync: _hasPromise(node as ts.MethodDeclaration),
								isStatic: node.modifiers?.some(
									n => n.kind === ts.SyntaxKind.StaticKeyword
								) ?? false,
								isClass: ts.isClassDeclaration(node.parent) && !node.parent.modifiers?.some(
									e => e.kind === ts.SyntaxKind.AbstractKeyword
								)
							};
						} else {
							continue rootLoop; // Ignore this method cause it's only an instance method
						}
					}
					// Create field
					let fields = pDesc.fields;
					let field = fields.get(entityName);
					if (field == null) {
						//* Add property
						if (isInput) {
							let p: Omit<InputField, 'type'> & { type: undefined } = {
								kind: Kind.INPUT_FIELD,
								name: entityName,
								required: (node as ts.PropertyDeclaration).questionToken ? false : _isRequired(propertyType ?? nodeType),
								alias: fieldAlias,
								idx: pDesc.ownedFieldsCount++,
								className: className,
								defaultValue: defaultValue,
								type: undefined,
								asserts: asserts && _compileAsserts(asserts, undefined, srcFile, node),
								deprecated: deprecated,
								jsDoc: jsDoc,
								pipe: method == null ? [] : [method],
								fileNames: [fileName],
								validators: validatorFx
							};
							field = p as any as InputField | OutputField
						} else {
							let p: Omit<OutputField, 'type'> & { type: undefined } = {
								name: entityName,
								kind: Kind.OUTPUT_FIELD,
								required: (node as ts.PropertyDeclaration).questionToken ? false : _isRequired(propertyType ?? nodeType),
								alias: fieldAlias,
								idx: pDesc.ownedFieldsCount++,
								className: className,
								defaultValue: defaultValue,
								type: undefined,
								method: method,
								param: undefined,
								deprecated: deprecated,
								jsDoc: jsDoc,
								fileNames: [fileName],
								resolvers: resolverFx
							};
							field = p as any as InputField | OutputField;
						}
						(fields as Map<string, OutputField | InputField>).set(entityName, field);
					} else {
						//* Field alias
						if (field.alias == null) field.alias = fieldAlias;
						else if (field.alias !== fieldAlias)
							throw `Field "${className}.${entityName}" could not have two aliases. got "${field.alias}" and "${fieldAlias}" at ${errorFile(srcFile, node)}`;
						field.deprecated ??= deprecated;
						field.jsDoc.push(...jsDoc);
						field.fileNames.push(fileName);
						if (method != null) {
							if (field.kind === Kind.INPUT_FIELD) {
								field.pipe.push(method);
							} else if (field.method != null) {
								throw `Field "${pDesc.name}.${entityName}" already has an ${isInput ? 'input' : 'output'
								} resolver as "${field.method.className}.${field.method.name}" . Got "${className}.${entityName}" at: ${errorFile(srcFile, node)
								}. Other files:\n\t> ${field.fileNames.join("\n\t> ")}`;
							} else {
								field.method = method;
							}
						}
						if (isInput) {
							if (asserts != null) {
								(field as InputField).asserts = _compileAsserts(
									asserts,
									(field as InputField).asserts,
									srcFile, node
								);
							}
							if (validatorFx.length > 0)
								(field as InputField).validators.push(...validatorFx);
						} else {
							if (resolverFx.length > 0)
								(field as OutputField).resolvers.push(...resolverFx);
						}
					}
					// Resolve param for methods
					if (isMethod) {
						let param = (node as ts.MethodDeclaration).parameters?.[1];
						if (param == null) {
							if (isInput)
								throw `Missing the second argument of "${className}.${entityName}" resolver. At ${errorFile(srcFile, node)}`;
						} else {
							// resolve param as input or output type
							visitor.push(param, typeChecker.getTypeAtLocation(param), field, srcFile, isInput, entityName);
						}
					}
					// Resolve type
					if (propertyNode.type == null) {
						// TODO get implicit return value from method signature
						if (isMethod && !isInput)
							throw `Missing return value of the method "${className}.${entityName}" at ${errorFile(srcFile, node)}`;
					} else if (!isMethod || !isInput) {
						let propertyTypeNode = propertyNode.type;
						if (propertyType == null) propertyType = typeChecker.getTypeAtLocation(propertyNode.type);
						else {
							propertyTypeNode = typeChecker.typeToTypeNode(
								propertyType, propertyTypeNode,
								ts.NodeBuilderFlags.AllowUniqueESSymbolType | ts.NodeBuilderFlags.UseAliasDefinedOutsideCurrentScope
							) ?? propertyTypeNode;
						}
						visitor.push(
							propertyTypeNode, propertyType,
							field, srcFile, isInput, entityName, isResolversImplementation
						);
					}
					break;
				}
				case ts.SyntaxKind.Parameter: {
					if (pDesc == null) continue; // Unexpected!
					let paramNode = node as ts.ParameterDeclaration;
					let paramName = paramNode.name?.getText();
					switch (pDesc.kind) {
						case Kind.OUTPUT_FIELD:
						case Kind.FUNCTION_EXPRESSION:
							let pRef: Param = {
								kind: Kind.PARAM,
								name: paramName,
								deprecated: deprecated,
								jsDoc: jsDoc,
								type: undefined,
								fileNames: [fileName]
							};
							// Parse param type
							//TODO resolve parameter generic type
							if (paramNode.type != null)
								visitor.push(paramNode.type, typeChecker.getTypeAtLocation(paramNode.type), pRef, srcFile, true, paramName);
							pDesc.param = pRef;
							break;
						case Kind.INPUT_FIELD:
							// Parse param type
							if (paramNode.type != null)
								visitor.push(paramNode.type, typeChecker.getTypeAtLocation(paramNode.type), pDesc, srcFile, true, paramName);
							break;
						default:
							throw `Unexpected param parent. Got "${Kind[pDesc.kind]}" at ${errorFile(srcFile, node)}`;
					}
					break;
				}
				case ts.SyntaxKind.LastTypeNode:
				case ts.SyntaxKind.TypeReference:
				case ts.SyntaxKind.IntersectionType:
				case ts.SyntaxKind.UnionType: {
					if (pDesc == null) continue;
					if (
						pDesc.kind !== Kind.OUTPUT_FIELD &&
						pDesc.kind !== Kind.INPUT_FIELD &&
						pDesc.kind !== Kind.LIST &&
						pDesc.kind !== Kind.PARAM &&
						pDesc.kind !== Kind.UNION &&
						pDesc.kind !== Kind.CONVERTER &&
						pDesc.kind !== Kind.FUNCTION_EXPRESSION
					)
						continue;
					//* Check if simple type name
					let refTypes = _removePromiseAndNull(nodeType);
					if (refTypes.length === 0) throw `Field has empty type: "${_getNodeName(node, srcFile)}" at ${errorFile(srcFile, node)}`;
					let typeNode = _cleanReference(node as ts.TypeNode)
					if (typeNode == null) throw `Empty Type Declaration: "${_getNodeName(node, srcFile)}" at ${errorFile(srcFile, node)}`;
					let refName = _getNodeName(typeNode, srcFile);
					let targetMap = isInput === true ? INPUT_ENTITIES : OUTPUT_ENTITIES;
					let entity = targetMap.get(refName);
					if (entity == null) {
						//* Check if it's enum
						const enumMembers: ts.EnumMember[] = [];
						{
							let i = 0, len = refTypes.length;
							for (; i < len; ++i) {
								let type = refTypes[i];
								let typeSymbol = type.symbol;
								if (typeSymbol == null) break;
								let typeDec = typeSymbol.valueDeclaration ?? typeSymbol.declarations?.[0];
								if (typeDec == null) break;
								if (ts.isEnumMember(typeDec)) enumMembers.push(typeDec);
								else break;
							}
							let EnumMemberLen = enumMembers.length;
							if (EnumMemberLen > 0 && EnumMemberLen < len) {
								// Contains but not all of theme enum items
								throw `Could not merge ENUM with other types at: "${_getNodeName(node, srcFile)}" at ${errorFile(srcFile, node)}`
							}
						}
						if (enumMembers.length) {
							refName = _getUnionNameFromTypes(refTypes);
							let entity = INPUT_ENTITIES.get(refName);
							if (entity == null) {
								entity = {
									kind: Kind.ENUM,
									name: refName,
									escapedName: escapeEntityName(refName),
									deprecated: deprecated,
									jsDoc: jsDoc,
									members: [],
									fileNames: [fileName]
								};
								INPUT_ENTITIES.set(refName, entity);
								OUTPUT_ENTITIES.set(refName, entity);
								for (let i = 0, len = enumMembers.length; i < len; ++i) {
									let member = enumMembers[i];
									visitor.push(member, refTypes[i], entity, srcFile, undefined, undefined, isResolversImplementation);
								}
							} else if (entity.kind !== Kind.ENUM || OUTPUT_ENTITIES.get(refName) !== entity) {
								throw `Duplicate entity "${refName}" at ${errorFile(srcFile, node)} and ${entity.fileNames.join(', ')}`;
							}
						}
						//* Check are constants
						//* Is reference
						else if (refTypes.length === 1) {
							//* Resolve to a single type
							let type = refTypes[0];
							let typeNode = typeChecker.typeToTypeNode(type, undefined, undefined);
							if (typeNode && typeNode.kind === ts.SyntaxKind.ArrayType) {
								visitor.push(
									typeNode, type, pDesc, srcFile, isInput, entityName, isResolversImplementation
								);
							} else if (
								(
									(type as ts.TypeReference).typeArguments != null ||
									(type as ts.TypeReference).aliasTypeArguments != null
									// (type as any as { typeParameter: any }).typeParameter != null
								) && !targetMap.has(refName)
							) {
								// Resolve generic type
								let entity = _upObjectEntity(isInput, refName, fileName, deprecated, undefined);
								const foundSymbols: Set<string> = new Set();
								for (let j = 0, properties = type.getProperties(), jLen = properties.length; j < jLen; ++j) {
									let property = properties[j];
									let propertyTypeName = property.name;
									if (!foundSymbols.has(propertyTypeName)) {
										let propertyDeclaration = (property.valueDeclaration ?? property.declarations?.[0]) as ts.PropertyDeclaration;
										if (propertyDeclaration == null) continue;
										if (propertyDeclaration.getSourceFile().isDeclarationFile)
											continue;
										// Resolve
										foundSymbols.add(propertyTypeName);
										visitor.push(
											propertyDeclaration, typeChecker.getTypeAtLocation(propertyDeclaration),
											entity, srcFile, isInput, propertyTypeName, isResolversImplementation,
											typeChecker.getTypeOfSymbolAtLocation(property, propertyDeclaration),
											property
										);
									}
								}
							} else if (type.symbol != null) {
								//TODO find better way to resolve type name
								refName = typeChecker.typeToString(type, typeNode, ts.TypeFormatFlags.UseFullyQualifiedType); // referenced node's name
								let i = refName.lastIndexOf(')');
								if (i > -1) {
									refName = refName.slice(i + 2);
								}
							}
						}
						//* Is intersection
						else if (typeChecker.getNonNullableType(nodeType).isIntersection()) {
							// Resolve generic type
							let entity = _upObjectEntity(isInput, refName, fileName, deprecated, undefined);
							const foundSymbols: Set<string> = new Set();
							for (let i = 0, len = refTypes.length; i < len; ++i) {
								let type = refTypes[i];
								for (let j = 0, properties = type.getProperties(), jLen = properties.length; j < jLen; ++j) {
									let property = properties[j];
									let propertyTypeName = property.name;
									if (!foundSymbols.has(propertyTypeName)) {
										let propertyDeclaration = (property.valueDeclaration ?? property.declarations?.[0]) as ts.PropertyDeclaration | undefined;
										if (propertyDeclaration == null) continue;
										if (propertyDeclaration.getSourceFile().isDeclarationFile)
											continue;
										// Resolve
										foundSymbols.add(propertyTypeName);
										visitor.push(
											propertyDeclaration, typeChecker.getTypeAtLocation(propertyDeclaration),
											entity, srcFile, isInput, propertyTypeName, isResolversImplementation,
											typeChecker.getTypeOfSymbolAtLocation(property, propertyDeclaration),
											property
										);
									}
								}
							}
						}
						//* Is Union
						else {
							//* Resolve union
							// refName = _getUnionNameFromTypes(refTypes);
							let entity = INPUT_ENTITIES.get(refName);
							if (entity == null) {
								entity = {
									kind: Kind.UNION,
									name: refName,
									escapedName: escapeEntityName(refName),
									// baseName: _getUnionNameFromTypes(refTypes),
									deprecated: deprecated,
									jsDoc: jsDoc,
									types: [],
									parser: undefined,
									fileNames: [fileName]
								};
								INPUT_ENTITIES.set(refName, entity);
								OUTPUT_ENTITIES.set(refName, entity);
							} else if (entity.kind !== Kind.UNION || OUTPUT_ENTITIES.get(refName) !== entity) {
								throw `Duplicate UNION entity "${refName}" at ${errorFile(srcFile, node)} and as "${Kind[entity.kind]}" in ${entity.fileNames.join(', ')}`;
							}
						}
					}
					//* Reference
					let refEnt: Reference = {
						kind: Kind.REF,
						fileName: fileName,
						name: refName
					};
					if (pDesc.kind === Kind.UNION) pDesc.types.push(refEnt);
					else pDesc.type = refEnt;
					// }
					break;
				}
				case ts.SyntaxKind.StringKeyword:
				case ts.SyntaxKind.BooleanKeyword:
				case ts.SyntaxKind.NumberKeyword:
				case ts.SyntaxKind.SymbolKeyword:
				case ts.SyntaxKind.BigIntKeyword: {
					if (pDesc == null) continue;
					if (
						pDesc.kind !== Kind.OUTPUT_FIELD &&
						pDesc.kind !== Kind.INPUT_FIELD &&
						pDesc.kind !== Kind.LIST &&
						// pDesc.kind !== Kind.REF &&
						pDesc.kind !== Kind.PARAM
					)
						continue;
					let nodeName = _getNodeName(node, srcFile);
					pDesc.type = {
						kind: Kind.REF,
						name: nodeName,
						fileName: srcFile.fileName
					};
					break;
				}
				case ts.SyntaxKind.ArrayType: {
					if (pDesc == null) continue;
					if (
						pDesc.kind !== Kind.OUTPUT_FIELD &&
						pDesc.kind !== Kind.INPUT_FIELD &&
						pDesc.kind !== Kind.LIST &&
						pDesc.kind !== Kind.PARAM
					)
						continue;
					let arrTpe: Omit<List, 'type'> & { type: undefined } = {
						kind: Kind.LIST,
						required: true, // TODO find a solution to make list content nullable
						deprecated: deprecated,
						jsDoc: jsDoc,
						fileNames: [fileName],
						type: undefined
					};
					let arrType = arrTpe as any as List;
					pDesc.type = arrType;
					// Visit each children
					let arrEl = (node as ts.ArrayTypeNode).elementType;
					visitor.push(
						arrEl,
						(typeChecker.getTypeFromTypeNode(arrEl)),
						arrType, srcFile, isInput, entityName);
					break;
				}
				case ts.SyntaxKind.EnumDeclaration: {
					let enumNode = node as ts.EnumDeclaration;
					let nodeName = _getEntityQualifiedName(enumNode, enumNode.name?.getText());
					// Check for duplicate entities
					let entity = INPUT_ENTITIES.get(nodeName);
					if (entity == null) {
						// Create Enum
						entity = {
							kind: Kind.ENUM,
							name: nodeName,
							escapedName: escapeEntityName(nodeName),
							deprecated: deprecated,
							jsDoc: jsDoc,
							members: [],
							fileNames: [fileName]
						};
						INPUT_ENTITIES.set(nodeName, entity);
						OUTPUT_ENTITIES.set(nodeName, entity);
					}
					else if (entity.kind !== Kind.ENUM || entity !== OUTPUT_ENTITIES.get(nodeName))
						throw `Duplicate ENUM "${nodeName}" at ${errorFile(srcFile, node)}. Other files: \n\t> ${entity.fileNames.join("\n\t> ")}`;
					else {
						entity.jsDoc.push(...jsDoc);
						entity.deprecated ??= deprecated;
						entity.fileNames.push(fileName);
					}
					// Resolve children
					for (let i = 0, members = enumNode.members, len = members.length; i < len; ++i) {
						let member = members[i];
						visitor.push(member, typeChecker.getTypeAtLocation(member), entity, srcFile, undefined);
					}
					break;
				}
				case ts.SyntaxKind.EnumMember: {
					//* Enum member
					let nodeName = (node as ts.EnumMember).name?.getText();
					if (pDesc == null || pDesc.kind != Kind.ENUM)
						throw `Unexpected ENUM MEMBER "${nodeName}" at: ${errorFile(srcFile, node)}`;
					let enumMember: EnumMember = {
						kind: Kind.ENUM_MEMBER,
						name: nodeName,
						value: typeChecker.getConstantValue(node as ts.EnumMember)!,
						deprecated: deprecated,
						jsDoc: jsDoc,
						fileNames: [fileName]
					};
					pDesc.members.push(enumMember);
					break;
				}
				case ts.SyntaxKind.TypeLiteral: {
					//* Type literal are equivalent to nameless classes
					if (pDesc == null) continue;
					if (pDesc.kind === Kind.INPUT_OBJECT || pDesc.kind === Kind.OUTPUT_OBJECT) {
						//* Update already defined plain object
						//TODO check works
						visitor.pushChildren(typeChecker, node, pDesc, srcFile, isInput, undefined, isResolversImplementation);
					} else if (
						pDesc.kind === Kind.OUTPUT_FIELD ||
						pDesc.kind === Kind.INPUT_FIELD ||
						pDesc.kind === Kind.LIST ||
						pDesc.kind === Kind.PARAM
					) {
						entityName ??= '';
						// let nodeType = typeChecker.getTypeAtLocation(node);
						let entity: InputObject | OutputObject = {
							kind: isInput ? Kind.INPUT_OBJECT : Kind.OUTPUT_OBJECT,
							name: entityName,
							escapedName: escapeEntityName(entityName),
							fields: new Map(),
							deprecated: deprecated,
							fileNames: [fileName],
							inherit: undefined,
							jsDoc: jsDoc,
							wrappers: undefined,
							before: undefined,
							after: undefined,
							ownedFieldsCount: 0,
							orderByName,
							convert: undefined
						};
						let typeRef: Reference = {
							kind: Kind.REF,
							name: entityName,
							fileName: srcFile.fileName
						};
						LITERAL_OBJECTS.push({ node: entity, ref: typeRef, isInput });
						pDesc.type = typeRef;
						// Go through fields
						visitor.pushChildren(typeChecker, node, entity, srcFile, isInput, undefined, isResolversImplementation);
					}
					break;
				}
				case ts.SyntaxKind.VariableStatement: {
					//* Check node has export
					let variableNode = node as ts.VariableStatement;
					let hasExport = variableNode.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
					//* Check each variable declaration
					for (
						let i = 0,
						declarations = variableNode.declarationList.declarations,
						len = declarations.length;
						i < len; ++i
					) {
						//* Check has type definition
						let declaration = declarations[i];
						let type = declaration.type;
						if (
							declaration.initializer == null ||
							type == null ||
							!ts.isTypeReferenceNode(type) ||
							!type.typeArguments?.length
						) continue;
						let nodeName = declaration.name.getText();
						//* Check type imported from tt-model
						let s = typeChecker.getSymbolAtLocation(type.typeName);
						let d = s?.declarations?.[0];
						if (d == null || !ts.isImportSpecifier(d)) continue;
						let lib = d.parent.parent.parent.moduleSpecifier.getText().slice(1, -1);
						let opName = (d.propertyName ?? d.name).getText();
						if (lib !== PACKAGE_NAME) continue;
						//* Resolve node type name
						// let tp = typeChecker.getTypeAtLocation(declaration);
						// s = tp.symbol;
						// if (s == null) continue;
						//* Check has export
						if (hasExport === false)
							throw `Missing "export" keyword on "${nodeName}:${type.typeName.getText()}" at ${errorFile(srcFile, node)}`;
						//* Resolve
						if (type.typeArguments?.length === 1) {
							let typeArg = type.typeArguments[0];
							let fieldName = typeArg.getText();
							if (!ts.isTypeReferenceNode(typeArg))
								throw `Unexpected Entity Name: "${fieldName}" at ${errorFile(srcFile, declaration)}`;
							//* Check has correct config. Only "Scalar" has object configuration, others has function
							switch (opName) {
								case 'Scalar':
									_assertEntityNotFound(fieldName, declaration, srcFile);
									if (!ts.isObjectLiteralExpression(declaration.initializer))
										throw `Expected an object to define scalar "${fieldName}" at ${errorFile(srcFile, declaration)}`;
									break;
								case 'UnionResolver':
								case 'ConvertInput':
								case 'ConvertOutput':
									if (!ts.isFunctionExpression(declaration.initializer))
										throw `Expected function expressions for "${fieldName}" at ${errorFile(srcFile, declaration)}`;
									break;
								default:
									//* Other config are functions
									_assertEntityNotFound(fieldName, declaration, srcFile);
									if (!ts.isFunctionExpression(declaration.initializer))
										throw `Expected function expressions for "${fieldName}" at ${errorFile(srcFile, declaration)}`;
									break;
							}
							//* Add data
							switch (opName) {
								case 'Scalar': {
									//* Scalar
									let scalarEntity = INPUT_ENTITIES.get(fieldName) as Scalar | undefined;
									if (scalarEntity == null || scalarEntity.kind !== Kind.SCALAR) {
										scalarEntity = {
											kind: Kind.SCALAR,
											name: fieldName,
											escapedName: escapeEntityName(fieldName),
											deprecated: deprecated,
											jsDoc: jsDoc,
											parser: {
												fileName: fileName,
												className: nodeName,
												isAsync: false,
												isStatic: true,
												name: undefined,
												isClass: false
											},
											fileNames: [fileName]
										};
									} else {
										//TODO Enable partial scalar definition
										console.error('Scalar redefined')
									}
									// JUST OVERRIDE WHEN SCALAR :)
									INPUT_ENTITIES.set(fieldName, scalarEntity);
									OUTPUT_ENTITIES.set(fieldName, scalarEntity);
									break;
								}
								case 'UnionResolver': {
									// parse types
									let typeNode = _cleanReference(typeArg);
									if (typeNode == null)
										throw `Wrong union reference "${_getNodeName(declaration, srcFile)}" at ${errorFile(srcFile, declaration)}`;
									let unionName = _getNodeName(typeNode, srcFile); //_getUnionNameFromTypes(types);
									let entity = INPUT_ENTITIES.get(unionName) as Union | undefined;
									if (entity == null) {
										if (entity = OUTPUT_ENTITIES.get(unionName) as Union | undefined)
											throw `Duplicate entity "${unionName}" at ${errorFile(srcFile, declaration)
											} and ${entity.fileNames.join(', ')}`;
										entity = {
											kind: Kind.UNION,
											name: unionName,
											escapedName: escapeEntityName(fieldName),
											deprecated: deprecated,
											jsDoc: jsDoc,
											types: [],
											parser: {
												fileName: fileName,
												className: nodeName,
												isStatic: true,
												isAsync: false,
												// name: 'resolveType',
												name: undefined,
												isClass: false
											},
											fileNames: [fileName]
										};
										INPUT_ENTITIES.set(unionName, entity);
										OUTPUT_ENTITIES.set(unionName, entity);
									} else if (entity.kind != Kind.UNION || OUTPUT_ENTITIES.get(unionName) !== entity) {
										throw `Could not create union for "${unionName}" at ${errorFile(srcFile, declaration)}. Already defined as "${Kind[entity.kind]}" at ${entity.fileNames.join(', ')}`;
									} else if (entity.parser != null) {
										throw `Union for "${unionName}" at ${errorFile(srcFile, declaration)} already defined at ${entity.fileNames.join(', ')}`;
									} else {
										entity.name = unionName;
										entity.jsDoc.push(...jsDoc);
										entity.deprecated ??= deprecated;
										entity.fileNames.push(fileName);
										entity.parser ??= {
											fileName: fileName,
											className: nodeName,
											isAsync: false,
											isStatic: true,
											// name: 'resolveType',
											name: undefined,
											isClass: false
										};
									}
									// Add child entities
									let types = _removePromiseAndNull(typeChecker.getTypeFromTypeNode(typeArg));
									for (let i = 0, len = types.length; i < len; ++i) {
										let type = types[i];
										let typeSymbol = type.symbol;
										if (typeSymbol == null)
											throw `Missing definition for union type "${typeChecker.typeToString(type)}" at ${errorFile(srcFile, declaration)}`;
										if (!type.isClassOrInterface())
											throw `Union type "${typeChecker.typeToString(type)}" expected Interface or Class at ${errorFile(srcFile, declaration)}`;
										let typeNode = typeSymbol.valueDeclaration ?? typeSymbol.declarations?.[0];
										if (typeNode == null)
											throw `Missing definition for union type "${typeChecker.typeToString(type)}" at ${errorFile(srcFile, declaration)}`;
										visitor.push(typeNode, type, entity, srcFile, undefined, undefined, isResolversImplementation);
										entity.types.push({
											kind: Kind.REF, name: typeSymbol.name, fileName
										});
									}
									break;
								}
								//* PreValidate
								case 'PreValidate': {
									let entity = _upObjectEntity(true, fieldName, fileName, deprecated, jsDoc);
									(entity.before ??= []).push({
										name: undefined,
										className: nodeName,
										fileName: fileName,
										isAsync: _hasPromise(declaration.initializer as ts.FunctionExpression)
									});
									break;
								}
								//* PreValidate
								case 'PostValidate': {
									let entity = _upObjectEntity(true, fieldName, fileName, deprecated, jsDoc);
									(entity.after ??= []).push({
										name: undefined,
										className: nodeName,
										fileName: fileName,
										isAsync: _hasPromise(declaration.initializer as ts.FunctionExpression)
									});
									break;
								}
								//* WrapValidation
								case 'WrapValidation': {
									let entity = _upObjectEntity(true, fieldName, fileName, deprecated, jsDoc);
									(entity.wrappers ??= []).push({
										name: undefined,
										className: nodeName,
										fileName: fileName,
										isAsync: _hasPromise(declaration.initializer as ts.FunctionExpression)
									});
									break;
								}
								//* PreResolve
								case 'PreResolve': {
									_assertEntityNotFound(fieldName, declaration, srcFile);
									let entity = _upObjectEntity(false, fieldName, fileName, deprecated, jsDoc);
									(entity.before ??= []).push({
										name: undefined,
										className: nodeName,
										fileName: fileName,
										isAsync: _hasPromise(declaration.initializer as ts.FunctionExpression)
									});
									break;
								}
								case 'PostResolve': {
									_assertEntityNotFound(fieldName, declaration, srcFile);
									let entity = _upObjectEntity(false, fieldName, fileName, deprecated, jsDoc);
									(entity.after ??= []).push({
										name: undefined,
										className: nodeName,
										fileName: fileName,
										isAsync: _hasPromise(declaration.initializer as ts.FunctionExpression)
									});
									break;
								}
								case 'WrapResolver': {
									_assertEntityNotFound(fieldName, declaration, srcFile);
									let entity = _upObjectEntity(false, fieldName, fileName, deprecated, jsDoc);
									(entity.wrappers ??= []).push({
										name: undefined,
										className: nodeName,
										fileName: fileName,
										isAsync: _hasPromise(declaration.initializer as ts.FunctionExpression)
									});
									break;
								}
								//* Convert input
								case 'ConvertInput':
								case 'ConvertOutput': {
									// Resolve Entities
									let entityName = typeChecker.getTypeAtLocation(typeArg.typeName)?.symbol?.name;
									if (entityName == null)
										throw `Could not resolve entity: "${fieldName}" at ${errorFile(srcFile, declaration)}`;
									const fxDeclaration = declaration.initializer;
									if (!ts.isFunctionExpression(fxDeclaration))
										throw `Expected function expressions for "${opName}" at ${errorFile(srcFile, declaration)}`;
									//---
									let isInput = opName === 'ConvertInput';
									let entity = _upObjectEntity(isInput, entityName, fileName, deprecated, jsDoc);
									if (entity.convert != null)
										throw `${opName}<${entityName}> already defined at ${entity.convert.fileName}. at ${errorFile(srcFile, declaration)}`;
									entity.convert = {
										kind: Kind.CONVERTER,
										name: undefined,
										className: nodeName,
										fileName: fileName,
										isAsync: _hasPromise(fxDeclaration),
										type: undefined
									};
									// Resolve
									if (isInput) {
										// Resolve input param
										let paramType = _rmNull(fxDeclaration.parameters?.[1]?.type);
										if (paramType == null)
											throw `Missing param for ${opName}<${entityName}> at ${errorFile(srcFile, fxDeclaration)}`;
										visitor.push(paramType, typeChecker.getTypeAtLocation(paramType), entity.convert, srcFile, undefined, entityName);
									} else {
										let tp = fxDeclaration.type;
										if (tp == null)
											throw `Missing return type for ${opName}<${entityName}> at ${errorFile(srcFile, fxDeclaration)}`;
										visitor.push(tp, typeChecker.getTypeAtLocation(tp), entity.convert, srcFile, undefined, entityName);
									}
									break;
								}
							}
						} else {
							switch (opName) {
								//* Root config
								case 'RootConfig': {
									let obj = declaration.initializer;
									if (obj == null)
										throw `Missing wrapper method at ${errorFile(srcFile, declaration)}`;
									if (!ts.isObjectLiteralExpression(obj))
										throw `Expected an object expression to define the root configuration. Got "${ts.SyntaxKind[obj.kind]}" at ${errorFile(srcFile, obj)}`;
									for (let j = 0, properties = obj.properties, jLen = properties.length; j < jLen; ++j) {
										let property = properties[j];
										let propertyName = property.name?.getText() as keyof RootConfigTTModel;
										switch (propertyName) {
											case "after": {
												rootConfig.after.push({
													name: propertyName,
													className: nodeName,
													fileName: fileName,
													isAsync: _hasPromise(property)
												});
												break;
											}
											case "before": {
												rootConfig.before.push({
													name: propertyName,
													className: nodeName,
													fileName: fileName,
													isAsync: _hasPromise(property)
												});
												break;
											}
											case 'wrap': {
												rootConfig.wrappers.push({
													name: propertyName,
													className: nodeName,
													fileName: fileName,
													isAsync: _hasPromise(property)
												});
												break;
											}
											default: {
												let n: never = propertyName;
											}
										}
									}
								}
								//* Output resolver
								case 'Resolver':
								case 'Validator': {
									const isValidator = opName === 'Validator';
									const targetMap = isValidator ? INPUT_VALIDATORS : OUTPUT_RESOLVERS;
									let v = targetMap.get(nodeName);
									if (v != null)
										throw `Duplicated ${isValidator ? 'validator' : 'resolver'} "${nodeName}" at ${errorFile(srcFile, declaration)} and ${v.fileName}`;
									const fxExpression = declaration.initializer;
									if (!ts.isFunctionExpression(fxExpression))
										throw `Expected function expression for ${isValidator ? 'validator' : 'resolver'} "${nodeName}" at ${errorFile(srcFile, declaration)}. Got ${ts.SyntaxKind[fxExpression.kind]}`;
									const desc: FunctionExpr = {
										kind: Kind.FUNCTION_EXPRESSION,
										name: nodeName,
										fileName: fileName,
										fileNames: [fileName],
										deprecated: deprecated,
										jsDoc: jsDoc,
										isAsync: _hasPromise(fxExpression),
										required: true,
										param: undefined,
										// @ts-ignore
										type: undefined
									}
									targetMap.set(nodeName, desc);
									//* Resolve type
									let param = fxExpression.parameters?.[1];
									if (param == null) {
										if (isValidator)
											throw `Missing the second argument of validator "${nodeName}" resolver. At ${errorFile(srcFile, declaration)}`;
									} else {
										// resolve param as input or output type
										visitor.push(param, typeChecker.getTypeAtLocation(param), desc, srcFile, isValidator, nodeName);
									}
									//* Resolve output type for "Resolver"
									if (!isValidator) {
										if (fxExpression.type == null)
											throw `Missing return value of the function "${nodeName}" at ${errorFile(srcFile, node)}`;
										else {
											let propertyTypeNode = fxExpression.type;
											if (propertyType == null) propertyType = typeChecker.getTypeAtLocation(propertyTypeNode);
											else {
												propertyTypeNode = typeChecker.typeToTypeNode(
													propertyType, propertyTypeNode,
													ts.NodeBuilderFlags.AllowUniqueESSymbolType | ts.NodeBuilderFlags.UseAliasDefinedOutsideCurrentScope
												) ?? propertyTypeNode;
											}
											visitor.push(
												propertyTypeNode, propertyType,
												desc, srcFile, isInput, entityName, isResolversImplementation
											);
										}
									}
									break;
								}
							}
						}
					}
					break;
				}
				case ts.SyntaxKind.SyntaxList:
				case ts.SyntaxKind.ModuleDeclaration:
				case ts.SyntaxKind.ModuleBlock:
					visitor.pushChildren(typeChecker, node, pDesc, srcFile, isInput, undefined);
					break;
				case ts.SyntaxKind.TupleType:
					throw new Error(
						`Tuples are unsupported, did you mean Array of type? at ${errorFile(srcFile, node)
						}\n${node.getText()}`
					);
				case ts.SyntaxKind.TypeOperator: {
					//FIXME Check what TypeOperatorNode do!
					let tp = (node as ts.TypeOperatorNode).type;
					visitor.push(tp, typeChecker.getTypeAtLocation(tp), pDesc, srcFile, isInput);
					break;
				}
				default: {
					// console.log('--- GOT: ', !!pDesc, ts.SyntaxKind[node.kind]);
				}
			}
		} catch (error: any) {
			if (typeof error === 'string') errors.push(error);
			else throw error;
		}
	}
	//* Throw errors if found
	if (errors.length) throw new TError(E.PARSING_ERRORS, `Parsing Errors: \n\t - ${errors.join('\n\t- ')} `);
	//* STEP 2: ADD DEFAULT SCALARS
	for (let i = 0, len = DEFAULT_SCALARS.length; i < len; ++i) {
		let fieldName = DEFAULT_SCALARS[i];
		let scalarNode: BasicScalar = {
			kind: Kind.BASIC_SCALAR,
			name: fieldName,
			escapedName: escapeEntityName(fieldName),
			deprecated: undefined,
			fileNames: [],
			jsDoc: []
		};
		let entity = INPUT_ENTITIES.get(fieldName);
		if (entity == null || entity.kind === Kind.UNION) {
			INPUT_ENTITIES.set(fieldName, scalarNode);
			OUTPUT_ENTITIES.set(fieldName, scalarNode);
		}
	}
	//* Resolve nameless entities
	for (
		let i = 0, len = LITERAL_OBJECTS.length, namelessMap: Map<string, number> = new Map(); i < len; ++i
	) {
		let item = LITERAL_OBJECTS[i];
		let node = item.node;
		let itemName = node.name ?? item.isInput ? 'Input' : 'Output';
		let targetMap = item.isInput ? INPUT_ENTITIES : OUTPUT_ENTITIES;
		let tmpN = itemName;
		let itemI = namelessMap.get(tmpN) ?? 0;
		while (targetMap.has(itemName)) {
			++itemI;
			itemName = `${tmpN}_${itemI}`;
		}
		namelessMap.set(tmpN, itemI);
		node.name = itemName;
		item.ref.name = itemName;
		(targetMap as Map<string, InputObject | OutputObject>).set(itemName, node);
	}
	//* Make Entities Escaped Names Unique
	let nmSet = new Set<string>();
	OUTPUT_ENTITIES.forEach((entity) => {
		let escName = entity.escapedName;
		if (escName != null) {
			if (entity.kind === Kind.OUTPUT_OBJECT && nmSet.has(escName)) {
				let i = 0, escName2 = escName;
				while (nmSet.has(escName)) {
					escName = `${escName2}_${++i}`;
				}
				entity.escapedName = escName;
			}
			nmSet.add(escName);
		}
		//* List full inheritance list
		if (entity.kind === Kind.OUTPUT_OBJECT) _adjustInheritance(entity, OUTPUT_ENTITIES);
	});
	INPUT_ENTITIES.forEach((entity) => {
		let escName = entity.escapedName;
		if (escName != null) {
			if (entity.kind === Kind.INPUT_OBJECT && nmSet.has(escName)) {
				escName += 'Input';
				let i = 0, escName2 = escName;
				while (nmSet.has(escName)) {
					escName = `${escName2}_${++i}`;
				}
				entity.escapedName = escName;
			}
			nmSet.add(escName);
		}
		//* List full inheritance list
		if (entity.kind === Kind.INPUT_OBJECT) _adjustInheritance(entity, INPUT_ENTITIES);
	});
	//* Return
	return {
		input: INPUT_ENTITIES,
		output: OUTPUT_ENTITIES,
		rootConfig,
		inputHelperEntities: _mergeEntityHelpers(inputHelperEntities),
		outputHelperEntities: _mergeEntityHelpers(outputHelperEntities),
		//* Unique functions
		validators: INPUT_VALIDATORS,
		resolvers: OUTPUT_RESOLVERS
	};

	// TODO
	/** Get entity name */
	function _getNodeName(node: ts.Node, srcFile: ts.SourceFile): string {
		return tsNodePrinter.printNode(ts.EmitHint.Unspecified, node, srcFile);
	}
	/** Remove Promise & Null from type */
	function _removePromiseAndNull(type: ts.Type): ts.Type[] {
		const queue: ts.Type[] = [type];
		const result: ts.Type[] = [];
		while (queue.length > 0) {
			let tp: ts.Type | undefined = queue.pop()!;
			tp = tp.getNonNullableType();
			if (tp.isUnionOrIntersection()) {
				for (let i = 0, types = tp.types, len = types.length; i < len; ++i) {
					queue.push(types[i]);
				}
			} else if (tp.symbol?.name === 'Promise') {
				tp = (tp as ts.TypeReference).typeArguments?.[0];
				if (tp == null) throw `Fail to get Promise argument at ${typeChecker.typeToString(type)}`;
				queue.push(tp);
			} else if (!result.includes(tp)) {
				result.push(tp);
			}
		}
		return result;
	}

	/** Remove Promise and null and undefined from references */
	function _cleanReference(node: ts.TypeNode): ts.TypeNode | undefined {
		var result: ts.TypeNode | undefined;
		if (node.kind === ts.SyntaxKind.UndefinedKeyword || node.kind === ts.SyntaxKind.NullKeyword) {
			result = undefined;
		} else if (ts.isLiteralTypeNode(node)) {
			result = node;
		} else if (ts.isArrayTypeNode(node)) {
			let tp = _cleanReference(node.elementType);
			if (tp != null)
				result = factory.createArrayTypeNode(tp);
		} else if (ts.isUnionTypeNode(node) || ts.isIntersectionTypeNode(node)) {
			let types: ts.TypeNode[] = [];
			for (let i = 0, nodeTypes = node.types, len = nodeTypes.length; i < len; ++i) {
				let type = _cleanReference(nodeTypes[i]);
				if (type != null) types.push(type);
			}
			if (types.length > 0) {
				if (ts.isUnionTypeNode(node)) result = factory.createUnionTypeNode(types);
				else result = factory.createIntersectionTypeNode(types);
			}
		} else if (ts.isTypeReferenceNode(node) && node.typeArguments != null) {
			let typeNameType = typeChecker.getTypeAtLocation(node.typeName);
			let n: string | undefined;
			if (
				node.typeArguments.length === 1 && (
					(n = (typeNameType.aliasSymbol ?? typeNameType.symbol)?.name) === 'Promise' ||
					n === 'Maybe' ||
					n === 'MaybeAsync'
				)
			)
				result = _cleanReference(node.typeArguments[0]);
			else result = node;
		} else if (_getNodeName(node, node.getSourceFile()) === 'null') {
			result = undefined;
		} else {
			result = node;
		}
		return result;
	}

	/** Create Object entity if not exists */
	function _upObjectEntity(isInput: true, name: string, fileName: string, deprecated: string | undefined, jsDoc: string[] | undefined): InputObject;
	function _upObjectEntity(isInput: false | undefined, name: string, fileName: string, deprecated: string | undefined, jsDoc: string[] | undefined): OutputObject;
	function _upObjectEntity(isInput: boolean | undefined, name: string, fileName: string, deprecated: string | undefined, jsDoc: string[] | undefined): InputObject | OutputObject;
	function _upObjectEntity(isInput: boolean | undefined, name: string, fileName: string, deprecated: string | undefined, jsDoc: string[] | undefined): InputObject | OutputObject {
		const targetMap = isInput ? INPUT_ENTITIES : OUTPUT_ENTITIES;
		let entity = targetMap.get(name) as InputObject | OutputObject;
		if (entity == null) {
			entity = {
				kind: isInput ? Kind.INPUT_OBJECT : Kind.OUTPUT_OBJECT,
				name: name,
				escapedName: escapeEntityName(name),
				fields: new Map(),
				deprecated: deprecated,
				fileNames: [fileName],
				inherit: undefined,
				jsDoc: jsDoc?.slice(0) ?? [],
				wrappers: undefined,
				before: undefined,
				after: undefined,
				ownedFieldsCount: 0,
				orderByName: undefined,
				convert: undefined
			};
			(targetMap as Map<string, InputObject | OutputObject>).set(name, entity);
		}
		return entity;
	}

	/** Check entity exits */
	function _assertEntityNotFound(name: string, node: ts.Node, srcFile: ts.SourceFile) {
		let ref: AllNodes | undefined;
		if (
			((ref = INPUT_ENTITIES.get(name)) && ref.kind != Kind.INPUT_OBJECT) ||
			((ref = OUTPUT_ENTITIES.get(name)) && ref.kind != Kind.OUTPUT_OBJECT)
		)
			throw `Already defined entity ${name} at ${errorFile(srcFile, node)}. Other files: \n\t> ${ref.fileNames.join("\n\t> ")}`;
	}
	/** Generate union name from types */
	function _getUnionNameFromTypes(types: ts.Type[]): string {
		const names = [];
		for (let i = 0, len = types.length; i < len; ++i) {
			names.push(typeChecker.typeToString(types[i]));
		}
		names.sort((a, b) => a.localeCompare(b));
		return names.join('|');
	}
	/** Check if method or function has a promise as return */
	function _hasPromise(node: ts.SignatureDeclaration | ts.ObjectLiteralElementLike | ts.FunctionExpression): boolean {
		// Get method
		if (ts.isObjectLiteralElementLike(node)) {
			if (ts.isPropertyAssignment(node)) {
				if (node.initializer != null && ts.isFunctionLike(node.initializer)) {
					node = node.initializer;
				} else {
					throw `"${node.name.getText()} Expected method! at ${errorFile(node.getSourceFile(), node)}`;
				}
			} else if (!ts.isMethodDeclaration(node)) {
				throw `Unexpected type "${ts.SyntaxKind[node.kind]}" for property "${node.name?.getText()} at ${errorFile(node.getSourceFile(), node)}`
			}
		}
		// Get return type of signature
		var sign = typeChecker.getSignatureFromDeclaration(node);
		if (sign == null) throw `Fail to get method signature at ${errorFile(node.getSourceFile(), node)}`
		var returnType = typeChecker.getNonNullableType(typeChecker.getReturnTypeOfSignature(sign));
		let hasPromise = false;
		if (returnType.isUnionOrIntersection()) {
			for (let i = 0, types = returnType.types, len = types.length; i < len; ++i) {
				let type = types[i];
				if (type.symbol?.name === 'Promise') {
					hasPromise = true;
					break;
				}
			}
		} else hasPromise = returnType.symbol?.name === 'Promise';
		return hasPromise;
	}
	/** Check if field is required */
	function _isRequired(nodeType: ts.Type): boolean {
		//* Basic check
		let required = true;
		if (nodeType.flags & IS_OF_TYPE_NULL) required = false;
		else {
			let t = typeChecker.getNullableType(nodeType, nodeType.flags);
			if (t.flags & IS_OF_TYPE_NULL) required = false;
			else if (t.isUnion()) {
				required = t.types.every(tt => (tt.flags & IS_OF_TYPE_NULL) === 0);
			}
		}
		//* Check promises
		if (required && nodeType.isUnion()) {
			let queue: ts.Type[] = [nodeType];
			while (queue.length > 0) {
				let type = queue.pop()!;
				if (type.flags & IS_OF_TYPE_NULL) { required = false; break; }
				else if (type.isUnion()) {
					for (let i = 0, types = type.types, len = types.length; i < len; ++i) {
						queue.push(types[i]);
					}
				} else if (type.symbol?.name === 'Promise') {
					let tp = (type as ts.TypeReference).typeArguments?.[0];
					if (tp != null) queue.push(tp);
				}
			}
		}
		return required;
	}
}

/** Compile assert expressions */
function _compileAsserts(
	asserts: string[],
	prevAsserts: AssertOptions | undefined,
	srcFile: ts.SourceFile,
	node: ts.Node
): AssertOptions | undefined {
	try {
		if (asserts.length) {
			prevAsserts = Object.assign(
				prevAsserts ?? {},
				...asserts.map(e => _evaluateString(e))
			);
		}
		return prevAsserts;
	} catch (err: any) {
		if (typeof err === 'string')
			throw `Fail to parse @assert: ${err} At ${errorFile(srcFile, node)}`;
		else
			throw `Fail to parse: @assert ${asserts.join('\n')}: ${err?.message ?? err}\nAt ${errorFile(srcFile, node)}`;
	}
}

// Assert keys
const ASSERT_KEYS_TMP: { [k in keyof AssertOptions]-?: 1 } = {
	min: 1,
	max: 1,
	lt: 1,
	gt: 1,
	lte: 1,
	gte: 1,
	eq: 1,
	ne: 1,
	length: 1,
	regex: 1
};
const ASSERT_KEYS = new Set(Object.keys(ASSERT_KEYS_TMP));

/** Evaluate expression */
function _evaluateString(str: string): Record<string, string> {
	let obj = parseYaml(str);
	for (let k in obj) {
		if (!ASSERT_KEYS.has(k)) {
			if (k.includes(':')) throw `Missing space after symbol ":" on: "${k}"`;
			throw `Unknown assert's key "${k}"`;
		}
		if (typeof obj[k] !== 'string') obj[k] = String(obj[k]);
		// let v = obj[k];
		// if (typeof v === 'number') { }
		// else if (typeof v === 'string')
		// 	obj[k] = _parseStringValue(v);
		// else throw 0;
	}
	return obj;
}

// function _parseStringValue(v: string): number {
// 	v = v.trim();
// 	var result: number;
// 	// Check for bytes
// 	let b = /(.*?)([kmgtp]?b)$/i.exec(v);
// 	if (b == null) {
// 		result = strMath(v)
// 	} else {
// 		result = bytes(strMath(b[1]) + b[2]);
// 	}
// 	return result;
// }

/** Merge helpers */
function _mergeEntityHelpers<T extends InputObject | OutputObject>(entities: Map<string, T[]>) {
	const result: Map<string, T> = new Map();
	entities.forEach((arr, name) => {
		const obj = arr[0];
		obj.wrappers ??= [];
		for (let i = 1, len = arr.length; i < len; ++i) {
			let node = arr[i];
			obj.escapedName ??= node.escapedName;
			// Inheritance
			if (obj.inherit == null) obj.inherit = node.inherit;
			else if (node.inherit != null) obj.inherit.push(...node.inherit);
			// before & after
			if (node.wrappers != null) obj.wrappers.push(...node.wrappers);
			// Fields
			node.fields.forEach((field, fieldName) => {
				let objField = obj.fields.get(fieldName);
				if (objField == null) (obj.fields as Map<string, OutputField | InputField>).set(fieldName, field);
				else {
					objField.alias ??= field.alias;
					objField.defaultValue ??= field.defaultValue;

					if (objField.kind === Kind.INPUT_FIELD) {
						objField.asserts ??= (field as InputField).asserts;
						if ((field as InputField).pipe.length) {
							objField.pipe.push(...(field as InputField).pipe);
							objField.type = field.type;
						}
					} else {
						if (objField.method == null) {
							objField.method = (field as OutputField).method;
							objField.type = field.type;
							objField.param = (field as OutputField).param;
						}
					}
				}
			});
		}
		result.set(name, obj);
	});
	return result;
}

/** Escape entity name */
export function escapeEntityName(name: string) {
	return name.replace(/^\W+|\W+$/g, '').replace(/\W+/g, '_');
}

/** Adjust inheritance list */
function _adjustInheritance(entity: InputObject | OutputObject, mp: Map<string, InputNode | OutputObject>) {
	if (entity.inherit != null) {
		for (let i = 0, lst = entity.inherit; i < lst.length; i++) {
			let clz = lst[i];
			let e = mp.get(clz);
			let l = (e as InputObject | undefined)?.inherit;
			if (l != null) {
				for (let j = 0, len = l.length; j < len; ++j) {
					let c = l[j];
					if (lst.includes(c) === false) lst.push(c);
				}
			}
		}
	}
}
/** Remove "null" and "undefined" */
function _rmNull(type: ts.TypeNode | undefined): ts.TypeNode | undefined {
	if (type != null && ts.isUnionTypeNode(type)) {
		let result: ts.TypeNode | undefined;
		for (let i = 0, types = type.types, len = types.length; i < len; ++i) {
			let tp = types[i];
			let tpN = tp.getText();
			if (tpN !== 'undefined' && tpN !== 'null') {
				if (result == null) result = tp;
				else throw `Expected only one type for node: < ${type.getText()} > at ${errorFile(type.getSourceFile(), type)}`
			}
		}
		type = result;
	}
	return type;
}

/** Get entity qualified name (includes namespace) */
function _getEntityQualifiedName(node: ts.Node, entityName: string): string {
	if (node.parent.kind === ts.SyntaxKind.SourceFile) return entityName;
	else {
		let n: string[] = [entityName];
		let p: ts.Node = node;
		while (true) {
			p = p.parent;
			if (p.kind === ts.SyntaxKind.ModuleBlock) { }
			else if (ts.isModuleDeclaration(p) && p.name != null) {
				n.push(p.name.getText());
			} else break;
		}
		return n.reverse().join('.');
	}
}