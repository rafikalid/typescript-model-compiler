//** PARSE TYPESCRIPT DATA

import { E, errorFile, TError } from "@src/utils/error";
import { warn } from "@src/utils/log";
import ts from "typescript";
import { AssertOptions, BasicScalar, Enum, EnumMember, InputField, Kind, List, MethodDescriptor, Node, ObjectLiteral, OutputField, Param, PlainObject, Reference, Scalar, Union } from "./model";
import { NodeVisitor } from "./visitor";
import Yaml from 'yaml';
const parseYaml = Yaml.parse;
//@ts-ignore
import strMath from 'string-math';
import bytes from 'bytes';
import { DEFAULT_SCALARS } from "tt-model";

/**
 * Extract Model from typescript code
 */
export function parse(files: string[], program: ts.Program): Map<string, Node> {
	const ROOT: Map<string, Node> = new Map();
	/** Entities with missing name like Literal objects */
	const namelessEntities: NamelessEntity[] = [];
	/** Parsing Errors */
	const errors: string[] = [];
	const typeChecker = program.getTypeChecker();
	const visitor = new NodeVisitor();
	//* Pase file and put root children into visitor's queue
	for (let i = 0, len = files.length; i < len; ++i) {
		let srcFile = program.getSourceFile(files[i])!;
		visitor.push(srcFile.getChildren(), undefined, true, srcFile, undefined);
	}
	//* Iterate over all nodes
	const it = visitor.it();
	rootLoop: while (true) {
		try {
			//* Get next item
			let item = it.next();
			if (item.done) break;
			let { node, parentDescriptor: pDesc, expectExport, srcFile, isInput, entityName } = item.value;
			let nodeType = typeChecker.getTypeAtLocation(node);
			let nodeSymbol = nodeType.symbol;
			let fileName = srcFile.fileName;
			//* Check for export keyword
			if (expectExport && !node.modifiers?.some(e => e.kind === ts.SyntaxKind.ExportKeyword)) {
				warn(`Missing "export" keyword on ${ts.SyntaxKind[node.kind]} at ${errorFile(srcFile, node)}`);
				continue rootLoop;
			}
			//* Extract jsDoc && Metadata
			let asserts: string[] | undefined;
			let deprecated: string | undefined;
			let defaultValue: string | undefined;
			let fieldAlias: string | undefined;
			let jsDocTags = ts.getJSDocTags(node);
			let jsDoc: string[] =
				nodeSymbol
					?.getDocumentationComment(typeChecker)
					.map(e => e.text) ?? [
					(
						node
							.getChildren()
							.find(
								e => e.kind === ts.SyntaxKind.JSDocComment
							) as ts.JSDoc
					)?.comment
				] ??
				[];
			// Parse JsDocTags
			if (jsDocTags.length) {
				for (let i = 0, len = jsDocTags.length; i < len; ++i) {
					let tag = jsDocTags[i];
					jsDoc.push(tag.getText());
					let tagName = tag.tagName.getText();
					let tagText: any;
					switch (tagName) {
						case 'ignore':
						case 'virtual':
							// Ignore this Node
							continue rootLoop;
						case 'deprecated':
							tagText = tag.comment;
							if (tagText == null) deprecated = '';
							else {
								if (Array.isArray(tagText))
									tagText = tagText
										.map((l: ts.JSDocText) => l.text)
										.join('\n');
								deprecated = tagText.toString();
							}
							break;
						case 'assert':
							tagText = tag.comment;
							if (tagText != null) {
								if (Array.isArray(tagText))
									tagText = tagText
										.map((l: ts.JSDocText) => l.text)
										.join(', ');
								// FIXME check using multiple lines for jsdoc tag
								if (tagText) {
									tagText = tagText.trim();
									if (!tagText.startsWith('{'))
										tagText = `{${tagText}}`;
									(asserts ??= []).push(tagText);
								}
							}
							break;
						case 'default':
							if (Array.isArray(tag.comment)) {
								defaultValue = (tag.comment[0] as ts.JSDocText)
									.text;
							}
							break;
						case 'input':
							isInput = true;
							break;
						case 'output':
							isInput = false;
							break;
						case 'alias':
							if (typeof tag.comment === 'string')
								fieldAlias = tag.comment.trim().split(/\s/, 1)[0];
							break;
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
					//* Get entity name
					let entity = node as ts.ClassDeclaration;
					let realNodeName = entity.name?.getText();
					entityName ??= realNodeName;
					if (entityName == null)
						throw `Missing entity name at: ${errorFile(srcFile, node)}`;
					//* Check if this class resolves methods from an other entity
					let targetEntities: string[] = [];
					let inherited: Reference[] | undefined;
					if (entity.heritageClauses == null) {
						isInput = undefined;
					} else {
						let isInterface = ts.isInterfaceDeclaration(node);
						for (let i = 0, clauses = entity.heritageClauses, len = clauses.length; i < len; ++i) {
							for (let j = 0, types = clauses[i].types, jLen = types.length; j < jLen; ++j) {
								let type = types[j];
								// Check for "ResolverOutputConfig" && "ResolverInputConfig"
								let typeSymbol = typeChecker.getSymbolAtLocation(type.expression);
								if (typeSymbol == null || typeSymbol.name == null)
									throw `Could not resolve type "${type.expression.getText()}" at ${errorFile(srcFile, type)}`;
								switch (typeSymbol.name) {
									case 'ResolverInputConfig':
									case 'ResolverOutputMethod':
										{
											if (isInterface)
												throw `An interface could not extends "${typeSymbol.name}". at ${errorFile(srcFile, type)}`;
											let isResolverOutputMethod = typeSymbol.name === 'ResolverOutputMethod';
											if (isInput === isResolverOutputMethod)
												throw `Could not implement "${typeSymbol.name}" for ${isResolverOutputMethod ? 'output' : 'input'} only entities. at ${errorFile(srcFile, type)}`;
											let t = type.typeArguments![0];
											if (!ts.isTypeReferenceNode(t) || !typeChecker.getTypeFromTypeNode(t).isClassOrInterface())
												throw `Expected "ResolverInputConfig" argument to reference a "class" or "interface" at ${errorFile(srcFile, t)}`;
											let typeName = typeChecker.getSymbolAtLocation(t.typeName)!.name;
											targetEntities.push(typeName);
											isInput = !isResolverOutputMethod;
											// Add to JsDoc
											jsDoc.push(
												isResolverOutputMethod ? `@ResolversAt ${realNodeName}` : `@InputResolversAt ${realNodeName}`
											);
										}
										break;
									default:
										{
											let nRef: Reference = {
												kind: Kind.REF,
												fileName: fileName,
												name: typeSymbol.name,
												oName: typeSymbol.name,
												fullName: undefined,
												params:
													type.typeArguments == null
														? undefined
														: [],
												visibleFields: undefined
											};
											visitor.push(type.typeArguments, nRef, false, srcFile);
											(inherited ??= []).push(nRef);
											//TODO resolve real nodes names
											jsDoc.push(`@Extends ${type.getText()}`);
										}
								}
							}
						}
					}
					if (targetEntities.length === 0) targetEntities.push(entityName);
					//* Visible fields
					let visibleFields = _getRefVisibleFields(node, typeChecker);
					//* Add entity
					for (let i = 0, len = targetEntities.length; i < len; ++i) {
						let entityName = targetEntities[i]
						let entityDesc = ROOT.get(entityName);
						if (entityDesc == null) {
							// Add Generic params
							let generics: string[] | undefined; // TODO generate generics using References
							let tpParams = entity.typeParameters;
							if (tpParams != null) {
								generics = [];
								for (let i = 0, len = tpParams.length; i < len; ++i) {
									generics.push(tpParams[i].name.getText());
								}
							}
							// Entity
							let entityD: PlainObject = {
								kind: Kind.PLAIN_OBJECT,
								name: entityName,
								fileNames: [fileName],
								inherit: inherited,
								generics: generics,
								input: {
									before: undefined,
									after: undefined,
									ownedFields: 0,
									fields: new Map(),
									visibleFields: visibleFields,
									jsDoc: jsDoc,
									deprecated: deprecated
								},
								output: {
									before: undefined,
									after: undefined,
									ownedFields: 0,
									fields: new Map(),
									visibleFields: new Map(visibleFields),
									jsDoc: jsDoc.slice(0),
									deprecated: deprecated
								}
							}
							entityDesc = entityD;
							ROOT.set(entityName, entityDesc);
						} else if (entityDesc.kind === Kind.SCALAR) {
							// Do nothing, just keep entity as scalar
							break;
						} else if (entityDesc.kind !== Kind.PLAIN_OBJECT) {
							throw new Error(
								`Entity "${entityName}" has multiple types:\n\t> PLAIN_OBJECT at : ${fileName}\n\t> ${Kind[entityDesc.kind]} at ${entityDesc.fileNames.join(', ')}`
							);
						} else {
							if (inherited != null)
								(entityDesc.inherit ??= []).push(...inherited);
							entityDesc.fileNames.push(fileName);
							// as input only
							if (isInput !== false) {
								let inputObj = (entityDesc as PlainObject).input;
								inputObj.deprecated ??= deprecated;
								visibleFields.forEach((v, k) => {
									inputObj.visibleFields.set(k, v);
								});
								// JsDoc
								inputObj.jsDoc.push(...jsDoc);
							}
							// as output only
							if (isInput !== true) {
								let outputObj = (entityDesc as PlainObject).output;
								outputObj.deprecated ??= deprecated;
								visibleFields.forEach((v, k) => {
									outputObj.visibleFields.set(k, v);
								});
								// JsDoc
								outputObj.jsDoc.push(...jsDoc);
							}
						}
						// Go through properties
						if (isInput !== false) {
							// input
							visitor.push(entity.members, entityDesc, false, srcFile, true);
						}
						if (isInput !== true) {
							// output
							visitor.push(entity.members, entityDesc, false, srcFile, false);
						}
					}
					break;
				}
				case ts.SyntaxKind.PropertyDeclaration:
				case ts.SyntaxKind.PropertySignature:
				case ts.SyntaxKind.MethodDeclaration: {
					if (pDesc == null) continue; // Unexpected!
					if (
						pDesc.kind !== Kind.PLAIN_OBJECT &&
						pDesc.kind !== Kind.OBJECT_LITERAL
					)
						continue;
					let propertyNode = node as ts.PropertyDeclaration;
					let nodeName = propertyNode.name?.getText();
					let className = propertyNode.parent.name?.getText();
					if (className == null)
						throw `Missing class name for method "${nodeName}" at ${errorFile(srcFile, node)}`;
					//* Input field
					let fieldParent = isInput ? (pDesc as PlainObject).input : (pDesc as PlainObject).output;
					let fields = fieldParent.fields;
					let pField = fields.get(nodeName);
					let isMethod = node.kind === ts.SyntaxKind.MethodDeclaration;
					// Method descriptor (if method)
					let method: MethodDescriptor | undefined;
					if (isMethod) {
						method = {
							fileName: fileName,
							className: className,
							name: nodeName,
							isStatic: node.modifiers?.some(
								n => n.kind === ts.SyntaxKind.StaticKeyword
							) ?? false,
							isClass: ts.isClassDeclaration(node.parent) && !node.parent.modifiers?.some(
								e => e.kind === ts.SyntaxKind.AbstractKeyword
							)
						};
					}
					// Add field
					if (pField == null) {
						if (isInput) {
							let p: Omit<InputField, 'type'> & { type: undefined } = {
								name: nodeName,
								kind: Kind.INPUT_FIELD,
								required: _isFieldRequired(propertyNode, typeChecker),
								alias: fieldAlias,
								idx: fieldParent.ownedFields++,
								className: className,
								defaultValue: defaultValue,
								type: undefined,
								asserts: asserts && _compileAsserts(asserts, undefined, srcFile),
								deprecated: deprecated,
								jsDoc: jsDoc.slice(0),
								method: method,
								fileNames: [fileName]
							}
							pField = p as any as InputField;
						} else {
							let p: Omit<OutputField, 'type'> & { type: undefined } = {
								name: nodeName,
								kind: Kind.OUTPUT_FIELD,
								required: _isFieldRequired(propertyNode, typeChecker),
								alias: fieldAlias,
								idx: fieldParent.ownedFields++,
								className: className,
								defaultValue: defaultValue,
								type: undefined,
								method: method,
								param: undefined,
								deprecated: deprecated,
								jsDoc: jsDoc.slice(0),
								fileNames: [fileName]
							};
							pField = p as any as OutputField;
						}
						(fields as Map<string, OutputField>).set(nodeName, pField as OutputField);
					} else {
						//* Field alias
						if (pField.alias == null) pField.alias = fieldAlias;
						else if (pField.alias !== fieldAlias)
							throw `Field ${className}.${nodeName} could not have two aliases. got "${pField.alias}" and "${fieldAlias}" at ${errorFile(srcFile, node)}`;
						pField.deprecated ??= deprecated;
						pField.jsDoc.push(...jsDoc);
						pField.fileNames.push(fileName);
						if (method != null) {
							if (pField.method != null)
								throw `Field ${className}.${nodeName} already has a resolver at: ${errorFile(srcFile, node)}. Other files:\n\t> ${pField.fileNames.join("\n\t> ")}`;
							pField.method = method;
						}
						if (isInput) {
							if (asserts != null) {
								(pField as InputField).asserts = _compileAsserts(
									asserts,
									(pField as InputField).asserts,
									srcFile
								);
							}
						}
					}
					if (isMethod) {
						// Resolve param
						let param = (node as ts.MethodDeclaration).parameters?.[1];
						if (param == null) {
							if (isInput) throw `Expected input resolver to define the second argument at "${className}.${nodeName}" : ${errorFile(srcFile, node)}`;
						} else {
							// resolve param as input or output type
							visitor.push(param, pField, false, srcFile, isInput);
						}
					}
					// Resolve type
					let returnType = propertyNode.type;
					if (returnType == null) {
						if (isMethod && !isInput)
							throw `Please define the return type of method "${className}.${nodeName}" at ${errorFile(srcFile, node)}`;
					} else if (!isMethod || !isInput) {
						visitor.push(returnType, pField, false, srcFile, isInput, nodeName);
					}
					break;
				}
				case ts.SyntaxKind.Parameter: {
					let paramNode = node as ts.ParameterDeclaration;
					if (pDesc == null) continue; // Unexpected!
					let paramName = paramNode.name?.getText();
					switch (pDesc.kind) {
						case Kind.OUTPUT_FIELD:
							let pRef: Param = {
								kind: Kind.PARAM,
								name: paramName,
								deprecated: deprecated,
								jsDoc: jsDoc,
								type: undefined,
								fileNames: [fileName]
							};
							// Parse param type
							visitor.push(paramNode.type, pRef, false, srcFile, isInput, paramName);
							pDesc.param = pRef;
							break;
						case Kind.INPUT_FIELD:
							// Parse param type
							visitor.push(paramNode.type, pDesc, false, srcFile, isInput, paramName);
							break;
						default:
							throw `Unexpected param parent. got "${Kind[pDesc.kind]}" at ${errorFile(srcFile, node)}`;
					}
					break;
				}
				case ts.SyntaxKind.EnumDeclaration: {
					let enumNode = node as ts.EnumDeclaration;
					let nodeName = (node as ts.EnumDeclaration).name?.getText();
					let ref = ROOT.get(nodeName);
					if (ref != null)
						throw `Duplicate entity "${nodeName}" as ENUM at ${errorFile(srcFile, node)}. Other files: \n\t> ${ref.fileNames.join("\n\t> ")}`;
					let enumEntity: Enum = {
						kind: Kind.ENUM,
						name: nodeName,
						deprecated: deprecated,
						jsDoc: jsDoc,
						members: [],
						fileNames: [fileName]
					};
					ROOT.set(nodeName, enumEntity);
					visitor.push(node.getChildren(), enumEntity, false, srcFile, isInput);
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
				case ts.SyntaxKind.TypeReference: {
					if (pDesc == null) continue;
					if (
						pDesc.kind !== Kind.OUTPUT_FIELD &&
						pDesc.kind !== Kind.INPUT_FIELD &&
						pDesc.kind !== Kind.LIST &&
						pDesc.kind !== Kind.REF &&
						pDesc.kind !== Kind.PARAM
					)
						continue;
					let refNode = node as ts.TypeReferenceNode;
					if (nodeType.getSymbol()?.name === 'Promise') {
						//* Ignore promise
						visitor.push(refNode.typeArguments, pDesc, false, srcFile, isInput);
					} else {
						let refEnt: Reference = {
							kind: Kind.REF,
							fileName: fileName,
							name: _refTargetName(refNode, typeChecker), // referenced node's name
							oName: refNode.typeName.getText(),
							fullName: refNode.getText(),
							params: refNode.typeArguments == null ? undefined : [],
							visibleFields: _getRefVisibleFields(refNode, typeChecker)
						};
						if (pDesc.kind === Kind.REF) pDesc.params!.push(refEnt);
						else pDesc.type = refEnt;
						// Resolve types
						visitor.push(refNode.typeArguments, refEnt, false, srcFile, isInput);
					}
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
						pDesc.kind !== Kind.REF &&
						pDesc.kind !== Kind.PARAM
					)
						continue;
					let nodeName = node.getText();
					let basicScalarRef: Reference = {
						kind: Kind.REF,
						name: nodeName,
						oName: nodeName,
						fullName: undefined,
						fileName: srcFile.fileName,
						params: undefined,
						visibleFields: undefined
					};
					if (pDesc.kind === Kind.REF)
						pDesc.params!.push(basicScalarRef);
					else pDesc.type = basicScalarRef;
					break;
				}
				case ts.SyntaxKind.ArrayType: {
					if (pDesc == null) continue;
					if (
						pDesc.kind !== Kind.OUTPUT_FIELD &&
						pDesc.kind !== Kind.INPUT_FIELD &&
						pDesc.kind !== Kind.LIST &&
						pDesc.kind !== Kind.REF &&
						pDesc.kind !== Kind.PARAM
					)
						continue;
					let arrTpe: Omit<List, 'type'> & { type: undefined } = {
						kind: Kind.LIST,
						required: true,
						deprecated: deprecated,
						jsDoc: jsDoc,
						fileNames: [fileName],
						type: undefined
					};
					let arrType = arrTpe as any as List;
					if (pDesc.kind === Kind.REF) pDesc.params!.push(arrType);
					else pDesc.type = arrType;
					// Visit each children
					visitor.push(
						(node as ts.ArrayTypeNode).elementType, arrType, false, srcFile, isInput);
					break;
				}
				case ts.SyntaxKind.VariableStatement: {
					let variableNode = node as ts.VariableStatement;
					for (
						let i = 0,
						declarations = variableNode.declarationList.declarations,
						len = declarations.length;
						i < len; ++i
					) {
						let declaration = declarations[i];
						let type = declaration.type;
						let nodeName = declaration.name.getText();
						let s: ts.Symbol | undefined;
						if (
							type &&
							ts.isTypeReferenceNode(type) &&
							type.typeArguments?.length === 1 &&
							(s = typeChecker.getSymbolAtLocation(type.typeName))
						) {
							let typeArg = type.typeArguments[0];
							let fieldName = typeArg.getText();
							switch (s.name) {
								case 'ModelScalar': {
									//* Scalar
									if (!ts.isTypeReferenceNode(typeArg))
										throw `Unexpected scalar name: "${fieldName}" at ${errorFile(srcFile, declaration)}`;
									// JUST OVERRIDE WHEN SCALAR :)
									let scalarEntity: Scalar = {
										kind: Kind.SCALAR,
										name: fieldName,
										deprecated: deprecated,
										jsDoc: jsDoc,
										parser: {
											fileName: fileName,
											className: nodeName,
											isStatic: true,
											name: undefined,
											isClass: false
										},
										fileNames: [fileName]
									};
									ROOT.set(fieldName, scalarEntity);
									break;
								}
								case 'UNION': {
									//* UNION
									if (!ts.isTypeReferenceNode(typeArg))
										throw `Unexpected UNION name: "${fieldName}" at ${errorFile(srcFile, declaration)}`;
									let p = ROOT.get(fieldName)
									if (p != null)
										throw `Already defined entity ${fieldName} at ${errorFile(srcFile, declaration)}. Other files: \n\t> ${p.fileNames.join("\n\t> ")}`;
									let unionNode: Union = {
										kind: Kind.UNION,
										name: fieldName,
										deprecated: deprecated,
										jsDoc: jsDoc,
										types: [],
										parser: {
											fileName: fileName,
											className: nodeName,
											isStatic: true,
											name: undefined,
											isClass: false
										},
										fileNames: [fileName]
									};
									ROOT.set(fieldName, unionNode);
									let unionChildren = unionNode.types;
									// Parse members
									const union = typeChecker
										.getAliasedSymbol(
											typeChecker.getSymbolAtLocation(
												typeArg.typeName
											)!
										)
										?.declarations?.[0]?.getChildren()
										.find(
											e => e.kind === ts.SyntaxKind.UnionType
										);
									if (union == null || !ts.isUnionTypeNode(union))
										throw `Missing union types for: "${typeArg.getText()}" at ${typeArg.getSourceFile().fileName
										}`;
									else {
										let unionTypes = union.types;
										for (
											let k = 0, kLen = unionTypes.length;
											k < kLen;
											++k
										) {
											let unionType = unionTypes[k];
											let dec =
												typeChecker.getTypeAtLocation(
													unionType
												).symbol?.declarations?.[0];
											if (
												dec == null ||
												!(
													ts.isInterfaceDeclaration(
														dec
													) || ts.isClassDeclaration(dec)
												)
											)
												throw new Error(
													`Illegal union type: ${dec?.getText() ??
													typeArg.getText()
													} at ${typeArg.getSourceFile()
														.fileName
													}:${typeArg.getStart()}`
												);
											else {
												let refN = dec.name!.getText();
												let ref: Reference = {
													kind: Kind.REF,
													name: refN,
													oName: refN,
													fullName: undefined,
													fileName: srcFile.fileName,
													// TODO add support for Generic types in union
													params: undefined,
													visibleFields: undefined
												};
												unionChildren.push(ref);
											}
										}
									}
									break;
								}
								case 'ResolverConfig': {
									//* Input resolver
									if (!ts.isTypeReferenceNode(typeArg))
										throw `Unexpected entity name: "${fieldName}" at ${errorFile(srcFile, declaration)}`;
									let inputEntityName =
										typeChecker.getTypeAtLocation(typeArg.typeName)?.symbol?.name;
									if (inputEntityName == null)
										throw `Could not resolve entity: "${fieldName}" at ${errorFile(srcFile, declaration)}`;
									//* Add
									let entity = ROOT.get(inputEntityName);
									if (entity == null) {
										let entityD: PlainObject = {
											kind: Kind.PLAIN_OBJECT,
											name: inputEntityName,
											fileNames: [fileName],
											inherit: undefined,
											generics: undefined,
											input: {
												before: undefined,
												after: undefined,
												ownedFields: 0,
												fields: new Map(),
												visibleFields: new Map(),
												jsDoc: jsDoc,
												deprecated: deprecated
											},
											output: {
												before: undefined,
												after: undefined,
												ownedFields: 0,
												fields: new Map(),
												visibleFields: new Map(),
												jsDoc: jsDoc.slice(0),
												deprecated: deprecated
											}
										}
										entity = entityD;
									} else if (entity.kind !== Kind.PLAIN_OBJECT)
										throw `Expected Entity "${inputEntityName}" as PLAIN_OBJECT. Got "${Kind[entity.kind]}" at ${errorFile(srcFile, declaration)}`;
									let obj = declaration.initializer;
									if (obj == null)
										throw `Missing Entity configuration for "${inputEntityName}" at ${errorFile(srcFile, declaration)}`;
									if (!ts.isObjectLiteralExpression(obj))
										throw `Expected an object literal expression to define the configuration for entity "${inputEntityName}". Got "${ts.SyntaxKind[obj.kind]}" at ${errorFile(srcFile, obj)}`;
									for (let j = 0, properties = obj.properties, jLen = properties.length; j < jLen; ++j) {
										let property = properties[j];
										if (!ts.isPropertyAssignment(property)) continue;
										switch (property.name?.getText()) {
											case "outputFields":
												visitor.push(property.initializer, entity, false, srcFile, false, entity.name);
												break;
											case 'inputFields':
												visitor.push(property.initializer, entity, false, srcFile, true, entity.name);
												break;
											case 'outputBefore':
												if (entity.output.before != null)
													throw `Already defined "${entity.name}::outputBefore" at ${errorFile(srcFile, property)}`;
												entity.output.before = {
													name: 'outputBefore',
													className: nodeName,
													fileName: fileName,
													isClass: false,
													isStatic: true
												}
												break;
											case 'outputAfter':
												if (entity.output.after != null)
													throw `Already defined "${entity.name}::outputAfter" at ${errorFile(srcFile, property)}`;
												entity.output.after = {
													name: 'outputAfter',
													className: nodeName,
													fileName: fileName,
													isClass: false,
													isStatic: true
												}
												break;
											case 'inputBefore':
												if (entity.input.before != null)
													throw `Already defined "${entity.name}::inputBefore" at ${errorFile(srcFile, property)}`;
												entity.input.before = {
													name: 'inputBefore',
													className: nodeName,
													fileName: fileName,
													isClass: false,
													isStatic: true
												}
												break;
											case 'inputAfter':
												if (entity.input.after != null)
													throw `Already defined "${entity.name}::inputAfter" at ${errorFile(srcFile, property)}`;
												entity.input.after = {
													name: 'inputAfter',
													className: nodeName,
													fileName: fileName,
													isClass: false,
													isStatic: true
												}
												break;
										}
									}
									break;
								}
							}
						}
					}
					break;
				}
				case ts.SyntaxKind.TypeLiteral: {
					//* Type literal are equivalent to nameless classes
					if (pDesc == null) continue;
					if (pDesc.kind === Kind.PLAIN_OBJECT) {
						//* Update already defined plain object
						//TODO check works
						visitor.push(node.getChildren(), pDesc, false, srcFile, isInput);
					} else if (
						pDesc.kind === Kind.OUTPUT_FIELD ||
						pDesc.kind === Kind.INPUT_FIELD ||
						pDesc.kind === Kind.LIST ||
						pDesc.kind === Kind.PARAM
					) {
						entityName ??= '';
						// Define nameless class
						let typeLiteral: ObjectLiteral = {
							kind: Kind.OBJECT_LITERAL,
							name: entityName,
							fileNames: [fileName],
							generics: undefined,
							inherit: undefined,
							input: {
								after: undefined,
								before: undefined,
								deprecated: deprecated,
								fields: new Map(),
								jsDoc: jsDoc,
								ownedFields: 0,
								visibleFields: _getRefVisibleFields(node, typeChecker)
							},
							output: {
								after: undefined,
								before: undefined,
								deprecated: deprecated,
								fields: new Map(),
								jsDoc: jsDoc,
								ownedFields: 0,
								visibleFields: _getRefVisibleFields(node, typeChecker)
							}
						};
						let typeRef: Reference = {
							kind: Kind.REF,
							name: entityName,
							oName: entityName,
							fileName: srcFile.fileName,
							params: undefined,
							fullName: undefined,
							visibleFields: _getRefVisibleFields(node, typeChecker)
						};
						namelessEntities.push({
							name: entityName,
							node: typeLiteral,
							ref: typeRef,
						});
						pDesc.type = typeRef;
						// Go through fields
						visitor.push(node.getChildren(), typeLiteral, false, srcFile, isInput);
					}
					break;
				}
				case ts.SyntaxKind.UnionType: {
					if (pDesc == null) continue;
					if (
						pDesc.kind !== Kind.OUTPUT_FIELD &&
						pDesc.kind !== Kind.INPUT_FIELD &&
						pDesc.kind !== Kind.LIST &&
						pDesc.kind !== Kind.PARAM
					)
						continue;
					let unionNode = node as ts.UnionTypeNode;
					let nonNullTypes: ts.TypeNode[] = []
					for (let i = 0, types = unionNode.types, len = types.length; i < len; ++i) {
						let type = types[i];
						if (
							type.kind === ts.SyntaxKind.UndefinedKeyword ||
							type.kind === ts.SyntaxKind.NullKeyword ||
							(type.kind === ts.SyntaxKind.LiteralType &&
								type.getText() === 'null')
						) {
							(pDesc as InputField | OutputField).required = false;
						} else {
							nonNullTypes.push(type);
						}
					}
					if (nonNullTypes.length > 1) {
						//* Defined union
						// TODO support native unions
						throw `Please give a name to the union "${nonNullTypes.map(e => e.getText()).join(' | ')}" at ${errorFile(srcFile, node)}`;
					} else if (nonNullTypes.length === 1) {
						//* Simple reference
						visitor.push(nonNullTypes[0], pDesc, false, srcFile, isInput);
					}
					break;
				}
				case ts.SyntaxKind.TypeOperator:
					//FIXME Check what TypeOperatorNode do!
					visitor.push(
						(node as ts.TypeOperatorNode).type, pDesc, false, srcFile, isInput);
					break;
				case ts.SyntaxKind.SyntaxList:
					visitor.push(node.getChildren(), pDesc, false, srcFile, isInput);
					break;
				case ts.SyntaxKind.TupleType:
					throw `Tuples are unsupported. Did you mean Array of types? at ${errorFile(srcFile, node)}`;
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
		if (!ROOT.has(fieldName)) {
			let scalarNode: BasicScalar = {
				kind: Kind.BASIC_SCALAR,
				name: fieldName,
				deprecated: undefined,
				fileNames: [],
				jsDoc: []
			};
			ROOT.set(fieldName, scalarNode);
		}
	}
	//* Resolve nameless entities
	for (
		let i = 0,
		len = namelessEntities.length,
		namelessMap: Map<string, number> = new Map();
		i < len; ++i
	) {
		let item = namelessEntities[i];
		let itemName = item.name ?? 'Entity';
		let tmpN = itemName;
		let itemI = namelessMap.get(tmpN) ?? 0;
		while (ROOT.has(itemName)) {
			++itemI;
			itemName = `${tmpN}_${itemI}`;
		}
		namelessMap.set(tmpN, itemI);
		let nNode = item.node;
		nNode.name = itemName;
		(nNode as any as PlainObject).kind = Kind.PLAIN_OBJECT;
		ROOT.set(itemName, nNode as any as PlainObject);
		item.ref.name = itemName;
		// Set fields class name
		// if (nNode.kind === Kind.OBJECT_LITERAL) {
		// 	nNode.fields.forEach(function (field) {
		// 		field.className = itemName;
		// 	});
		// }
	}
	return ROOT;
}

/** Nameless entities */
interface NamelessEntity {
	/** Hint name or prefix */
	name: string | undefined;
	/** Target entity */
	node: ObjectLiteral;
	/** Target reference */
	ref: Reference;
}

/** Load reference visible fields */
function _getRefVisibleFields(r: ts.Node, typeChecker: ts.TypeChecker) {
	var visibleFields: Map<
		string,
		{
			flags: ts.SymbolFlags;
			className: string;
		}
	> = new Map();
	for (
		let i = 0,
		props = typeChecker.getTypeAtLocation(r).getProperties(),
		len = props.length;
		i < len;
		++i
	) {
		let s = props[i];
		let clName = (
			(s.valueDeclaration ?? s.declarations?.[0])
				?.parent as ts.ClassDeclaration
		).name?.getText();
		if (clName != null) {
			visibleFields.set(s.name, {
				flags: s.flags,
				className: clName
			});
		}
	}
	return visibleFields;
}
function _isFieldRequired(propertyNode: ts.PropertyDeclaration, typeChecker: ts.TypeChecker): boolean {
	if (propertyNode.questionToken) return false;
	// TODO check if this works as expected
	let type = typeChecker.getTypeAtLocation(propertyNode);
	return (type.flags & ts.TypeFlags.Undefined) === 0;
}

/** Compile assert expressions */
function _compileAsserts(
	asserts: string[],
	prevAsserts: AssertOptions | undefined,
	srcFile: ts.SourceFile
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
		throw `Fail to parse: @assert ${asserts.join('\n')}\n at ${srcFile.fileName}\n\n${err?.stack}`;
	}
}

/** Evaluate expression */
function _evaluateString(str: string) {
	let obj = parseYaml(str);
	for (let k in obj) {
		let v = obj[k];
		if (typeof v === 'number') { }
		else if (typeof v === 'string') {
			v = v.trim()
			// Check for bytes
			let b = /(.*?)([kmgtp]?b)$/i.exec(v);
			if (b == null) {
				v = strMath(v)
			} else {
				v = bytes(strMath(b[1]) + b[2]);
			}
			obj[k] = v;
		}
		else throw 0;
	}
}

/** Resolve reference target name */
function _refTargetName(ref: ts.TypeReferenceNode, typeChecker: ts.TypeChecker) {
	let refTypeSymb = typeChecker.getTypeAtLocation(ref.typeName).symbol;
	let refTargetNode =
		refTypeSymb == null
			? undefined
			: refTypeSymb.valueDeclaration ?? refTypeSymb.declarations?.[0];

	let refTextName: string;
	if (refTargetNode == null) refTextName = ref.typeName.getText();
	else {
		// Get parent of enums
		if (ts.isEnumMember(refTargetNode))
			refTargetNode = refTargetNode.parent;
		refTextName =
			(refTargetNode as ts.InterfaceDeclaration).name?.getText() ||
			ref.typeName.getText();
	}
	return refTextName;
}