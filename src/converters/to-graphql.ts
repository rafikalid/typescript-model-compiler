import { format } from '@src/parser/format';
import ts from 'typescript';
import { ToDataReturn } from './to-data-model';
import { FormattedOutputNode, FormattedInputNode, formattedInputField, formattedOutputField, FormattedBasicScalar, FormattedEnumMember, FormattedNode, FormattedUnion, FormattedInputObject, FormattedOutputObject } from '@src/parser/formatted-model';
import { FieldType, Kind, MethodDescriptor, List, Param, MethodDescM, Reference } from '../parser/model';
import { relative, dirname } from 'path';
import { GraphQLArgumentConfig, GraphQLEnumTypeConfig, GraphQLEnumValueConfig, GraphQLFieldConfig, GraphQLInputFieldConfig, GraphQLInputObjectTypeConfig, GraphQLObjectTypeConfig, GraphQLScalarTypeConfig, GraphQLSchemaConfig, GraphQLUnionTypeConfig } from 'graphql';
import { seek } from './seek';
import { TargetExtension } from '@src/compile';
import { InputField, InputList, InputObject, Kind as ModelKind } from 'tt-model';
import { compileAsserts } from '@src/validator/compile-asserts';

/**
 * Generate Graphql schema from data
 */
export function toGraphQL(
	f: ts.NodeFactory,
	srcFile: ts.SourceFile,
	{
		input: rootInput,
		output: rootOutput,
		rootConfig: rootConfig
	}: ReturnType<typeof format>,
	pretty: boolean,
	targetExtension: TargetExtension | undefined
): ToDataReturn {
	type SeekNode = FormattedOutputNode | FormattedInputNode | FieldType | FormattedEnumMember | formattedOutputField | formattedInputField | Param;
	/** srcFile path */
	const srcFilePath = srcFile.fileName;
	/** Create root wrappers */
	const RootWrappersIdentifier = rootConfig.wrappers.length === 0 ? undefined : f.createUniqueName('wrap');
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
	// Validation function
	const inputValidationWrapperId = _ttModelImport('pipeInputGQL');
	const ttModelError = _ttModelImport('ModelError');
	const ttModelErrorCode = _ttModelImport('ErrorCodes');
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
	const mapVldEntityVar: Map<string, ts.Identifier | false> = new Map();
	const circlesVldQueue: CircleQueueItem[] = [];
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
					fieldConf.resolve = _wrapResolver(field.method, field.param);
					if (field.param != null && field.param.type != null) {
						fieldConf.args = _fieldArg(field.param);
					}
				} else if (field.alias) {
					fieldConf.resolve = _resolveOutputAlias(field.name);
				}
				circleStatementsBlock.push(_affect(
					f.createPropertyAccessExpression(item.varId, field.alias ?? field.name),
					_serializeObject(fieldConf)
				));
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
				circleStatementsBlock.push(_affect(
					f.createPropertyAccessExpression(item.varId, field.alias ?? field.name),
					_serializeObject(fieldConf)
				));
				break;
			}
			case Kind.UNION: {
				let { varId, union, isInput } = item;
				// Check for circles
				const types: ts.Expression[] = [];
				for (let i = 0, refs = union.types, len = refs.length; i < len; ++i) {
					let ref = refs[i];
					let refEntity = isInput ? rootOutput.get(ref.name) : rootOutput.get(ref.name);
					if (refEntity == null) throw `Missing ${isInput ? 'input' : 'output'} entity "${ref.name}" using union reference at ${ref.fileName}`;
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
	//* Add Input validation circle fields
	if (circlesVldQueue.length > 0) {
		let values: Map<ts.Identifier, ts.Expression[]> = new Map();
		for (let i = 0, len = circlesVldQueue.length; i < len; ++i) {
			let item = circlesVldQueue[i];
			if (item.type != Kind.INPUT_FIELD) throw new Error(`Unexpected input validation kind "${Kind[item.type]}"`);
			let confExpr = seek<SeekVldNode, SeekOutputData>([item.field], _seekValidationDown, _seekValidationUp)[0] as ts.Expression;
			// Group
			let grp = values.get(item.varId);
			if (grp == null) values.set(item.varId, [confExpr]);
			else grp.push(confExpr);
		}
		values.forEach((arr, varId) => {
			circleStatementsBlock.push(
				f.createExpressionStatement(f.createCallExpression(
					f.createPropertyAccessExpression(varId, 'push'), undefined, arr
				))
			);
		});
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
	//* Add root wrappers
	if (RootWrappersIdentifier != null) {
		statementsBlock.push(_genWrappers(rootConfig.wrappers, RootWrappersIdentifier));
	}
	//* Return
	return {
		imports,
		node: f.createCallExpression(
			f.createParenthesizedExpression(f.createFunctionExpression(
				undefined, undefined, undefined, undefined, [], undefined,
				f.createBlock(statementsBlock, pretty)
			)), undefined, []
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
				f.createImportSpecifier(false, f.createIdentifier(name), id)
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
	function _import(method: MethodDescM) {
		var fl = srcImports.get(method.fileName);
		if (fl == null) {
			fl = new Map();
			srcImports.set(method.fileName, fl);
		}
		var vr = fl.get(method.className);
		if (vr == null) {
			vr = {
				varName: f.createUniqueName(method.className),
				isClass: (method as MethodDescriptor).isClass
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
						f.createImportSpecifier(false, f.createIdentifier(className), isp)
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
						f.createImportSpecifier(false, f.createIdentifier(className), varName)
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
				let entity = _getEntity(node, isInput);
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
					if (entity.required) varId = genRequiredExpr(varId, 'required' + entity.name);
					let fieldConf: { [k in keyof GraphQLFieldConfig<any, any, any>]: any } = {
						type: varId
					};
					// Other info
					if (entity.deprecated) fieldConf.deprecationReason = entity.deprecated;
					if (entity.jsDoc) fieldConf.description = entity.jsDoc;
					if (entity.method) {
						fieldConf.resolve = _wrapResolver(entity.method, entity.param);
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
					if (entity.required) varId = genRequiredExpr(varId, 'required' + entity.name);
					let fieldConf: { [k in keyof GraphQLInputFieldConfig]: any } = {
						type: varId
					};
					// Other info
					if (entity.defaultValue) fieldConf.defaultValue = f.createIdentifier(entity.defaultValue);
					if (entity.deprecated) fieldConf.deprecationReason = entity.deprecated;
					if (entity.jsDoc) fieldConf.description = entity.jsDoc;
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
							_callExpression(
								f.createPropertyAccessExpression(
									_import(entity.parser),
									f.createIdentifier('resolveType')
								)
								, ['value', 'ctx', 'info'])
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
					if (entity.required) varId = genRequiredExpr(varId, 'requiredList');
					varId = f.createNewExpression(GraphQLList, undefined, [varId]);
				}
				break;
			}
			case Kind.REF: {
				varId = childrenData[0]; // "undefined" means has circular to parents
				if (varId == null) {
					let refEntity = _getEntity(entity, isInput);
					varId = mapEntityVar.get(refEntity.escapedName);
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
			if (field.defaultValue) fieldConf.defaultValue = f.createIdentifier(field.defaultValue);
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
			parseValue: f.createPropertyAccessExpression(scalarParser, 'parse'),
			serialize: f.createPropertyAccessExpression(scalarParser, 'serialize'),
			description: f.createPropertyAccessExpression(scalarParser, 'description'),
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
	function _getMethodCall(varId: ts.Identifier, method: MethodDescM, methodName?: string) {
		methodName ??= method.name!;
		return f.createPropertyAccessExpression(
			varId,
			(method as MethodDescriptor).isClass
				? f.createIdentifier(methodName)
				: f.createIdentifier(
					(method as MethodDescriptor).isStatic === false
						? `prototype.${methodName}`
						: methodName
				)
		);
	}
	/** Resolve output alias */
	function _resolveOutputAlias(name: string) {
		return f.createFunctionExpression(
			undefined, undefined, undefined, undefined, _getResolverArgs(['parent']), undefined, f.createBlock([
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
		let entity = _getEntity(tp, isInput);
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
	function _wrapResolver(method: MethodDescM, param: Param | undefined): ts.Expression {
		let resolveCb = _getMethodCall(_import(method), method);
		let useAsync = false;
		seekVldCircle.clear();
		// mapVldEntityVar.clear();
		// circlesVldQueue.length = 0;
		let result: ts.Expression | false | undefined;
		let inputType = param?.type;
		if (inputType != null) {
			let inputEntity = rootInput.get(inputType.name);
			if (inputEntity == null) throw `Unexpected missing input entity "${inputType.name}" referenced at: ${inputType.fileName}`;
			result = mapVldEntityVar.get(inputEntity.escapedName);
			if (result == null) result = seek<SeekVldNode, SeekOutputData>([inputEntity], _seekValidationDown, _seekValidationUp)[0] as ts.Expression | false | undefined;
		}
		// Create wrapper
		let body: ts.Statement[] = [];
		//* Add before
		if (rootConfig.before.length > 0) {
			for (let i = 0, arr = rootConfig.before, len = arr.length; i < len; ++i) {
				let method = arr[i];
				body.push(_affect('args', _callMethod(method)));
				if (method.isAsync) useAsync = true;
			}
		}
		//* Validate input data
		if (result != null && result !== false) {
			body.push(
				// Validation
				f.createVariableStatement(undefined, f.createVariableDeclarationList([
					f.createVariableDeclaration(
						f.createIdentifier("resp"),
						undefined, undefined,
						f.createAwaitExpression(
							_callExpression(inputValidationWrapperId, [result, 'parent', 'args', 'ctx', 'info'])
						)
					)
				], ts.NodeFlags.Let)),
				// Check for errors
				f.createIfStatement(
					f.createBinaryExpression(_propertyAccess('resp', 'errors', 'length'),
						f.createToken(ts.SyntaxKind.GreaterThanToken),
						f.createNumericLiteral("0")
					),
					f.createThrowStatement(
						f.createNewExpression(ttModelError, undefined, [
							f.createPropertyAccessExpression(ttModelErrorCode, "VALIDATION_ERRORS"),
							f.createIdentifier('`Model Errors:\\n\\t‣ ${ resp.errors.join("\\n\\t‣ ")}`')
						])
					),
					undefined
				),
				// Affect value
				_affect('args', f.createPropertyAccessExpression(f.createIdentifier("resp"), 'value'))
			);
			useAsync = true; // Validation is an async operation
		}
		//* Return resolver value
		if (rootConfig.after.length === 0) {
			body.push(
				f.createExpressionStatement(f.createIdentifier('//@ts-ignore')),
				f.createReturnStatement(_callExpression(resolveCb, ['parent', 'args', 'ctx', 'info']))
			);
		} else {
			let expr: ts.CallExpression | ts.AwaitExpression = _callExpression(resolveCb, ['parent', 'args', 'ctx', 'info']);
			if (method.isAsync) {
				useAsync = true;
				expr = f.createAwaitExpression(expr);
			}
			body.push(
				f.createExpressionStatement(f.createIdentifier('//@ts-ignore')),
				_affect('args', expr));
			//* Add "rootConfig.after"
			for (let i = 0, arr = rootConfig.after, len = arr.length; i < len; ++i) {
				let method = arr[i];
				body.push(_affect('args', _callMethod(method)));
				if (method.isAsync) useAsync = true;
			}
			body.push(f.createReturnStatement(f.createIdentifier('args')));
		}

		var fx = f.createFunctionExpression(
			useAsync ? [f.createModifier(ts.SyntaxKind.AsyncKeyword)] : undefined
			, undefined, undefined, undefined, _getResolverArgs(['parent', 'args', 'ctx', 'info']), undefined, f.createBlock(body, pretty));
		//* Add wrappers
		if (RootWrappersIdentifier != null) {
			fx = f.createFunctionExpression(undefined, undefined, undefined, undefined, _getResolverArgs(['parent', 'args', 'ctx', 'info']), undefined, f.createBlock([
				f.createReturnStatement(
					_callExpression(RootWrappersIdentifier, ['parent', 'args', 'ctx', 'info', fx])
				)
			], pretty))
		}
		//* Return
		return fx;
	}
	/** Seek validation down */
	function _seekValidationDown(node: SeekVldNode, isInput: boolean, parentNode: SeekVldNode | undefined): SeekVldNode[] | { nodes: SeekVldNode[], isInput: boolean } | undefined | false {
		switch (node.kind) {
			case Kind.FORMATTED_INPUT_OBJECT: {
				// Add entity to circle check
				seekVldCircle.add(node);
				return node.fields;
			}
			case Kind.INPUT_FIELD: return node.type == null ? undefined : [node.type];
			case Kind.ENUM: return node.members
			case Kind.LIST: return [node.type];
			case Kind.REF: {
				let entity = _getEntity(node, true) as FormattedInputNode;
				let entityEscapedName = entity.escapedName;
				if (mapVldEntityVar.has(entityEscapedName)) return undefined;
				if (seekVldCircle.has(entity)) return undefined; // Circular
				return [entity];
			}
			case Kind.UNION: // No union in graphQL
			case Kind.SCALAR:
			case Kind.BASIC_SCALAR:
			case Kind.ENUM_MEMBER:
				return false;
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
				// Remove entity from circle check
				seekVldCircle.delete(node);
				// Check for circles
				const fields: ts.ObjectLiteralExpression[] = [];
				const circleFields: formattedInputField[] = [];
				let activeFieldsCount = 0;
				for (let i = 0, arr = node.fields, len = arr.length; i < len; ++i) {
					let field = childrenData[i] as ts.ObjectLiteralExpression | undefined | false;
					let fieldData = arr[i];
					if (field == null) circleFields.push(fieldData);
					else if (field != false) {
						fields.push(field);
						++activeFieldsCount;
					} else {
						let conf: { [k in keyof InputField]: any } = {
							name: fieldData.name,
							alias: fieldData.alias ?? fieldData.name,
							required: fieldData.required,
							type: undefined,
							assert: undefined,
							pipe: undefined,
							pipeAsync: false
						};
						fields.push(_serializeObject(conf));
					}
				}
				// Ignore if has no child to valid and has no validation
				if (
					activeFieldsCount === 0 &&
					circleFields.length === 0 &&
					node.before == null &&
					node.after == null &&
					(node.wrappers == null || node.wrappers.length === 0)
				) {
					varId = false;
					mapVldEntityVar.set(node.escapedName, false);
					break;
				}
				// Create properties list
				let fieldsArrExpression: ts.Expression = f.createArrayLiteralExpression(fields, pretty);
				if (circleFields.length) {
					let fieldsVar = f.createUniqueName(`${node.escapedName}_fields`);
					inputDeclarations.push(
						f.createVariableDeclaration(
							fieldsVar, undefined, undefined, fieldsArrExpression
						)
					);
					fieldsArrExpression = fieldsVar;
					// Add to circle queue
					for (let i = 0, len = circleFields.length; i < len; ++i) {
						circlesVldQueue.push({
							type: Kind.INPUT_FIELD, node, field: circleFields[i], varId: fieldsVar
						});
					}
				}
				// Create object
				let beforeConf = _concatBeforeAfter(node.before);
				let afterConf = _concatBeforeAfter(node.after);
				let entityConf: { [k in keyof InputObject]: any } = {
					kind: ModelKind.INPUT_OBJECT,
					name: node.name,
					fields: fieldsArrExpression,
					before: beforeConf.expr,
					beforeAsync: beforeConf.isAsync,
					after: afterConf.expr,
					afterAsync: afterConf.isAsync,
					wrap: node.wrappers == null ? undefined : _genWrappers(node.wrappers)
				};
				let vName = varId = f.createUniqueName(node.escapedName);
				inputDeclarations.push(
					f.createVariableDeclaration(
						vName, undefined, undefined, _serializeObject(entityConf)
					)
				);
				// Add var
				mapVldEntityVar.set(node.escapedName, vName);
				break;
			}
			case Kind.INPUT_FIELD: {
				//* Type
				varId = childrenData[0] as ts.Expression | undefined | false; // "undefined" means has circular to parents
				if (varId == null) { } // circular field
				else if ( // Ignore if own children ignored and has no validation rule
					varId === false &&
					node.alias == null &&
					node.asserts == null &&
					node.convert == null &&
					node.pipe.length === 0
				) { }
				else {
					// Conf
					let pipeM = _generatePipe(node);
					let conf: { [k in keyof InputField]: any } = {
						name: node.name,
						alias: node.alias ?? node.name,
						required: node.required,
						type: varId === false ? undefined : varId,
						assert: node.asserts == null ? undefined : compileAsserts(node.name, node.asserts, node.type, f, pretty),
						pipe: pipeM.fx,
						pipeAsync: pipeM.useAsync
					};
					varId = _serializeObject(conf);
				}
				break;
			}
			case Kind.LIST: {
				varId = childrenData[0] as ts.Expression | undefined | false; // "undefined" means has circular to parents
				if (varId != null && varId != false) {
					let conf: { [k in keyof InputList]: any } = {
						kind: ModelKind.INPUT_LIST,
						required: node.required, // Graphql will take care of this
						type: varId
					};
					varId = _serializeObject(conf);
				}
				break;
			}
			case Kind.REF: {
				varId = childrenData[0]; // "undefined" means has circular to parents
				if (varId == null) {
					let refEntity = _getEntity(node, true);
					if (refEntity == null) throw `Missing entity: ${node.name}`;
					varId = mapVldEntityVar.get(refEntity.escapedName);
				}
				break;
			}
			case Kind.UNION: // No union in graphQL
			case Kind.ENUM:
			case Kind.SCALAR:
			case Kind.BASIC_SCALAR:
			case Kind.ENUM_MEMBER:
				varId = false;
				break; // Those are already checked by graphQL
			default: {
				let n: never = node;
			}
		}
		return varId;
	}

	/** Resolver args */
	function _getResolverArgs(args: string[]) {
		var result: ts.ParameterDeclaration[] = [];
		for (let i = 0, len = args.length; i < len; i++) {
			result.push(
				f.createParameterDeclaration(undefined, undefined, undefined,
					f.createIdentifier(args[i]), undefined,
					f.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword), undefined)
			);
		}
		return result;
	}
	/** Concat before and after */
	function _concatBeforeAfter(arr: MethodDescM[] | undefined): { expr: ts.Expression | undefined, isAsync: boolean } {
		if (arr == null) return { expr: undefined, isAsync: false };
		let body: ts.Statement[] = [];
		// Add first methods
		let len = arr.length - 1;
		let useAsync = false;
		for (let i = 0; i < len; ++i) {
			let method = arr[i];
			let expr: ts.Expression = _createMethodCallExp(method);
			if (method.isAsync) {
				expr = f.createAwaitExpression(expr);
				useAsync = true;
			}
			body.push(_affect('args', expr));
		}
		// Add Last method
		let method = arr[len];
		body.push(f.createReturnStatement(_createMethodCallExp(method)));
		// create method
		return {
			expr: f.createFunctionExpression(
				useAsync ? [f.createModifier(ts.SyntaxKind.AsyncKeyword)] : undefined,
				undefined, undefined, undefined, _getResolverArgs(['parent', 'args', 'ctx', 'info']), undefined, f.createBlock(body)),
			isAsync: useAsync || method.isAsync
		};
	}
	/** Create resolver call expression */
	function _createMethodCallExp(method: MethodDescM) {
		let vldId = _import(method);
		return _callExpression(_getMethodCall(vldId, method), ['parent', 'args', 'ctx', 'info']);
	}
	/** Generate wrappers */
	function _genWrappers(wrappers: MethodDescM[]): ts.FunctionExpression;
	function _genWrappers(wrappers: MethodDescM[], name: ts.Identifier | string): ts.FunctionDeclaration;
	function _genWrappers(wrappers: MethodDescM[], name?: ts.Identifier | string | undefined) {
		let body: ts.Statement[] = [];
		let wLen = wrappers.length - 1;
		// Add others if len > 2
		let nextId = f.createIdentifier('next');
		for (let i = wLen - 1; i >= 0; --i) {
			let method = wrappers[i];
			let methodId = f.createUniqueName('next');
			body.push(
				f.createFunctionDeclaration(
					undefined, undefined, undefined, methodId, undefined, [], undefined,
					f.createBlock([
						f.createExpressionStatement(
							f.createCallExpression(
								_getMethodCall(_import(method), method), undefined,
								[
									f.createIdentifier('parent'),
									f.createIdentifier('args'),
									f.createIdentifier('ctx'),
									f.createIdentifier('info'),
									nextId
								]
							)
						)
					]))
			);
			nextId = methodId;
		}
		// Add last one
		let method = wrappers[wLen];
		body.push(
			f.createExpressionStatement(
				f.createCallExpression(
					_getMethodCall(_import(method), method), undefined,
					[
						f.createIdentifier('parent'),
						f.createIdentifier('args'),
						f.createIdentifier('ctx'),
						f.createIdentifier('info'),
						nextId
					]
				)
			)
		)
		// create method
		let params = _getResolverArgs(['parent', 'args', 'ctx', 'info', 'next']);
		if (name == null)
			return f.createFunctionExpression(
				undefined, undefined, undefined, undefined, params, undefined, f.createBlock(body));
		else return f.createFunctionDeclaration(undefined, undefined, undefined, name, undefined, params, undefined, f.createBlock(body));
	}
	/** Create call expression */
	function _callExpression(expr: ts.Expression, params: (string | ts.Expression)[]) {
		let args = [];
		for (let i = 0, len = params.length; i < len; i++) {
			let param = params[i];
			if (typeof param === 'string')
				args.push(f.createIdentifier(param));
			else
				args.push(param);
		}
		//return
		return f.createCallExpression(expr, undefined, args);
	}
	/** Affect expression */
	function _affect(varname: string | ts.Expression, value: ts.Expression) {
		if (typeof varname === 'string') varname = f.createIdentifier(varname);
		return f.createExpressionStatement(
			f.createBinaryExpression(
				varname,
				f.createToken(ts.SyntaxKind.EqualsToken),
				value
			)
		)
	}
	/** Add method expression expression */
	function _callMethod(method: MethodDescM, args = ['parent', 'args', 'ctx', 'info']) {
		let expr: ts.CallExpression | ts.AwaitExpression = _callExpression(_getMethodCall(_import(method), method), args);
		if (method.isAsync) expr = f.createAwaitExpression(expr);
		return expr;
	}
	/** Get entity or it's converted by name */
	function _getEntity(ref: Reference, isInput: boolean) {
		let rootEntityMap = isInput === true ? rootInput : rootOutput;
		let entity = rootEntityMap.get(ref.name);
		if (entity == null)
			throw `Missing ${isInput ? 'input' : 'output'} entity "${ref.name}" referenced at ${ref.fileName}`;
		// Check if has converter
		let cnv = (entity as FormattedInputObject).convert;
		if (cnv != null && cnv.type != null) {
			let ent = rootEntityMap.get(cnv.type.name);
			if (ent == null)
				throw `Missing ${isInput ? 'input' : 'output'} entity "${cnv.type.name}" converted from "${entity.name}" defined at "${cnv.className}.${cnv.name}" at ${cnv.fileName}`;
			entity = ent;
		}
		return entity;
	}
	/** Generate pipe */
	function _generatePipe(node: formattedInputField) {
		var pipe = node.convert == null ? node.pipe : [...node.pipe, node.convert];
		var result: ts.FunctionExpression | undefined;
		var useAsync = false;
		if (pipe.length > 0) {
			// Add first functions
			let body: ts.Statement[] = [];
			let lastIndex = pipe.length - 1;
			for (let i = 0; i < lastIndex; ++i) {
				let method = pipe[i];
				let expr: ts.Expression = _createMethodCallExp(method);
				if (method.isAsync) {
					expr = f.createAwaitExpression(expr);
					useAsync = true;
				}
				body.push(_affect('args', expr));
			}
			// Add last line with return statement
			body.push(
				f.createReturnStatement(_createMethodCallExp(pipe[lastIndex]))
			);

			result = f.createFunctionExpression(
				useAsync ? [f.createModifier(ts.SyntaxKind.AsyncKeyword)] : undefined,
				undefined, undefined, undefined, _getResolverArgs(['parent', 'args', 'ctx', 'info']),
				undefined, f.createBlock(body, pretty)
			);
		}
		return { fx: result, useAsync };
	}
	/** Property access */
	function _propertyAccess(...props: string[]) {
		var result: ts.PropertyAccessExpression =
			f.createPropertyAccessExpression(f.createIdentifier(props[0]), f.createIdentifier(props[1]));
		for (let i = 2, len = props.length; i < len; ++i)
			result = f.createPropertyAccessExpression(result, f.createIdentifier(props[i]));
		return result;
	}
}

/** Seek data */
type SeekOutputData = ts.Expression | ts.PropertyAssignment | undefined | false;


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


