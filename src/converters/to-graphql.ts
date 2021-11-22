import { format } from '@src/parser/format';
import ts from 'typescript';
import { ToDataReturn } from './to-data-model';
import { FormattedOutputNode, FormattedInputNode, formattedInputField, formattedOutputField, FormattedOutputObject, FormattedBasicScalar, FormattedEnumMember, FormattedNode, FormattedUnion, FormattedInputObject } from '@src/parser/formatted-model';
import { FieldType, Kind, MethodDescriptor, Reference, List, Param, EnumMember, BasicScalar } from '../parser/model';
import { relative, dirname } from 'path';
import { GraphQLArgumentConfig, GraphQLEnumTypeConfig, GraphQLEnumValueConfig, GraphQLFieldConfig, GraphQLInputFieldConfig, GraphQLInputObjectTypeConfig, GraphQLObjectTypeConfig, GraphQLScalarTypeConfig, GraphQLSchemaConfig, GraphQLUnionTypeConfig } from 'graphql';
import { seek } from './seek';
import { TargetExtension } from '@src/compile';

/**
 * Generate Graphql schema from data
 */
export function toGraphQL(
	f: ts.NodeFactory,
	srcFile: ts.SourceFile,
	{
		input: rootInput,
		output: rootOutput,
		wrappers: rootWrappers
	}: ReturnType<typeof format>,
	pretty: boolean,
	targetExtension: TargetExtension | undefined
): ToDataReturn {
	type SeekNode = FormattedOutputNode | FormattedInputNode | FieldType | FormattedEnumMember | formattedOutputField | formattedInputField | Param;
	/** srcFile path */
	const srcFilePath = srcFile.fileName;
	/** Validation schema declarations by the API */
	const inputDeclarations: ts.VariableDeclaration[] = [];
	/** Graphql types declaration */
	const graphqlDeclarations: ts.VariableDeclaration[] = [];
	/** Graphql imports */
	const gqlImports: Map<string, ts.Identifier> = new Map();
	const GraphQLSchema = _gqlImport('GraphQLSchema');
	const GraphQLNonNull = _gqlImport('GraphQLNonNull');
	const GraphQLList = _gqlImport('GraphQLList');
	const GraphQLObjectType = _gqlImport('GraphQLObjectType');
	const GraphQLInputObjectType = _gqlImport('GraphQLInputObjectType');
	const GraphQLUnionType = _gqlImport('GraphQLUnionType');
	/** Import from tt-model */
	const ttModelImports: Map<string, ts.Identifier> = new Map();
	//* Other imports
	type srcImportEntry = Map<string, { varName: ts.Identifier; isClass: boolean }>;
	const srcImports: Map<string, srcImportEntry> = new Map();
	/** Create class objects */
	const importCreateObjects: ts.VariableDeclaration[] = [];
	/** Reduce identifiers (example: non null strings) */
	const reduceRequiredIds = new Map<ts.Expression, ts.Expression>();
	//* Go through Model
	const queue: SeekNode[] = [];
	/** Is node visited for first time (as 0) or second time (as 1) */
	let node: FormattedOutputNode | undefined;
	if (node = rootOutput.get('Subscription')) { queue.push(node); }
	if (node = rootOutput.get('Mutation')) { queue.push(node); }
	if (node = rootOutput.get('Query')) { queue.push(node); }
	//* Create schema
	/** Map entities to their vars */
	const mapEntityVar: Map<string, ts.Identifier> = new Map();
	/** Circles queue */
	const circlesQueue: CircleQueueItem[] = [];
	/** Seek validation */
	const seekVldCircle: Set<FormattedInputNode> = new Set();
	const mapVldEntityVar: Map<string, ts.Identifier> = new Map();
	/** Go through nodes */
	const seekCircle: Set<FormattedOutputNode | FormattedInputNode> = new Set();
	seek<SeekNode, SeekOutputData>(queue, _seekOutputDown, _seekOutputUp);
	//* Add circle fields
	const circleStatementsBlock: ts.Statement[] = [];
	for (let i = 0, len = circlesQueue.length; i < len; ++i) {
		let item = circlesQueue[i];
		switch (item.type) {
			case Kind.OUTPUT_FIELD: {
				let { field } = item;
				// Type
				let fieldConf: { [k in keyof GraphQLFieldConfig<any, any, any>]: any } = {
					type: ResolveCircleFieldType(field)
				};
				// Other info
				if (field.deprecated) fieldConf.deprecationReason = field.deprecated;
				if (field.jsDoc) fieldConf.description = field.jsDoc;
				if (field.method) {
					let methodVar = _import(field.method);
					fieldConf.resolve = _wrapResolver(_getMethodCall(methodVar, field.method), field.param);
					if (field.param != null && field.param.type != null) {
						fieldConf.args = _fieldArg(field.param);
					}
				} else if (field.alias) {
					fieldConf.resolve = _resolveOutputAlias(field.name);
				}
				circleStatementsBlock.push(
					f.createExpressionStatement(f.createBinaryExpression(
						f.createPropertyAccessExpression(item.varId, field.alias ?? field.name),
						f.createToken(ts.SyntaxKind.EqualsToken),
						_serializeObject(fieldConf)
					))
				);
				break;
			}
			case Kind.INPUT_FIELD: {
				let { field } = item;
				// Type
				let fieldConf: { [k in keyof GraphQLInputFieldConfig]: any } = {
					type: ResolveCircleFieldType(field)
				};
				// Other info
				if (field.deprecated) fieldConf.deprecationReason = field.deprecated;
				if (field.jsDoc) fieldConf.description = field.jsDoc;
				circleStatementsBlock.push(
					f.createExpressionStatement(f.createBinaryExpression(
						f.createPropertyAccessExpression(item.varId, field.alias ?? field.name),
						f.createToken(ts.SyntaxKind.EqualsToken),
						_serializeObject(fieldConf)
					))
				);
				break;
			}
			case Kind.UNION: {
				let { varId, union, isInput } = item;
				// Check for circles
				const types: ts.Expression[] = [];
				for (let i = 0, refs = union.types, len = refs.length; i < len; ++i) {
					let ref = refs[i];
					let refEntity = isInput ? rootOutput.get(ref.name) : rootOutput.get(ref.name);
					types.push(mapEntityVar.get(refEntity!.escapedName)!);
				}
				circleStatementsBlock.push(
					f.createExpressionStatement(f.createCallExpression(
						f.createPropertyAccessExpression(varId, "push"), undefined, types
					))
				);
				break;
			}
			default: {
				let c: never = item;
			}
		}
	}
	//* Imports
	const imports = _genImports(); // Generate imports from src
	imports.push(
		_genImportDeclaration('graphql', gqlImports), // Graphql imports
		_genImportDeclaration('tt-model', ttModelImports) // tt-model imports
	);

	//* Create block statement
	const statementsBlock: ts.Statement[] = [];
	if (importCreateObjects.length > 0)
		statementsBlock.push(f.createVariableStatement(
			undefined, f.createVariableDeclarationList(importCreateObjects)
		));
	if (inputDeclarations.length > 0)
		statementsBlock.push(f.createVariableStatement(
			undefined, f.createVariableDeclarationList(inputDeclarations)
		));
	if (graphqlDeclarations.length > 0)
		statementsBlock.push(f.createVariableStatement(
			undefined, f.createVariableDeclarationList(graphqlDeclarations)
		));
	if (circleStatementsBlock.length) statementsBlock.push(...circleStatementsBlock);

	//* Add return statement
	const gqlSchema: { [k in keyof GraphQLSchemaConfig]: ts.Identifier } = {};
	// Query
	let q: ts.Identifier | undefined;
	if (q = mapEntityVar.get('Query')) gqlSchema.query = q;
	if (q = mapEntityVar.get('Mutation')) gqlSchema.mutation = q;
	if (q = mapEntityVar.get('Subscription')) gqlSchema.subscription = q;
	statementsBlock.push(f.createReturnStatement(
		f.createNewExpression(GraphQLSchema, undefined, [
			_serializeObject(gqlSchema)
		])
	));
	//* Return
	return {
		imports,
		node: f.createCallExpression(
			f.createParenthesizedExpression(f.createFunctionExpression(
				undefined, undefined, undefined, undefined, [], undefined,
				f.createBlock(statementsBlock, pretty)
			)),
			undefined, []
		)
	};
	/** Generate GraphQL import */
	function _gqlImport(name: string) {
		let id = gqlImports.get(name);
		if (id == null) {
			id = f.createUniqueName(name);
			gqlImports.set(name, id);
		}
		return id;
	}
	/** Generate tt-model import */
	function _ttModelImport(name: string) {
		let id = ttModelImports.get(name);
		if (id == null) {
			id = f.createUniqueName(name);
			ttModelImports.set(name, id);
		}
		return id;
	}
	/** Generate import declaration for graphQl & tt-model */
	function _genImportDeclaration(packageName: string, map: Map<string, ts.Identifier>) {
		const specifiers: ts.ImportSpecifier[] = [];
		map.forEach((id, name) => {
			specifiers.push(
				f.createImportSpecifier(f.createIdentifier(name), id)
			);
		});
		return f.createImportDeclaration(
			undefined, undefined,
			f.createImportClause(
				false, undefined,
				f.createNamedImports(specifiers)
			), f.createStringLiteral(packageName)
		)
	}
	/** Local import */
	function _import(method: MethodDescriptor) {
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
	/** Generate Local imports */
	function _genImports() {
		const imports: ts.ImportDeclaration[] = [];
		const srcFileDir = dirname(srcFilePath);
		const ext = targetExtension ?? '';
		srcImports.forEach((entry, filename) => {
			const specifiers: ts.ImportSpecifier[] = [];
			entry.forEach(({ isClass, varName }, className) => {
				if (isClass) {
					let isp = f.createUniqueName(className);
					specifiers.push(
						f.createImportSpecifier(f.createIdentifier(className), isp)
					);
					// Create var
					importCreateObjects.push(
						f.createVariableDeclaration(
							varName, undefined, undefined,
							f.createNewExpression(isp, undefined, [])
						)
					);
				} else {
					specifiers.push(
						f.createImportSpecifier(f.createIdentifier(className), varName)
					);
				}
			});
			// imports
			imports.push(
				f.createImportDeclaration(
					undefined, undefined,
					f.createImportClause(
						false, undefined,
						f.createNamedImports(specifiers)
					),
					f.createStringLiteral(
						_relative(srcFileDir, filename.replace(/\.tsx?$/, ext))
					)
				)
			);
		});
		return imports;
	}
	/** serialize object */
	function _serializeObject(
		obj: Record<string, ts.Expression | string | number | boolean | undefined>
	) {
		var fieldArr: ts.ObjectLiteralElementLike[] = [];
		for (let k in obj) {
			let v = obj[k];
			if ((v as ts.Expression)?.kind === ts.SyntaxKind.MethodDeclaration) {
				fieldArr.push(v as any as ts.MethodDeclaration);
			} else {
				if (v == null) v = f.createIdentifier('undefined');
				else if (typeof v === 'string') v = f.createStringLiteral(v);
				else if (typeof v === 'number') v = f.createNumericLiteral(v);
				else if (typeof v === 'boolean')
					v = v === true ? f.createTrue() : f.createFalse();
				fieldArr.push(f.createPropertyAssignment(f.createIdentifier(k), v));
			}
		}
		return f.createObjectLiteralExpression(fieldArr, pretty);
	}

	/** Seek down */
	function _seekOutputDown(node: SeekNode, isInput: boolean, parentNode: SeekNode | undefined): SeekNode[] | { nodes: SeekNode[], isInput: boolean } | undefined {
		switch (node.kind) {
			case Kind.FORMATTED_OUTPUT_OBJECT: {
				// Add entity to circle check
				seekCircle.add(node);
				return node.fields;
			}
			case Kind.FORMATTED_INPUT_OBJECT: {
				// Add entity to circle check
				seekCircle.add(node);
				return node.fields;
			}
			case Kind.OUTPUT_FIELD: {
				return node.param == null ? [node.type] : [node.type, node.param];
			}
			case Kind.INPUT_FIELD: {
				return node.type == null ? undefined : [node.type];
			}
			case Kind.PARAM: {
				// return node.type == null ? undefined : { isInput: true, nodes: [node.type] };
				// return undefined;
				let ref = node.type;
				if (ref != null) {
					let entity = rootInput.get(ref.name);
					let returnValue: FieldType[] = [];
					if (entity == null) throw `Missing input entity ${ref.name}`;
					if (entity.kind !== Kind.FORMATTED_INPUT_OBJECT) throw `Entity "${ref.name}" expected input object. Got ${Kind[entity.kind]}`;
					for (let i = 0, fields = entity.fields, len = fields.length; i < len; ++i) {
						returnValue.push(fields[i].type);
					}
					return { isInput: true, nodes: returnValue };
				}
				return undefined;
			}
			case Kind.UNION: {
				// Add entity to circle check
				seekCircle.add(node);
				return node.types;
			}
			case Kind.ENUM: return node.members;
			case Kind.LIST: return [node.type];
			case Kind.REF: {
				let entityName = node.name;
				let entity = isInput === true ? rootInput.get(entityName) : rootOutput.get(entityName);
				if (entity == null) throw `Missing ${isInput ? 'input' : 'output'} entity "${entityName}" referenced at ${node.fileName}`;
				let entityEscapedName = entity.escapedName;
				if (mapEntityVar.has(entityEscapedName)) return undefined;
				if (seekCircle.has(entity)) return undefined; // Circular
				return [entity];
			}
			case Kind.SCALAR:
			case Kind.BASIC_SCALAR:
			case Kind.ENUM_MEMBER:
				return undefined;
			default: {
				let _never: never = node;
				throw _never;
			}
		}
	}
	/**
	 * Seek up
	 * Returns each time the identifier to the var of this node and if has circle from reference
	 * @return {node: ts.Node, hasCircle:boolean}
	 */
	function _seekOutputUp(entity: SeekNode, isInput: boolean, parentNode: SeekNode | undefined, childrenData: SeekOutputData[]): SeekOutputData {
		var varId: SeekOutputData;
		switch (entity.kind) {
			case Kind.FORMATTED_OUTPUT_OBJECT: {
				// Remove entity from circle check
				seekCircle.delete(entity);
				// Check for circles
				const fields: ts.PropertyAssignment[] = [];
				const circleFields: formattedOutputField[] = []
				for (let i = 0, arr = entity.fields, len = arr.length; i < len; ++i) {
					let field = childrenData[i] as ts.PropertyAssignment;
					if (field == null) circleFields.push(arr[i]);
					else fields.push(field);
				}
				// Create fields
				let objFields: ts.Expression = f.createObjectLiteralExpression(fields, pretty);
				if (circleFields.length) {
					let fieldsVar = f.createUniqueName(`${entity.escapedName}_fields`);
					graphqlDeclarations.push(
						f.createVariableDeclaration(
							fieldsVar, undefined, undefined, objFields
						)
					);
					objFields = fieldsVar;
					// Add to circle queue
					for (let i = 0, len = circleFields.length; i < len; ++i) {
						circlesQueue.push({
							type: Kind.OUTPUT_FIELD, node: entity, field: circleFields[i], varId: fieldsVar
						});
					}
				}
				// Create object
				let entityConf: { [k in keyof GraphQLObjectTypeConfig<any, any>]: any } = {
					name: entity.escapedName,
					fields: objFields
				};
				if (entity.jsDoc) entityConf.description = entity.jsDoc;
				let vName = varId = f.createUniqueName(entity.escapedName);
				graphqlDeclarations.push(
					f.createVariableDeclaration(
						vName, undefined, undefined,
						f.createNewExpression(GraphQLObjectType, undefined, [
							_serializeObject(entityConf)
						])
					)
				);
				// Add var
				mapEntityVar.set(entity.escapedName, vName);
				break;
			}
			case Kind.OUTPUT_FIELD: {
				//* Type
				varId = childrenData[0] as ts.Expression | undefined; // "undefined" means has circular to parents
				if (varId != null) {
					// Type
					if (entity.required) varId = genRequiredExpr(varId, 'requiredExpr');
					let fieldConf: { [k in keyof GraphQLFieldConfig<any, any, any>]: any } = {
						type: varId
					};
					// Other info
					if (entity.deprecated) fieldConf.deprecationReason = entity.deprecated;
					if (entity.jsDoc) fieldConf.description = entity.jsDoc;
					if (entity.method) {
						let methodVar = _import(entity.method);
						fieldConf.resolve = _wrapResolver(_getMethodCall(methodVar, entity.method), entity.param);
						let paramId = childrenData[1] as ts.Expression | undefined; // "undefined" means has no param
						if (paramId != null) fieldConf.args = paramId;
					} else if (entity.alias) {
						fieldConf.resolve = _resolveOutputAlias(entity.name);
					}
					varId = f.createPropertyAssignment(entity.alias ?? entity.name, _serializeObject(fieldConf));
				}
				break;
			}
			case Kind.FORMATTED_INPUT_OBJECT: {
				// Remove entity from circle check
				seekCircle.delete(entity);
				// Check for circles
				const fields: ts.PropertyAssignment[] = [];
				const circleFields: formattedInputField[] = []
				for (let i = 0, arr = entity.fields, len = arr.length; i < len; ++i) {
					let field = childrenData[i] as ts.PropertyAssignment;
					if (field == null) circleFields.push(arr[i]);
					else fields.push(field);
				}
				// Create fields
				let objFields: ts.Expression = f.createObjectLiteralExpression(fields, pretty);
				if (circleFields.length) {
					let fieldsVar = f.createUniqueName(`${entity.escapedName}_fields`);
					graphqlDeclarations.push(
						f.createVariableDeclaration(
							fieldsVar, undefined, undefined, objFields
						)
					);
					objFields = fieldsVar;
					// Add to circle queue
					for (let i = 0, len = circleFields.length; i < len; ++i) {
						circlesQueue.push({
							type: Kind.INPUT_FIELD, node: entity, field: circleFields[i], varId: fieldsVar
						});
					}
				}
				// Create object
				let entityConf: { [k in keyof GraphQLInputObjectTypeConfig]: any } = {
					name: entity.escapedName,
					fields: objFields
				};
				if (entity.jsDoc) entityConf.description = entity.jsDoc;
				let vName = varId = f.createUniqueName(entity.escapedName);
				graphqlDeclarations.push(
					f.createVariableDeclaration(
						vName, undefined, undefined,
						f.createNewExpression(GraphQLInputObjectType, undefined, [
							_serializeObject(entityConf)
						])
					)
				);
				// Add var
				mapEntityVar.set(entity.escapedName, vName);
				break;
			}
			case Kind.PARAM: {
				if (childrenData.length > 0) {
					varId = _fieldArg(entity);
				} else varId = undefined;
				break;
			}
			case Kind.INPUT_FIELD: {
				//* Type
				varId = childrenData[0] as ts.Expression | undefined; // "undefined" means has circular to parents
				if (varId != null) {
					// Type
					if (entity.required) varId = genRequiredExpr(varId, 'requiredExpr');
					let fieldConf: { [k in keyof GraphQLInputFieldConfig]: any } = {
						type: varId
					};
					// Other info
					if (entity.defaultValue) fieldConf.defaultValue = entity.defaultValue;
					if (entity.deprecated) fieldConf.deprecationReason = entity.deprecated;
					if (entity.jsDoc) fieldConf.description = entity.jsDoc;
					if (entity.method) {
						// TODO input validator, maybe not here :D
					} else if (entity.alias) {
						// TODO input alias, maybe not here :D
					}
					varId = f.createPropertyAssignment(entity.alias ?? entity.name, _serializeObject(fieldConf));
				}
				break;
			}
			case Kind.UNION: {
				// Remove entity from circle check
				seekCircle.delete(entity);
				let typesArr: ts.Identifier = f.createUniqueName(`${entity.escapedName}_types`);
				let types: ts.Expression[];
				// Check if has circles
				if (childrenData.some(e => e == null)) {
					//* Has circles
					circlesQueue.push({ type: Kind.UNION, union: entity, varId: typesArr, isInput });
					types = [];
				} else {
					//* Has no circle
					types = childrenData as ts.Expression[];
				}
				// Create types list
				graphqlDeclarations.push(
					f.createVariableDeclaration(
						typesArr, undefined, undefined,
						f.createArrayLiteralExpression(types, pretty)
					)
				);
				// create union
				if (entity.parser == null) throw `Missing resolver for UNION "${entity.name}"`;
				let entityConf: { [k in keyof GraphQLUnionTypeConfig<any, any>]: any } = {
					name: entity.escapedName,
					types: typesArr,
					resolveType: _createMethod('resolveType', ['value', 'ctx', 'info'], [
						f.createReturnStatement(f.createElementAccessExpression(
							typesArr,
							f.createCallExpression(
								f.createPropertyAccessExpression(
									_import(entity.parser),
									f.createIdentifier('resolveType')
								),
								undefined,
								[
									f.createIdentifier('value'),
									f.createIdentifier('ctx'),
									f.createIdentifier('info')
								]
							)
						))
					])
				};
				if (entity.jsDoc) entityConf.description = entity.jsDoc;
				let vName = varId = f.createUniqueName(entity.escapedName);
				graphqlDeclarations.push(
					f.createVariableDeclaration(
						vName, undefined, undefined,
						f.createNewExpression(GraphQLUnionType, undefined, [
							_serializeObject(entityConf)
						])
					)
				);
				// Add var
				mapEntityVar.set(entity.escapedName, vName);
				break;
			}
			case Kind.LIST: {
				varId = childrenData[0] as ts.Expression | undefined; // "undefined" means has circular to parents
				if (varId != null) {
					if (entity.required) varId = genRequiredExpr(varId, 'requiredExpr');
					varId = f.createNewExpression(GraphQLList, undefined, [varId]);
				}
				break;
			}
			case Kind.REF: {
				varId = childrenData[0]; // "undefined" means has circular to parents
				if (varId == null) {
					let refEntity = isInput === true ? rootInput.get(entity.name) : rootOutput.get(entity.name);
					varId = mapEntityVar.get(refEntity!.escapedName);
				}
				break;
			}
			case Kind.ENUM_MEMBER: {
				let memberConf: { [k in keyof GraphQLEnumValueConfig]: any } = {
					value: entity.value
				};
				if (entity.jsDoc) memberConf.description = entity.jsDoc;
				if (entity.deprecated) memberConf.deprecationReason = entity.deprecated;
				varId = f.createPropertyAssignment(
					entity.name,
					_serializeObject(memberConf)
				);
				break;
			}
			case Kind.ENUM: {
				let varName = f.createUniqueName(entity.escapedName);
				varId = varName;
				let entityConf: { [k in keyof GraphQLEnumTypeConfig]: any; } = {
					name: entity.escapedName,
					values: f.createObjectLiteralExpression(
						childrenData as ts.PropertyAssignment[],
						pretty
					)
				};
				if (entity.jsDoc) entityConf.description = entity.jsDoc;
				graphqlDeclarations.push(
					f.createVariableDeclaration(
						varName, undefined, undefined,
						f.createNewExpression(_gqlImport('GraphQLEnumType'), undefined, [
							_serializeObject(entityConf)
						])
					)
				);
				// Add var
				mapEntityVar.set(entity.escapedName, varName);
				break;
			}
			case Kind.SCALAR: {
				let varName = f.createUniqueName(entity.escapedName);
				varId = varName;
				let parserVar = _import(entity.parser);
				let scalarConf: { [k in keyof GraphQLScalarTypeConfig<any, any>]: any; } = {
					name: entity.escapedName,
					parseValue: _getMethodCall(parserVar, entity.parser, 'parse'),
					serialize: _getMethodCall(parserVar, entity.parser, 'serialize')
				};
				if (entity.jsDoc) scalarConf.description = entity.jsDoc;
				graphqlDeclarations.push(
					f.createVariableDeclaration(
						varName, undefined, undefined,
						f.createNewExpression(
							_gqlImport('GraphQLScalarType'),
							undefined,
							[_serializeObject(scalarConf)]
						)
					)
				);
				// Add var
				mapEntityVar.set(entity.escapedName, varName);
				break;
			}
			case Kind.BASIC_SCALAR: {
				switch (entity.name) {
					//* Graph QL basic scalars
					case 'boolean': varId = _gqlImport('GraphQLBoolean'); break;
					case 'number': varId = _gqlImport('GraphQLFloat'); break;
					case 'string': varId = _gqlImport('GraphQLString'); break;
					case 'Int': varId = _gqlImport('GraphQLInt'); break;
					//* Other scalars
					case 'uFloat': varId = _createBasicScalar('uFloatScalar', entity); break;
					case 'uInt': varId = _createBasicScalar('uIntScalar', entity); break;
					case 'Buffer': varId = _createBasicScalar('bufferScalar', entity); break;
					default: {
						let _never: never = entity;
						throw _never;
					}
				}
				// Add entity var
				mapEntityVar.set(entity.escapedName, varId as ts.Identifier);
				break;
			}
			default: {
				let _never: never = entity;
				throw _never;
			}
		}
		return varId;
	}
	/** Generate Object field args */
	function _fieldArg(param: Param) {
		let ref = param.type!;
		let refEntity = rootInput.get(ref.name)!;
		if (refEntity.kind !== Kind.FORMATTED_INPUT_OBJECT) throw `Entity "${refEntity.name}" expected input object. Got ${Kind[refEntity.kind]}`;
		let properties: ts.PropertyAssignment[] = [];
		for (let i = 0, fields = refEntity.fields, len = fields.length; i < len; ++i) {
			let field = fields[i];
			let paramVar = ResolveCircleFieldType(field);
			let fieldConf: { [k in keyof GraphQLArgumentConfig]: any } = { type: paramVar };
			if (field.defaultValue) fieldConf.defaultValue = field.defaultValue;
			if (field.jsDoc) fieldConf.description = field.jsDoc;
			if (field.deprecated) fieldConf.deprecationReason = field.deprecated;
			properties.push(f.createPropertyAssignment(field.alias ?? field.name, _serializeObject(fieldConf)));
		}
		return f.createObjectLiteralExpression(properties, pretty);
	}
	/** Create basic scalar */
	function _createBasicScalar(parserName: string, entity: FormattedBasicScalar): ts.Identifier {
		var scalarVar = f.createUniqueName(entity.escapedName);
		var scalarParser = _ttModelImport(parserName);
		var uIntConf: { [k in keyof GraphQLScalarTypeConfig<any, any>]: any } =
		{
			name: entity.escapedName,
			parseValue: f.createPropertyAccessExpression(
				scalarParser,
				f.createIdentifier('parse')
			),
			serialize: f.createPropertyAccessExpression(
				scalarParser,
				f.createIdentifier('serialize')
			),
			description: f.createPropertyAccessExpression(
				scalarParser,
				f.createIdentifier('description')
			),
		};
		// if(comment!=null) uIntConf.description= comment;
		graphqlDeclarations.push(
			f.createVariableDeclaration(
				scalarVar,
				undefined,
				undefined,
				f.createNewExpression(_gqlImport('GraphQLScalarType'), undefined, [
					_serializeObject(uIntConf)
				])
			)
		);
		return scalarVar;
	}
	/** Generate method call */
	function _getMethodCall(varId: ts.Identifier, method: MethodDescriptor, methodName?: string) {
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
	/** Resolve output alias */
	function _resolveOutputAlias(name: string) {
		return f.createFunctionExpression(
			undefined, undefined, undefined, undefined,
			[
				f.createParameterDeclaration(
					undefined, undefined, undefined,
					'parent', undefined,
					f.createKeywordTypeNode(
						ts.SyntaxKind.AnyKeyword
					), undefined
				)
			], undefined, f.createBlock([
				f.createReturnStatement(
					f.createPropertyAccessExpression(
						f.createIdentifier('parent'), name
					)
				)
			], pretty)
		);
	}
	/** Generate method */
	function _createMethod(name: string, args: string[], body: ts.Statement[]) {
		var params = [];
		for (let i = 0, len = args.length; i < len; ++i) {
			params.push(
				f.createParameterDeclaration(
					undefined, undefined, undefined,
					f.createIdentifier(args[i]), undefined,
					f.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword), undefined
				)
			);
		}
		return f.createMethodDeclaration(
			undefined, undefined, undefined,
			f.createIdentifier(name),
			undefined, undefined, params,
			undefined, f.createBlock(body, pretty)
		);
	}
	/** Resolve field type */
	function ResolveCircleFieldType(field: formattedInputField | formattedOutputField): ts.Expression {
		let tp = field.type;
		if (tp == null) throw new Error(`Missing type at ${field.className}.${field.name}`);
		let q: List[] = [];
		let isInput = field.kind === Kind.INPUT_FIELD;
		while (tp.kind != Kind.REF) {
			q.push(tp);
			tp = tp.type;
		}
		let entity = isInput ? rootInput.get(tp.name) : rootOutput.get(tp.name);
		if (entity == null) throw `Missing ${isInput ? 'input' : 'output'} entity "${tp.name}" referenced at ${tp.fileName}`;
		let varId: ts.Expression | undefined = mapEntityVar.get(entity.escapedName);
		if (varId == null) throw `Missing definition for entity "${entity.name}"`;
		// wrap with list and requires
		for (let i = 0, len = q.length; i < len; ++i) {
			let l = q[i];
			if (l.required) varId = genRequiredExpr(varId, 'requiredExpr');
			varId = f.createNewExpression(GraphQLList, undefined, [varId]);
		}
		// If field required
		if (field.required) varId = genRequiredExpr(varId, 'requiredExpr');
		return varId;
	}
	/** Get required expression */
	function genRequiredExpr(varId: ts.Expression, exprName: string) {
		let id = reduceRequiredIds.get(varId);
		if (id == null) {
			let varName = f.createUniqueName(exprName);
			graphqlDeclarations.push(
				f.createVariableDeclaration(
					varName, undefined, undefined,
					f.createNewExpression(GraphQLNonNull, undefined, [varId])
				)
			);
			reduceRequiredIds.set(varId, varName);
			varId = varName;
		} else {
			varId = id;
		}
		return varId;
	}
	//* Validate input data
	/** Add resolver */
	type SeekVldNode = FormattedInputNode | FieldType | FormattedEnumMember | formattedInputField;
	function _wrapResolver(resolveCb: ts.Expression, param: Param | undefined): ts.Expression {
		seekVldCircle.clear();
		mapVldEntityVar.clear();
		let result = param != null && param.type != null ? seek<SeekVldNode, SeekOutputData>(param.type, _seekValidationDown, _seekValidationUp) : undefined;
		// TODO implement resolver wrappers
		return resolveCb;
	}
	/** Seek validation down */
	function _seekValidationDown(node: SeekVldNode, isInput: boolean, parentNode: SeekVldNode | undefined): SeekVldNode[] | { nodes: SeekVldNode[], isInput: boolean } | undefined {
		switch (node.kind) {
			case Kind.FORMATTED_INPUT_OBJECT: {
				// Add entity to circle check
				seekVldCircle.add(node);
				return node.fields;
			}
			case Kind.INPUT_FIELD: return node.type == null ? undefined : [node.type];
			case Kind.UNION: {
				seekVldCircle.add(node);
				return node.types;
			}
			case Kind.ENUM: return node.members
			case Kind.LIST: return [node.type];
			case Kind.REF: {
				let entityName = node.name;
				let entity = rootInput.get(entityName);
				if (entity == null) throw `Missing input entity "${entityName}" referenced at ${node.fileName}`;
				let entityEscapedName = entity.escapedName;
				if (mapVldEntityVar.has(entityEscapedName)) return undefined;
				if (seekVldCircle.has(entity)) return undefined; // Circular
				return [entity];
			}
			case Kind.SCALAR:
			case Kind.BASIC_SCALAR:
			case Kind.ENUM_MEMBER:
				return undefined;
			default: {
				let n: never = node;
			}
		}
	}
	/** Seek validation up */
	function _seekValidationUp(node: SeekVldNode, isInput: boolean, parentNode: SeekVldNode | undefined, childrenData: SeekOutputData[]): SeekOutputData {
		var varId: SeekOutputData;
		switch (node.kind) {
			case Kind.FORMATTED_INPUT_OBJECT: {
				// Add entity to circle check
				seekVldCircle.add(node);
				return node.fields;
			}
			case Kind.INPUT_FIELD: return node.type == null ? undefined : [node.type];
			case Kind.UNION: {
				seekVldCircle.add(node);
				return node.types;
			}
			case Kind.LIST: {
				varId = childrenData[0] as ts.Expression | undefined; // "undefined" means has circular to parents
				if (varId != null) {



					if (entity.required) varId = genRequiredExpr(varId, 'requiredExpr');
					varId = f.createNewExpression(GraphQLList, undefined, [varId]);
				}
				break;
			}
			case Kind.REF: {
				varId = childrenData[0]; // "undefined" means has circular to parents
				if (varId == null) {
					let refEntity = rootInput.get(node.name);
					varId = mapVldEntityVar.get(refEntity!.escapedName);
				}
				break;
			}
			case Kind.ENUM:
			case Kind.SCALAR:
			case Kind.BASIC_SCALAR:
			case Kind.ENUM_MEMBER:
				return undefined; // Those are already checked by graphQL
			default: {
				let n: never = node;
			}
		}
		return varId;
	}
}

/** Seek data */
type SeekOutputData = ts.Expression | ts.PropertyAssignment | undefined;


/** Relative path */
function _relative(from: string, to: string) {
	var p = relative(from, to);
	p = p.replace(/\\/g, '/');
	var c = p.charAt(0);
	if (c !== '.' && c !== '/') p = './' + p;
	return p;
}

/** Circle queue item */
type CircleQueueItem = CircleQueueInputField | CircleQueueOutputField | CircleQueueUnion;
interface CircleQueueInputField {
	type: Kind.INPUT_FIELD
	/** Node containing circle */
	node: FormattedInputNode,
	/** Field of circle */
	field: formattedInputField,
	/** Fields var */
	varId: ts.Identifier
}
interface CircleQueueOutputField {
	type: Kind.OUTPUT_FIELD
	/** Node containing circle */
	node: FormattedOutputNode,
	/** Field of circle */
	field: formattedOutputField,
	/** Fields var */
	varId: ts.Identifier
}

interface CircleQueueUnion {
	type: Kind.UNION,
	/** Union entity */
	union: FormattedUnion,
	/** types array var */
	varId: ts.Identifier
	isInput: boolean
}