//** PARSE TYPESCRIPT DATA

import { E, errorFile, TError } from "@src/utils/error";
import { warn } from "@src/utils/log";
import ts from "typescript";
import { AssertOptions, BasicScalar, Enum, EnumMember, InputField, Kind, List, MethodDescriptor, Node, OutputField, Param, Reference, Scalar, Union, InputNode, InputObject, OutputObject, OutputNode } from './model';
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
export function parse(files: readonly string[], program: ts.Program) {
	//* Init
	const INPUT_ENTITIES: Map<string, InputNode> = new Map();
	const OUTPUT_ENTITIES: Map<string, OutputNode> = new Map();
	//* Literal objects had no with missing name like Literal objects
	const LITERAL_OBJECTS: { node: InputObject | OutputObject, isInput: boolean, ref: Reference }[] = [];
	/** Helper entities */
	const HelperEntities: HelperEntity[] = [];
	/** Print Node Names */
	const tsNodePrinter = ts.createPrinter({ omitTrailingSemicolon: false, removeComments: true });
	/** Node Factory */
	const factory = ts.factory;
	/** Type Checker */
	const typeChecker = program.getTypeChecker();
	/** Parsing Errors */
	const errors: string[] = [];
	/** Node Visitor */
	const visitor = new NodeVisitor();
	//* Pase file and put root children into visitor's queue
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
			let { node, nodeType, parentDescriptor: pDesc, srcFile, isInput, entityName, isResolversImplementation } = item.value;
			let nodeSymbol = nodeType.symbol;
			let fileName = srcFile.fileName;
			//* Extract jsDoc && Metadata
			let asserts: string[] | undefined;
			let deprecated: string | undefined;
			let defaultValue: any;
			let fieldAlias: string | undefined;
			let jsDocTags = ts.getJSDocTags(node);
			let jsDoc: string[] = nodeSymbol?.getDocumentationComment(typeChecker).map(e => e.text) ?? [];
			//  -?? [
			// 	(
			// 		node
			// 			.getChildren()
			// 			.find(
			// 				e => e.kind === ts.SyntaxKind.JSDocComment
			// 			) as ts.JSDoc
			// 	)?.comment
			// ] ??
			// [];
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
									.text.trim();
								if (defaultValue === 'true') defaultValue = true;
								else if (defaultValue === "false") defaultValue = false;
								else {
									try {
										// If fail to convert to number, keep it string
										defaultValue = _parseStringValue(defaultValue);
									} catch (error: any) { }
								}
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
					if (_hasNtExport(node, srcFile)) continue rootLoop; //* Ignore if has no export keyword
					let nodeEntity = node as ts.ClassDeclaration | ts.InterfaceDeclaration;
					//* Check if it is a helper entity (class that implements ResolverOutputConfig or ResolverInputConfig)
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
									case 'ResolverInputConfig':
									case 'ResolverOutputConfig': {
										let resolverConfig = typeSymbol.name;
										if (isInterface)
											throw `An interface could not extends "${resolverConfig}". at ${errorFile(srcFile, type)}`;
										let isResolverOutputConfig = resolverConfig === 'ResolverOutputConfig';
										if (isInput === isResolverOutputConfig)
											throw `Could not implement "${resolverConfig}" for ${isResolverOutputConfig ? 'output' : 'input'} only entities. at ${errorFile(srcFile, type)}`;
										let t = type.typeArguments![0] as ts.TypeReferenceNode;
										// if (!ts.isTypeReferenceNode(t) || !typeChecker.getTypeFromTypeNode(t).isClassOrInterface())
										// 	throw `Expected "${resolverConfig}" argument to reference a "class" or "interface" at ${errorFile(srcFile, t)}`;
										// let typeName = typeChecker.getSymbolAtLocation(t.typeName)!.name;
										(implementedEntities ??= []).push(_getNodeName(t.typeName, srcFile));
										isInput = !isResolverOutputConfig;
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
					// Check if is entity or entity implementation (ie: resolvers or generic entity)
					let isImplementation = implementedEntities != null;
					isResolversImplementation = isImplementation;
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
								baseName: nodeEntity.name?.getText()!,
								fields: new Map(),
								deprecated: deprecated,
								fileNames: [fileName],
								inherit: inheritedEntities,
								jsDoc: jsDoc,
								after: undefined,
								before: undefined
							};
							if (isImplementation)
								HelperEntities.push({
									isInput: isResolveInput, name: entityName, entities: implementedEntities,
									entity: entity as ObjectType
								});
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
							// JsDoc
							entity.jsDoc.push(...jsDoc);
						}
						// Go through properties
						for (let i = 0, props = nodeType.getProperties(), len = props.length; i < len; ++i) {
							let s = props[i];
							let dec = s.valueDeclaration ?? s.declarations?.[0];
							if (dec == null) continue;
							let propType = typeChecker.getTypeOfSymbolAtLocation(s, node);
							visitor.push(dec, propType, entity, srcFile, isResolveInput, s.name, isResolversImplementation);
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
					if (entityName == null) throw `Unexpected missing field name at ${errorFile(srcFile, node)}`;
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
						if (isInput) {
							let p: Omit<InputField, 'type'> & { type: undefined } = {
								kind: Kind.INPUT_FIELD,
								name: entityName,
								required: (nodeType.flags & ts.TypeFlags.Undefined) === 0,
								alias: fieldAlias,
								idx: 0, // TODO Fix idx
								className: className,
								defaultValue: defaultValue,
								type: undefined,
								asserts: asserts && _compileAsserts(asserts, undefined, srcFile, node),
								deprecated: deprecated,
								jsDoc: jsDoc,
								method: method,
								fileNames: [fileName]
							};
							field = p as any as InputField | OutputField
						} else {
							let p: Omit<OutputField, 'type'> & { type: undefined } = {
								name: entityName,
								kind: Kind.OUTPUT_FIELD,
								required: (nodeType.flags & ts.TypeFlags.Undefined) === 0,
								alias: fieldAlias,
								idx: 0, // TODO Fix idx
								className: className,
								defaultValue: defaultValue,
								type: undefined,
								method: method,
								param: undefined,
								deprecated: deprecated,
								jsDoc: jsDoc,
								fileNames: [fileName]
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
							if (field.method != null)
								throw `Field "${pDesc.name}.${entityName}" already has an ${isInput ? 'input' : 'output'
								} resolver as "${field.method.className}.${field.method.name}" . Got "${className}.${entityName}" at: ${errorFile(srcFile, node)
								}. Other files:\n\t> ${field.fileNames.join("\n\t> ")}`;
							field.method = method;
						}
						if (isInput) {
							if (asserts != null) {
								(field as InputField).asserts = _compileAsserts(
									asserts,
									(field as InputField).asserts,
									srcFile, node
								);
							}
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
						visitor.push(propertyNode.type, typeChecker.getTypeAtLocation(propertyNode.type), field, srcFile, isInput, entityName);
					}
					break;
				}
				case ts.SyntaxKind.Parameter: {
					if (pDesc == null) continue; // Unexpected!
					let paramNode = node as ts.ParameterDeclaration;
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
							if (paramNode.type != null)
								visitor.push(paramNode.type, typeChecker.getTypeAtLocation(paramNode.type), pRef, srcFile, isInput, paramName);
							pDesc.param = pRef;
							break;
						case Kind.INPUT_FIELD:
							// Parse param type
							if (paramNode.type != null)
								visitor.push(paramNode.type, typeChecker.getTypeAtLocation(paramNode.type), pDesc, srcFile, isInput, paramName);
							break;
						default:
							throw `Unexpected param parent. Got "${Kind[pDesc.kind]}" at ${errorFile(srcFile, node)}`;
					}
					break;
				}
				case ts.SyntaxKind.TypeReference: {
					if (pDesc == null) continue;
					if (
						pDesc.kind !== Kind.OUTPUT_FIELD &&
						pDesc.kind !== Kind.INPUT_FIELD &&
						pDesc.kind !== Kind.LIST &&
						// pDesc.kind !== Kind.REF &&
						pDesc.kind !== Kind.PARAM
					)
						continue;
					let refTypes = _removePromiseAndNull(nodeType);
					// Check if array list
					console.log('=====================', typeChecker.typeToString(nodeType));
					let allAreArrays = true;
					let arrTypeNodes: ts.ArrayTypeNode[] = [];
					for (let i = 0, len = refTypes.length; i < len; ++i) {
						let t = refTypes[i];
						let tNode: ts.TypeNode | undefined;
						if (
							t.symbol == null ||
							(tNode = typeChecker.typeToTypeNode(t, t.symbol.valueDeclaration, ts.NodeBuilderFlags.AllowUniqueESSymbolType)) == null ||
							!ts.isArrayTypeNode(tNode)
						) {
							allAreArrays = false;
							break;
						} else {
							arrTypeNodes.push(tNode);
						}
					}
					if (allAreArrays) {
						//* Array
						let arrTypeNode: ts.ArrayTypeNode;
						if (arrTypeNodes.length === 1) arrTypeNode = arrTypeNodes[0];
						else arrTypeNode = factory.createArrayTypeNode(factory.createUnionTypeNode(arrTypeNodes.map(t => t.elementType)));
						visitor.push(arrTypeNode, typeChecker.getTypeFromTypeNode(arrTypeNode), pDesc, srcFile, isInput, entityName);
					} else {
						//* Reference
						let refName = _getNodeName(node, srcFile); // referenced node's name
						let refEnt: Reference = {
							kind: Kind.REF,
							fileName: fileName,
							name: refName
							// fullName: refNode.getText(),
							// params: refNode.typeArguments == null ? undefined : [],
							// visibleFields: _getRefVisibleFields(nodeType)
						};
						pDesc.type = refEnt;
						// Resolve type
						let targetMap = isInput ? INPUT_ENTITIES : OUTPUT_ENTITIES;
						//TODO resolve type
						if (!targetMap.has(refName)) {
							console.log('>Resolve>', refName);
							// Create type
							const entity: InputObject | OutputObject = {
								kind: isInput ? Kind.INPUT_OBJECT : Kind.OUTPUT_OBJECT,
								name: refName,
								baseName: undefined, //TODO add this for type references
								fields: new Map(),
								deprecated: undefined,
								fileNames: [fileName],
								inherit: undefined,
								jsDoc: [],
								after: undefined,
								before: undefined
							};
							(targetMap as Map<string, InputObject | OutputObject>).set(refName, entity);
							// Resolve properties
							const foundSymbols: Set<string> = new Set();
							for (let i = 0, len = refTypes.length; i < len; ++i) {
								let refType = refTypes[i];
								for (let j = 0, properties = refType.getProperties(), jLen = properties.length; j < jLen; ++j) {
									let property = properties[j];
									let propertyTypeName = property.name;
									if (!foundSymbols.has(propertyTypeName)) {
										foundSymbols.add(propertyTypeName);
										let propertyDeclaration = property.valueDeclaration ?? property.declarations?.[0];
										if (propertyDeclaration == null) continue;
										let propertyType = typeChecker.getTypeOfSymbolAtLocation(property, property.valueDeclaration!);
										// Resolve
										visitor.push(propertyDeclaration, propertyType, entity, srcFile, isInput, propertyTypeName);
									}
								}
							}
							// Resolve symbols
							// for (let i = 0, len = refTypes.length; i < len; ++i) {
							// 	let property = 
							// }
							// let refType = typeChecker.getNonNullableType(nodeType);
							// console.log('symbol:', refType.symbol?.name)
							// refType.getProperties().forEach((s) => {
							// 	console.log('=====PROP: ', s.name)
							// });
						}
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
						// pDesc.kind !== Kind.REF &&
						pDesc.kind !== Kind.PARAM
					)
						continue;
					let nodeName = node.getText();
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
					visitor.push(arrEl, typeChecker.getTypeAtLocation(arrEl), arrType, srcFile, isInput, entityName);
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
						throw `Please give a name to the union "${_getNodeName(unionNode, srcFile)}" at ${errorFile(srcFile, node)}`;
					} else if (nonNullTypes.length === 1) {
						//* Simple reference
						let tp = nonNullTypes[0]
						visitor.push(tp, typeChecker.getTypeAtLocation(tp), pDesc, srcFile, isInput, entityName);
					}
					break;
				}
				case ts.SyntaxKind.SyntaxList:
					visitor.pushChildren(typeChecker, node, pDesc, srcFile, isInput, undefined);
					break;
				case ts.SyntaxKind.TupleType:
					throw new Error(
						`Tuples are unsupported, did you mean Array of type? at ${errorFile(srcFile, node)
						}\n${node.getText()}`
					);
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
			deprecated: undefined,
			fileNames: [],
			jsDoc: []
		};
		if (!INPUT_ENTITIES.has(fieldName)) INPUT_ENTITIES.set(fieldName, scalarNode);
		if (!OUTPUT_ENTITIES.has(fieldName)) OUTPUT_ENTITIES.set(fieldName, scalarNode);
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
	return {
		input: INPUT_ENTITIES,
		output: OUTPUT_ENTITIES
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
}

