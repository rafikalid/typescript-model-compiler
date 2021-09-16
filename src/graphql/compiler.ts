import { FormatResponse } from '@src/formatter/formatter';
import {
	formattedInputField,
	FormattedInputNode,
	FormattedInputObject,
	formattedOutputField,
	FormattedOutputNode,
	FormattedOutputObject
} from '@src/formatter/formatter-model';
import {
	FieldType,
	InputField,
	List,
	MethodDescriptor,
	ModelKind,
	Param,
	Reference,
	Union
} from 'tt-model';
import {
	GraphQLEnumTypeConfig,
	GraphQLEnumValueConfig,
	GraphQLFieldConfig,
	GraphQLInputFieldConfig,
	GraphQLInputObjectTypeConfig,
	GraphQLObjectTypeConfig,
	GraphQLScalarTypeConfig,
	GraphQLSchemaConfig
} from 'graphql';
import ts from 'typescript';
import { relative } from 'path';
import { compileAsserts } from '@src/validator/compile-asserts';
/** Compile Model into Graphql */
export function toGraphQL(
	root: FormatResponse,
	f: ts.NodeFactory,
	pretty: boolean,
	targetSrcFilePath: string
): GqlCompilerResp {
	/** Validation schema declarations by the API */
	const validationDeclarations: ts.VariableDeclaration[] = [];
	/** Graphql types declaration */
	const graphqlDeclarations: ts.VariableDeclaration[] = [];
	//* Graphql imports
	const GraphQLScalarType = f.createUniqueName('GraphQLScalarType');
	const GraphQLSchema = f.createUniqueName('GraphQLSchema');
	const GraphQLEnumType = f.createUniqueName('GraphQLEnumType');
	const GraphQLObjectType = f.createUniqueName('GraphQLObjectType');
	const GraphQLInputObjectType = f.createUniqueName('GraphQLInputObjectType');
	const GraphQLList = f.createUniqueName('GraphQLList');
	const GraphQLNonNull = f.createUniqueName('GraphQLNonNull');
	const GraphQLUnionType = f.createUniqueName('GraphQLUnionType');
	const GraphQLFieldResolver = f.createUniqueName('GraphQLFieldResolver');
	//* GQL Imports
	const gqlImports: (string | ts.Identifier)[] = [
		'GraphQLScalarType',
		GraphQLScalarType,
		'GraphQLSchema',
		GraphQLSchema,
		'GraphQLEnumType',
		GraphQLEnumType,
		'GraphQLObjectType',
		GraphQLObjectType,
		'GraphQLInputObjectType',
		GraphQLInputObjectType,
		'GraphQLList',
		GraphQLList,
		'GraphQLNonNull',
		GraphQLNonNull,
		'GraphQLUnionType',
		GraphQLUnionType,
		'GraphQLFieldResolver',
		GraphQLFieldResolver
	];
	//* tt-model imports
	const inputValidationWrapper = f.createUniqueName('inputValidationWrapper');
	const ttModelImports: (string | ts.Identifier)[] = [
		'inputValidationWrapper',
		inputValidationWrapper
	];
	//* Other imports
	const srcImports: Map<
		string,
		Map<string, { varName: ts.Identifier; isClass: boolean }>
	> = new Map();
	//* Go through Model
	const { input: rootInput, output: rootOutput } = root;
	const queue: QueueInterface[] = [];
	if (rootOutput.has('Subscription'))
		queue.push({
			entity: rootOutput.get('Subscription')!,
			isInput: false,
			index: 0,
			circles: undefined
		});
	if (rootOutput.has('Mutation'))
		queue.push({
			entity: rootOutput.get('Mutation')!,
			isInput: false,
			index: 0,
			circles: undefined
		});
	if (rootOutput.has('Query'))
		queue.push({
			entity: rootOutput.get('Query')!,
			isInput: false,
			index: 0,
			circles: undefined
		});
	var queueLen: number;
	/** Map entities to their variables */
	const mapEntities: Map<QueueInterface['entity'], ts.Identifier> = new Map();
	/** Map entities to their validation variables */
	const mapVldEntities: Map<QueueInterface['entity'], ParamItem> = new Map();
	const PATH: Set<QueueInterface['entity']> = new Set();
	/** Circle fields from previous iterations */
	var fieldHasCircle = false;
	const mapCircles: CircleEntities[] = [];
	const mapVldCircles: CircleEntities[] = [];
	const namesSet: Set<string> = new Set();
	try {
		/** Generate uniquely named entities */
		rootLoop: while ((queueLen = queue.length) > 0) {
			let currentNode = queue[queueLen - 1];
			let { entity, isInput, index } = currentNode;
			let entityVar: ts.Identifier;
			switch (entity.kind) {
				case ModelKind.FORMATTED_INPUT_OBJECT:
				case ModelKind.FORMATTED_OUTPUT_OBJECT:
					// Resolve each
					isInput = entity.kind === ModelKind.FORMATTED_INPUT_OBJECT;
					if (index < entity.fields.length) {
						PATH.add(entity);
						queue.push({
							entity: entity.fields[index++],
							isInput,
							index: 0,
							circles: undefined
						});
						currentNode.index = index;
						continue rootLoop;
					}
					// Entity name
					let entityName = _getEntityName(entity.escapedName);
					// Create entity var
					PATH.delete(entity);
					entityVar = f.createUniqueName(entityName);
					mapEntities.set(entity, entityVar);
					let gqlObjet = isInput
						? GraphQLInputObjectType
						: GraphQLObjectType;
					// Create entity object
					if (currentNode.circles != null) {
						let circles = currentNode.circles;
						// Create fields with no circles
						let fieldsVar = f.createUniqueName(
							entityName + '_fields'
						);
						let expFields: Record<string, ts.Expression> = {};
						for (
							let i = 0,
								fields = entity.fields,
								len = fields.length;
							i < len;
							++i
						) {
							let field = fields[i];
							if (circles.indexOf(field) === -1) {
								expFields[field.alias ?? field.name] =
									_compileField(field);
							}
						}
						mapCircles.push({
							entity,
							varname: fieldsVar,
							circles: circles
						});
						// Create obj
						let entityDesc: {
							[k in keyof (
								| GraphQLInputObjectTypeConfig
								| GraphQLObjectTypeConfig<any, any>
							)]: any;
						} = {
							name: entityName,
							fields: fieldsVar
						};
						if (entity.jsDoc.length > 0)
							entityDesc.description = entity.jsDoc.join('\n');
						graphqlDeclarations.push(
							// Field var
							f.createVariableDeclaration(
								fieldsVar,
								undefined,
								f.createTypeReferenceNode(
									f.createIdentifier('Record'),
									[
										f.createKeywordTypeNode(
											ts.SyntaxKind.AnyKeyword
										),
										f.createKeywordTypeNode(
											ts.SyntaxKind.AnyKeyword
										)
									]
								),
								_serializeObject(expFields)
							),
							// Object
							f.createVariableDeclaration(
								entityVar,
								undefined,
								undefined,
								f.createNewExpression(gqlObjet, undefined, [
									_serializeObject(entityDesc)
								])
							)
						);
						//* Compile input data validation
						let vfields: ts.Expression[] = [];
						let vldVar = f.createUniqueName(entityName);
						let vldFieldsVar = f.createUniqueName(
							entityName + '_fields'
						);
						for (
							let i = 0,
								fields = entity.fields,
								len = fields.length;
							i < len;
							++i
						) {
							let fld = fields[i];
							if (circles.indexOf(fld) === -1) {
								let f = _compileValidateFields(
									entity as FormattedInputObject,
									fields[i] as formattedInputField
								);
								if (f != null) vfields.push(f);
							}
						}
						mapVldEntities.set(entity, {
							var: vldVar,
							len: vfields.length
						});
						mapVldCircles.push({
							entity,
							varname: vldFieldsVar,
							circles
						});
						// add object definition
						validationDeclarations.push(
							// Fields
							f.createVariableDeclaration(
								vldFieldsVar,
								undefined,
								f.createKeywordTypeNode(
									ts.SyntaxKind.AnyKeyword
								),
								f.createArrayLiteralExpression(vfields, pretty)
							),
							// Add object definition
							f.createVariableDeclaration(
								vldVar,
								undefined,
								f.createKeywordTypeNode(
									ts.SyntaxKind.AnyKeyword
								),
								_serializeObject({
									kind: ModelKind.PLAIN_OBJECT,
									fields: vldFieldsVar
								})
							)
						);
					} else {
						//*  Object without any circles
						let expFields: Record<string, ts.Expression> = {};
						for (
							let i = 0,
								fields = entity.fields,
								len = fields.length;
							i < len;
							++i
						) {
							let field = fields[i];
							expFields[field.alias ?? field.name] =
								_compileField(field);
						}
						// Create obj
						let entityDesc: {
							[k in keyof (
								| GraphQLInputObjectTypeConfig
								| GraphQLObjectTypeConfig<any, any>
							)]: any;
						} = {
							name: entityName,
							fields: _serializeObject(expFields)
						};
						if (entity.jsDoc.length > 0)
							entityDesc.description = entity.jsDoc.join('\n');
						graphqlDeclarations.push(
							f.createVariableDeclaration(
								entityVar,
								undefined,
								undefined,
								f.createNewExpression(gqlObjet, undefined, [
									_serializeObject(entityDesc)
								])
							)
						);
						//* Compile input data validation
						if (isInput) {
							let vfields: ts.Expression[] = [];
							for (
								let i = 0,
									fields = entity.fields,
									len = fields.length;
								i < len;
								++i
							) {
								let f = _compileValidateFields(
									entity as FormattedInputObject,
									fields[i] as formattedInputField
								);
								if (f != null) vfields.push(f);
							}
							// add object definition
							if (vfields.length) {
								let vldVar = f.createUniqueName(entityName);
								mapVldEntities.set(entity, {
									var: vldVar,
									len: vfields.length
								});
								validationDeclarations.push(
									f.createVariableDeclaration(
										vldVar,
										undefined,
										f.createKeywordTypeNode(
											ts.SyntaxKind.AnyKeyword
										),
										_serializeObject({
											kind: ModelKind.PLAIN_OBJECT,
											fields: f.createArrayLiteralExpression(
												vfields,
												pretty
											)
										})
									)
								);
							}
						}
					}
					break;
				case ModelKind.UNION:
					// Check for circles in previous type check
					if (fieldHasCircle) {
						fieldHasCircle = false;
						if (index === 0)
							throw new Error(
								`Unexpected circle before starting union!`
							);
						(currentNode.circles ??= []).push(
							entity.types[index - 1]
						);
					}
					// Resolve each type
					if (index < entity.types.length) {
						PATH.add(entity);
						queue.push({
							entity: entity.types[index++],
							isInput: false,
							index: 0,
							circles: undefined
						});
						currentNode.index = index;
						continue rootLoop;
					}
					// Resolved
					PATH.delete(entity);
					// Entity name
					let unionName = _getEntityName(entity.name);
					entityVar = f.createUniqueName(unionName);
					mapEntities.set(entity, entityVar);
					// create types
					let typesVar = f.createUniqueName(unionName + 'Types');
					let types: ts.Identifier[] = [];
					if (currentNode.circles == null) {
						for (
							let i = 0, tps = entity.types, len = tps.length;
							i < len;
							++i
						) {
							let t = tps[i];
							types.push(
								mapEntities.get(rootOutput.get(t.name!)!)!
							);
						}
					} else {
						let circles = currentNode.circles;
						for (
							let i = 0, tps = entity.types, len = tps.length;
							i < len;
							++i
						) {
							let t = tps[i];
							if (circles.includes(t) === false)
								types.push(
									mapEntities.get(rootOutput.get(t.name!)!)!
								);
						}
						mapCircles.push({ entity, varname: typesVar, circles });
					}
					// Create object
					let unionImportedDescVar = _getLocalImport(entity.parser);
					let unionDesc = [
						f.createPropertyAssignment(
							'name',
							f.createStringLiteral(unionName)
						),
						f.createPropertyAssignment('types', typesVar),
						_createMethod(
							'resolveType',
							['value', 'ctx', 'info'],
							[
								f.createReturnStatement(
									f.createElementAccessExpression(
										typesVar,
										f.createCallExpression(
											f.createPropertyAccessExpression(
												unionImportedDescVar,
												f.createIdentifier(
													'resolveType'
												)
											),
											undefined,
											[
												f.createIdentifier('value'),
												f.createIdentifier('ctx'),
												f.createIdentifier('info')
											]
										)
									)
								)
							]
						)
					];
					if (entity.jsDoc.length > 0)
						unionDesc.push(
							f.createPropertyAssignment(
								'description',
								f.createStringLiteral(entity.jsDoc.join('\n'))
							)
						);
					graphqlDeclarations.push(
						// types
						f.createVariableDeclaration(
							typesVar,
							undefined,
							f.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword),
							f.createArrayLiteralExpression(types, pretty)
						),
						// var
						f.createVariableDeclaration(
							entityVar,
							undefined,
							undefined,
							f.createNewExpression(GraphQLUnionType, undefined, [
								f.createObjectLiteralExpression(
									unionDesc,
									pretty
								)
							])
						)
					);
					break;
				case ModelKind.INPUT_FIELD:
					if (index === 0) {
						++currentNode.index;
						//* Resolve field
						queue.push({
							entity: entity.type,
							isInput: true,
							index: 0,
							circles: undefined
						});
						continue rootLoop;
					} else if (fieldHasCircle) {
						// Circle detected
						fieldHasCircle = false;
						// Push as circle to parent object
						(queue[queueLen - 2].circles ??= []).push(entity);
					}
					break;
				case ModelKind.OUTPUT_FIELD:
					// circles
					if (fieldHasCircle) {
						if (index === 0)
							throw new Error(
								`Unexpected circles before visiting output field!`
							);
						// Circle detected
						fieldHasCircle = false;
						(queue[queueLen - 2].circles ??= []).push(entity);
					}
					// visited field
					switch (index) {
						case 0:
							// Resolve type
							queue.push({
								entity: entity.type,
								isInput: false,
								index: 0,
								circles: undefined
							});
							++currentNode.index;
							continue rootLoop;
						case 1:
							// Resolve param
							if (
								entity.param != null &&
								entity.param.type != null
							) {
								queue.push({
									entity: entity.param.type,
									isInput: true,
									index: 0,
									circles: undefined
								});
								++currentNode.index;
								continue rootLoop;
							}
							break;
					}
					break;
				case ModelKind.LIST:
					if (index === 0) {
						++currentNode.index;
						queue.push({
							entity: entity.type,
							isInput,
							index: 0,
							circles: undefined
						});
						continue rootLoop;
					}
					break;
				case ModelKind.REF:
					if (index === 0) {
						++currentNode.index;
						let refNode = isInput
							? rootInput.get(entity.name)
							: rootOutput.get(entity.name);
						if (refNode == null)
							throw new Error(
								`Unexpected Missing Entity "${entity.name}"`
							);
						if (mapEntities.has(refNode)) {
						} else if (PATH.has(refNode)) {
							//* Circle
							fieldHasCircle = true;
						} else {
							//* Parse new entity
							queue.push({
								entity: refNode,
								isInput,
								index: 0,
								circles: undefined
							});
						}
						continue rootLoop;
					}
					break;
				case ModelKind.ENUM:
					//* ENUM
					let enumName = _getEntityName(entity.name);
					entityVar = f.createUniqueName(enumName);
					mapEntities.set(entity, entityVar);
					let enumValues: ts.PropertyAssignment[] = [];
					for (
						let i = 0,
							members = entity.members,
							len = members.length;
						i < len;
						++i
					) {
						let member = members[i];
						let obj: { [k in keyof GraphQLEnumValueConfig]: any } =
							{
								value: member.value
							};
						if (member.jsDoc.length > 0)
							obj.description = member.jsDoc.join('\n');
						if (member.deprecated)
							obj.deprecationReason = member.deprecated;
						enumValues.push(
							f.createPropertyAssignment(
								member.name,
								_serializeObject(obj)
							)
						);
					}
					let entityDesc: {
						[k in keyof GraphQLEnumTypeConfig]: any;
					} = {
						name: enumName,
						values: f.createObjectLiteralExpression(
							enumValues,
							pretty
						)
					};
					if (entity.jsDoc.length > 0)
						entityDesc.description = entity.jsDoc.join('\n');
					graphqlDeclarations.push(
						f.createVariableDeclaration(
							entityVar,
							undefined,
							undefined,
							f.createNewExpression(GraphQLEnumType, undefined, [
								_serializeObject(entityDesc)
							])
						)
					);
					break;
				case ModelKind.SCALAR:
					let scalarName = _getEntityName(entity.name);
					//* Scalar
					entityVar = f.createUniqueName(scalarName);
					mapEntities.set(entity, entityVar);
					let scalardesc: {
						[k in keyof GraphQLScalarTypeConfig<any, any>]: any;
					} = {
						name: scalarName,
						parseValue: _getMethodCall(entity.parser, 'parse'),
						serialize: _getMethodCall(entity.parser, 'serialize')
					};
					if (entity.jsDoc.length > 0)
						scalardesc.description = entity.jsDoc.join('\n');
					graphqlDeclarations.push(
						f.createVariableDeclaration(
							entityVar,
							undefined,
							undefined,
							f.createNewExpression(
								GraphQLScalarType,
								undefined,
								[_serializeObject(scalardesc)]
							)
						)
					);
					break;
				case ModelKind.BASIC_SCALAR:
					let bScalarName = _getEntityName(entity.name);
					entityVar = f.createUniqueName(bScalarName);
					mapEntities.set(entity, entityVar);
					switch (entity.name) {
						// Graphql basic scalars
						case 'Int':
							gqlImports.push('GraphQLInt', entityVar);
							break;
						case 'string':
							gqlImports.push('GraphQLString', entityVar);
							break;
						case 'number':
							gqlImports.push('GraphQLFloat', entityVar);
							break;
						case 'boolean':
							gqlImports.push('GraphQLBoolean', entityVar);
							break;
						// tt-model basic scalars
						case 'uInt':
							let uIntScalar = f.createUniqueName('uIntScalar');
							ttModelImports.push('uIntScalar', uIntScalar);
							_createBasicScalar(
								bScalarName,
								entityVar,
								uIntScalar
							);
							break;
						case 'uFloat':
							let uFloatScalar =
								f.createUniqueName('uFloatScalar');
							ttModelImports.push('uFloatScalar', uFloatScalar);
							_createBasicScalar(
								bScalarName,
								entityVar,
								uFloatScalar
							);
							break;
						default:
							throw new Error(
								`Unknown basic scalar: ${entity.name}`
							);
					}
					break;
				default:
					let neverCase: never = entity;
					throw new Error(
						// @ts-ignore
						`Unexpected kind: ${ModelKind[neverCase.kind]}`
					);
			}
			// Entity resolved
			queue.pop();
		}
	} catch (error: any) {
		throw new Error(
			`GQL Compile Failed at ${_printStack()}.\nCaused by: ${
				error?.stack ?? error
			}`
		);
	}

	//* Create block statement
	const statementsBlock: ts.Statement[] = [];
	// Validation
	if (validationDeclarations.length > 0) {
		statementsBlock.push(
			f.createVariableStatement(
				undefined,
				f.createVariableDeclarationList(validationDeclarations)
			)
		);
	}
	// Graphql schema
	if (graphqlDeclarations.length > 0) {
		statementsBlock.push(
			f.createVariableStatement(
				undefined,
				f.createVariableDeclarationList(graphqlDeclarations)
			)
		);
	}
	//* Imports
	var gqlImportsF: ts.ImportSpecifier[] = [];
	for (let i = 0, len = gqlImports.length; i < len; ) {
		gqlImportsF.push(
			f.createImportSpecifier(
				f.createIdentifier(gqlImports[i++] as string),
				gqlImports[i++] as ts.Identifier
			)
		);
	}
	var ttImportsF: ts.ImportSpecifier[] = [];
	for (let i = 0, len = ttModelImports.length; i < len; ) {
		ttImportsF.push(
			f.createImportSpecifier(
				f.createIdentifier(ttModelImports[i++] as string),
				ttModelImports[i++] as ts.Identifier
			)
		);
	}
	const imports: ts.ImportDeclaration[] = [
		// Graphql imports
		f.createImportDeclaration(
			undefined,
			undefined,
			f.createImportClause(
				false,
				undefined,
				f.createNamedImports(gqlImportsF)
			),
			f.createStringLiteral('graphql')
		),
		// tt-model imports
		f.createImportDeclaration(
			undefined,
			undefined,
			f.createImportClause(
				false,
				undefined,
				f.createNamedImports(ttImportsF)
			),
			f.createStringLiteral('tt-model')
		)
	];
	//* Resolve circles
	for (let i = 0, len = mapCircles.length; i < len; ++i) {
		let { entity, circles, varname } = mapCircles[i];
		switch (entity.kind) {
			case ModelKind.FORMATTED_INPUT_OBJECT:
			case ModelKind.FORMATTED_OUTPUT_OBJECT:
				for (let j = 0, jlen = circles.length; j < jlen; ++j) {
					let field = circles[j] as
						| formattedInputField
						| formattedOutputField;
					statementsBlock.push(
						f.createExpressionStatement(
							f.createBinaryExpression(
								f.createPropertyAccessExpression(
									varname,
									f.createIdentifier(
										field.alias ?? field.name
									)
								),
								f.createToken(ts.SyntaxKind.EqualsToken),
								_compileField(field)
							)
						)
					);
				}
				break;
			case ModelKind.UNION:
				for (let j = 0, jlen = circles.length; j < jlen; ++j) {
					let ref = circles[j] as Reference;
					let refNode = rootOutput.get(ref.name);
					if (refNode == null)
						throw new Error(
							`Missing entity "${ref.name}" for union "${entity.name}" at ${entity.fileName}`
						);
					let refNodeVar = mapEntities.get(refNode);
					if (refNodeVar == null)
						throw new Error(
							`Unexpected missing entity var "${ref.name}" for union "${entity.name}" at ${entity.fileName}`
						);
					statementsBlock.push(
						f.createExpressionStatement(
							f.createCallExpression(
								f.createPropertyAccessExpression(
									varname,
									f.createIdentifier('push')
								),
								undefined,
								[refNodeVar]
							)
						)
					);
				}
				break;
			default:
				let n: never = entity;
		}
	}
	//* Resolve validation circles
	for (let i = 0, len = mapVldCircles.length; i < len; ++i) {
		let { entity, varname, circles } = mapVldCircles[i];
		let desc = mapVldEntities.get(entity)!;
		if (desc == null)
			throw new Error(
				`Unexpected missing var for entity validation for: ${entity.name}`
			);
		for (let j = 0, jlen = circles.length; j < jlen; ++j) {
			let field = circles[j] as formattedInputField;
			let vField = _compileValidateFields(
				entity as FormattedInputObject,
				field
			);
			if (vField != null) {
				++desc.len;
				statementsBlock.push(
					f.createExpressionStatement(
						f.createCallExpression(
							f.createPropertyAccessExpression(
								varname,
								f.createIdentifier('push')
							),
							undefined,
							[vField]
						)
					)
				);
			}
		}
	}
	//* Add other imports
	var importIt = srcImports.entries();
	const importCreateObjects: ts.VariableDeclaration[] = [];
	while (true) {
		let n = importIt.next();
		if (n.done) break;
		let [filename, mp] = n.value;
		let sbIt = mp.entries();
		let specifiers: ts.ImportSpecifier[] = [];
		while (true) {
			let n2 = sbIt.next();
			if (n2.done) break;
			let [className, tmpVar] = n2.value;

			// Add import specifier
			if (tmpVar.isClass) {
				let isp = f.createUniqueName(className);
				specifiers.push(
					f.createImportSpecifier(f.createIdentifier(className), isp)
				);
				// Create var
				importCreateObjects.push(
					f.createVariableDeclaration(
						tmpVar.varName,
						undefined,
						undefined,
						f.createNewExpression(isp, undefined, [])
					)
				);
			} else {
				specifiers.push(
					f.createImportSpecifier(
						f.createIdentifier(className),
						tmpVar.varName
					)
				);
			}
		}
		// imports
		imports.push(
			f.createImportDeclaration(
				undefined,
				undefined,
				f.createImportClause(
					false,
					undefined,
					f.createNamedImports(specifiers)
				),
				f.createStringLiteral(
					_relative(targetSrcFilePath, filename.replace(/\.ts$/, ''))
				)
			)
		);
	}
	//* Add return statement
	var gqlSchema: { [k in keyof GraphQLSchemaConfig]: ts.Identifier } = {};
	// Query
	var q: ts.Identifier | undefined = mapEntities.get(
		rootOutput.get('Query')!
	);
	if (q != null) gqlSchema.query = q;
	// Mutation
	var q: ts.Identifier | undefined = mapEntities.get(
		rootOutput.get('Mutation')!
	);
	if (q != null) gqlSchema.mutation = q;
	// Subscription
	var q: ts.Identifier | undefined = mapEntities.get(
		rootOutput.get('Subscription')!
	);
	if (q != null) gqlSchema.subscription = q;
	statementsBlock.push(
		f.createReturnStatement(
			f.createNewExpression(GraphQLSchema, undefined, [
				_serializeObject(gqlSchema)
			])
		)
	);
	//* Create vars for imported classes
	if (importCreateObjects.length)
		statementsBlock.unshift(
			f.createVariableStatement(
				undefined,
				f.createVariableDeclarationList(importCreateObjects)
			)
		);
	//* RETURN
	return {
		imports,
		node: f.createCallExpression(
			f.createParenthesizedExpression(
				f.createFunctionExpression(
					undefined,
					undefined,
					undefined,
					undefined,
					[],
					undefined,
					f.createBlock(statementsBlock, pretty)
				)
			),
			undefined,
			[]
		)
	};
	/** Create basic scalar */
	function _createBasicScalar(
		scalarName: string,
		scalarVar: ts.Identifier,
		scalarDescVar: ts.Identifier
	) {
		let uIntConf: { [k in keyof GraphQLScalarTypeConfig<any, any>]: any } =
			{
				name: scalarName,
				parseValue: f.createPropertyAccessExpression(
					scalarDescVar,
					f.createIdentifier('parse')
				),
				serialize: f.createPropertyAccessExpression(
					scalarDescVar,
					f.createIdentifier('serialize')
				)
			};
		// if(comment!=null) uIntConf.description= comment;
		graphqlDeclarations.push(
			f.createVariableDeclaration(
				scalarVar,
				undefined,
				undefined,
				f.createNewExpression(GraphQLScalarType, undefined, [
					_serializeObject(uIntConf)
				])
			)
		);
	}
	/** serialize object */
	function _serializeObject(
		obj: Record<
			string,
			ts.Expression | string | number | boolean | undefined
		>
	) {
		var fieldArr: ts.ObjectLiteralElementLike[] = [];
		for (let k in obj) {
			let v = obj[k];
			if (v == null) v = f.createIdentifier('undefined');
			else if (typeof v === 'string') v = f.createStringLiteral(v);
			else if (typeof v === 'number') v = f.createNumericLiteral(v);
			else if (typeof v === 'boolean')
				v = v === true ? f.createTrue() : f.createFalse();
			fieldArr.push(f.createPropertyAssignment(f.createIdentifier(k), v));
		}
		return f.createObjectLiteralExpression(fieldArr, pretty);
	}
	/** Generate method call */
	function _getMethodCall(method: MethodDescriptor, methodName?: string) {
		var varId = _getLocalImport(method);
		methodName ??= method.name!;
		return f.createPropertyAccessExpression(
			varId,
			method.isClass
				? f.createIdentifier(methodName)
				: f.createIdentifier(
						method.isStatic === true
							? methodName
							: `prototype.${methodName}`
				  )
		);
	}
	/** Get import var from locale source */
	function _getLocalImport(method: MethodDescriptor) {
		var fl = srcImports.get(method.fileName);
		if (fl == null) {
			fl = new Map();
			srcImports.set(method.fileName, fl);
		}
		var vr = fl.get(method.className);
		if (vr == null) {
			vr = {
				varName: f.createUniqueName(method.className),
				isClass: method.isClass
			};
			fl.set(method.className, vr);
		}
		return vr.varName;
	}
	/** Compile field */
	function _compileField(
		field: formattedInputField | formattedOutputField
	): ts.Expression {
		if (field.kind === ModelKind.INPUT_FIELD) {
			let obj: { [k in keyof GraphQLInputFieldConfig]: any } = {
				type: _compileFieldPart(field.type, true)
			};
			if (field.defaultValue != null)
				obj.defaultValue = field.defaultValue;
			if (field.deprecated != null)
				obj.deprecationReason = field.deprecated;
			if (field.jsDoc.length > 0)
				obj.description = field.jsDoc.join('\n');
			return _serializeObject(obj);
		} else {
			let obj: { [k in keyof GraphQLFieldConfig<any, any, any>]: any } = {
				type: _compileFieldPart(field.type, false)
			};
			if (field.deprecated != null)
				obj.deprecationReason = field.deprecated;
			if (field.jsDoc.length > 0)
				obj.description = field.jsDoc.join('\n');
			if (field.param != null && field.param.type != null) {
				let ref = field.param.type;
				let refNode = rootInput.get(ref.name);
				if (refNode == null)
					throw new Error(
						`Unexpected missing entity "${
							ref.name
						}" at ${_printStack()}`
					);
				if (refNode.kind !== ModelKind.FORMATTED_INPUT_OBJECT)
					throw new Error(
						`Unexpected kind "${ModelKind[refNode.kind]}" of ${
							field.name
						}. Expected "FormattedInputObject" at ${_printStack()}`
					);
				let param: Record<string, any> = {};
				for (
					let i = 0, flds = refNode.fields, len = flds.length;
					i < len;
					++i
				) {
					let f = flds[i];
					param[f.alias ?? f.name] = _compileField(f);
				}
				obj.args = _serializeObject(param);
			}
			if (field.method != null) {
				obj.resolve = _wrapResolver(
					_getMethodCall(field.method),
					field.param
				);
			} else if (field.alias != null) {
				obj.resolve = _wrapResolver(
					f.createFunctionExpression(
						undefined,
						undefined,
						undefined,
						undefined,
						[
							f.createParameterDeclaration(
								undefined,
								undefined,
								undefined,
								'parent',
								undefined,
								f.createKeywordTypeNode(
									ts.SyntaxKind.AnyKeyword
								),
								undefined
							)
						],
						undefined,
						f.createBlock(
							[
								f.createReturnStatement(
									f.createPropertyAccessExpression(
										f.createIdentifier('parent'),
										f.createIdentifier(field.name)
									)
								)
							],
							pretty
						)
					)
				);
			}
			return _serializeObject(obj);
		}
	}
	/** Compile field's type or param */
	function _compileFieldPart(
		part: formattedInputField | formattedOutputField | Reference | List,
		isInput: boolean
	) {
		// Get wrappers (List, Optional)
		let wrappers: number[] = [];
		// let wrappers= field.required ? [1] : [];
		while (part.kind !== ModelKind.REF) {
			if (part.required) wrappers.push(1);
			if (part.kind === ModelKind.LIST) wrappers.push(0);
			part = part.type;
			if (part == null)
				throw new Error(`Unexpected empty list! at: ${_printStack()}`);
		}
		var refNode = isInput
			? rootInput.get(part.name)
			: rootOutput.get(part.name);
		if (refNode == null)
			throw new Error(
				`Unexpected missing entity "${part.name}" at ${_printStack()}`
			);
		var refNodeVar: ts.Expression | undefined = mapEntities.get(refNode);
		if (refNodeVar == null)
			throw new Error(
				`Unexpected missing entity var "${
					part.name
				}" at ${_printStack()}`
			);
		for (let i = 0, len = wrappers.length; i < len; ++i) {
			if (wrappers[i] === 0)
				refNodeVar = f.createNewExpression(GraphQLList, undefined, [
					refNodeVar
				]);
			else
				refNodeVar = f.createNewExpression(GraphQLNonNull, undefined, [
					refNodeVar
				]);
		}
		return refNodeVar;
	}
	/** Generate method */
	function _createMethod(name: string, args: string[], body: ts.Statement[]) {
		var params = [];
		for (let i = 0, len = args.length; i < len; ++i) {
			params.push(
				f.createParameterDeclaration(
					undefined,
					undefined,
					undefined,
					f.createIdentifier(args[i]),
					undefined,
					f.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword),
					undefined
				)
			);
		}
		return f.createMethodDeclaration(
			undefined,
			undefined,
			undefined,
			f.createIdentifier(name),
			undefined,
			undefined,
			params,
			undefined,
			f.createBlock(body, pretty)
		);
	}
	/** Print stack */
	function _printStack() {
		var stack = [];
		for (let i = 0, len = queue.length; i < len; ++i) {
			let entity = queue[i].entity;
			let entityName = (entity as FormattedInputNode)?.name;
			if (entityName != null)
				stack.push(`\n\t=> ${entityName}:\t${ModelKind[entity.kind]}`);
		}
		return 'STACK: ' + stack.join('');
	}
	/** Generate unique entity name */
	function _getEntityName(entityName: string): string {
		if (namesSet.has(entityName)) {
			let i = 1;
			let t = entityName;
			do {
				entityName = `${t}_${i++}`;
			} while (namesSet.has(entityName));
		}
		namesSet.add(entityName);
		return entityName;
	}
	/** Compile validation fields */
	type compileTargetTypes = formattedInputField | List | Reference;
	function _compileValidateFields(
		entity: FormattedInputObject,
		field: formattedInputField
	): ts.Expression | undefined {
		if (field.asserts != null || field.validate != null) {
			// Wrappers (list, required)
			var fieldProperties: ts.ObjectLiteralElementLike[] = [
				f.createPropertyAssignment(
					'kind',
					f.createNumericLiteral(ModelKind.INPUT_FIELD)
				),
				f.createPropertyAssignment(
					'name',
					f.createStringLiteral(field.name)
				),
				f.createPropertyAssignment(
					'targetName',
					f.createStringLiteral(field.alias ?? field.name)
				)
			];
			// Input
			if (field.validate != null)
				fieldProperties.push(
					f.createPropertyAssignment(
						'input',
						_getMethodCall(field.validate)
					)
				);
			// Asserts
			let assertTs: ts.MethodDeclaration | undefined;
			if (
				field.asserts != null &&
				(assertTs = compileAsserts(
					`${entity.name}.${field.name}`,
					field.asserts,
					field.type,
					f,
					pretty
				)) != null
			)
				fieldProperties.push(assertTs);
			// Lists
			let child: compileTargetTypes = field.type;
			var parentProperties = fieldProperties;
			while (child.kind === ModelKind.LIST) {
				let properties: ts.ObjectLiteralElementLike[] = [
					f.createPropertyAssignment(
						'kind',
						f.createNumericLiteral(ModelKind.LIST)
					)
				];
				if (child.required)
					properties.push(
						f.createPropertyAssignment('required', f.createTrue())
					);
				parentProperties.push(
					f.createPropertyAssignment(
						'type',
						f.createObjectLiteralExpression(properties, pretty)
					)
				);
				// Next
				parentProperties = properties;
				child = child.type;
				if (child == null)
					throw new Error(
						`Validation>> Unexpected empty list! at ${entity.name}.${field.name}`
					);
			}
			// Resolve reference
			let refNode = rootInput.get(child.name);
			if (refNode == null)
				throw new Error(
					`Missing entity: ${child.name}. Found at: ${entity.name}.${field.name}`
				);
			let refNodeTs: ts.Expression | undefined =
				mapVldEntities.get(refNode)?.var;
			if (refNodeTs != null) {
				parentProperties?.push(
					f.createPropertyAssignment('type', refNodeTs)
				);
			}
			// return field
			return f.createObjectLiteralExpression(fieldProperties, pretty);
		}
	}
	/** Generate resolver with validation & input wrapper */
	function _wrapResolver(
		resolveCb: ts.Expression,
		param?: Param | undefined
	): ts.Expression {
		//* Resolve input entity
		let inputEntity: FormattedInputObject | undefined;
		if (param != null && param.type != null) {
			inputEntity = rootInput.get(
				param.type.name
			) as FormattedInputObject;
			if (inputEntity.kind !== ModelKind.FORMATTED_INPUT_OBJECT)
				throw new Error(
					`Expected kind "FORMATTED_INPUT_OBJECT", received "${
						ModelKind[inputEntity.kind]
					}". ${_printStack()}`
				);
		}
		//* Collect input resolvers & validation
		var vr: ParamItem;
		if (
			inputEntity != null &&
			(vr = mapVldEntities.get(inputEntity)!) != null &&
			vr.len > 0
		) {
			resolveCb = f.createCallExpression(
				inputValidationWrapper,
				undefined,
				[vr.var, resolveCb]
			);
		}
		//* Return
		return f.createAsExpression(
			resolveCb,
			f.createTypeReferenceNode(GraphQLFieldResolver, [
				f.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword),
				f.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword)
			])
		);
	}
}

/** Compiler response */
export interface GqlCompilerResp {
	imports: ts.ImportDeclaration[];
	node: ts.CallExpression;
}
/** Queue interface */
interface QueueInterface {
	entity:
		| FormattedOutputNode
		| FormattedInputNode
		| formattedInputField
		| formattedOutputField
		| FieldType;
	isInput: boolean;
	/** Current field index (plain_object) */
	index: number;
	/** Fields with circles */
	circles:
		| (formattedInputField | formattedOutputField | Reference)[]
		| undefined;
	// /** Parent node in case of Plain_object */
	// parent?:		QueueInterface
}

/** Map circle entities */
interface CircleEntities {
	entity: FormattedInputObject | FormattedOutputObject | Union;
	varname: ts.Identifier;
	/** Fields with circles */
	circles: (formattedInputField | formattedOutputField | Reference)[];
}

/** Relative path */
function _relative(from: string, to: string) {
	var p = relative(from, to);
	p = p.replace(/\\/g, '/');
	var c = p.charAt(0);
	if (c !== '.' && c !== '/') p = './' + p;
	return p;
}

interface ParamItem {
	/** Validation entity variable */
	var: ts.Identifier;
	/** Count of validated fields */
	len: number;
}