/** Helper entity interface: enables to add resolvers to other entities fields */
interface HelperEntity {
	/** Class name */
	name: string,
	/** Is input or output */
	isInput: boolean
	/** Target entities */
	entities: string[] | undefined
	/** Entity */
	entity: InputObject | OutputObject
}

function _getRefVisibleFields(nodeType: ts.Type) {
	const nodeSymbol = nodeType.getSymbol();
	if (
		nodeSymbol?.name === 'Promise'
	) {
		console.log('//Goy promise'); //-HERE --------------------
		// return _getRefVisibleFields(nodeType.);
		const visibleFields: Map<string, { flags: ts.SymbolFlags; className: string; }> = new Map();
		return visibleFields;
	} else {
		/** Load reference visible fields */
		const visibleFields: Map<string, { flags: ts.SymbolFlags; className: string; }> = new Map();
		for (let i = 0, props = nodeType.getProperties(), len = props.length; i < len; ++i) {
			let s = props[i];
			let clName = ((s.valueDeclaration ?? s.declarations?.[0])?.parent as ts.ClassDeclaration).name?.getText();
			if (clName != null) {
				visibleFields.set(s.name, {
					flags: s.flags,
					className: clName
				});
			}
		}
		// If union
		if (visibleFields.size === 0 && nodeType.isUnion()) {
			for (let i = 0, types = nodeType.types, len = types.length; i < len; ++i) {
				_getRefVisibleFields(types[i]).forEach((v, k) => {
					visibleFields.set(k, v);
				});
			}
		}
		return visibleFields;
	}
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
function _evaluateString(str: string) {
	let obj = parseYaml(str);
	for (let k in obj) {
		if (!ASSERT_KEYS.has(k)) {
			if (k.includes(':')) throw `Missing space after symbol ":" on: "${k}"`;
			throw `Unknown assert's key "${k}"`;
		}
		let v = obj[k];
		if (typeof v === 'number') { }
		else if (typeof v === 'string')
			obj[k] = _parseStringValue(v);
		else throw 0;
	}
	return obj;
}

function _parseStringValue(v: string): number {
	v = v.trim();
	var result: number;
	// Check for bytes
	let b = /(.*?)([kmgtp]?b)$/i.exec(v);
	if (b == null) {
		result = strMath(v)
	} else {
		result = bytes(strMath(b[1]) + b[2]);
	}
	return result;
}

/** Resolve reference target name @deprecated */
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

/** Check for export keyword on a node */
function _hasNtExport(node: ts.Node, srcFile: ts.SourceFile) {
	//* Check for export keyword
	var modifiers = node.modifiers;
	if (modifiers != null) {
		for (let i = 0, len = modifiers.length; i < len; ++i) {
			if (modifiers[i].kind === ts.SyntaxKind.ExportKeyword) return false;
		}
	}
	warn(`Missing "export" keyword on ${ts.SyntaxKind[node.kind]} at ${errorFile(srcFile, node)}`);
	return true;
}