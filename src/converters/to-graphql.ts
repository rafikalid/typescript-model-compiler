import { format } from '@src/parser/format';
import ts from 'typescript';
import { ToDataReturn } from './to-data-model';
import { FormattedOutputNode, FormattedInputNode, formattedInputField, formattedOutputField, FormattedOutputObject, FormattedBasicScalar, FormattedEnumMember, FormattedNode, FormattedUnion } from '@src/parser/formatted-model';
import { FieldType, Kind, MethodDescriptor, Reference, List, Param, EnumMember, BasicScalar } from '../parser/model';
import { relative } from 'path';
import { GraphQLEnumTypeConfig, GraphQLEnumValueConfig, GraphQLFieldConfig, GraphQLInputFieldConfig, GraphQLObjectTypeConfig, GraphQLScalarTypeConfig, GraphQLSchemaConfig, GraphQLUnionTypeConfig } from 'graphql';
import { seek } from './seek';

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
	pretty: boolean
): ToDataReturn {
	type SeekNode = FormattedOutputNode | FieldType | FormattedEnumMember | formattedOutputField;
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
	const GraphQLUnionType = _gqlImport('GraphQLUnionType');
	/** Import from tt-model */
	const ttModelImports: Map<string, ts.Identifier> = new Map();
	//* Other imports
	type srcImportEntry = Map<string, { varName: ts.Identifier; isClass: boolean }>;
	const srcImports: Map<string, srcImportEntry> = new Map();
	/** Create class objects */
	const importCreateObjects: ts.VariableDeclaration[] = [];
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
	/** Go through nodes */
	const seekCircle: Set<FormattedOutputNode> = new Set();
	seek<SeekNode, SeekOutputData>(queue, _seekOutputDown, _seekOutputUp);

	//* Imports
	const imports = _genImports(); // Generate imports from src
	imports.push(
		_genImportDeclaration('graphql', gqlImports), // Graphql imports
		_genImportDeclaration('tt-model', ttModelImports) // tt-model imports
	);
	//* Create block statement
	const statementsBlock: ts.Statement[] = [];
	if (importCreateObjects.length)
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
			gqlImports.set(name, id);
		}
		return id;
	}
	/** Generate import declaration for graphQl & tt-model */
	function _genImportDeclaration(packageName: string, map: Map<string, ts.Identifier>) {
		const specifiers: ts.ImportSpecifier[] = [];
		gqlImports.forEach((id, name) => {
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
							varName,
							undefined,
							undefined,
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
						_relative(srcFilePath, filename.replace(/\.tsx?$/, ''))
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
			if (v == null) v = f.createIdentifier('undefined');
			else if (typeof v === 'string') v = f.createStringLiteral(v);
			else if (typeof v === 'number') v = f.createNumericLiteral(v);
			else if (typeof v === 'boolean')
				v = v === true ? f.createTrue() : f.createFalse();
			fieldArr.push(f.createPropertyAssignment(f.createIdentifier(k), v));
		}
		return f.createObjectLiteralExpression(fieldArr, pretty);
	}

	/** Seek down */
	function _seekOutputDown(node: SeekNode, parentNode: SeekNode | undefined): SeekNode[] | undefined {
		switch (node.kind) {
			case Kind.FORMATTED_OUTPUT_OBJECT: {
				// Add entity to circle check
				seekCircle.add(node);
				// List fields
				let result: formattedOutputField[] = [];
				for (let i = 0, fields = node.fields, len = fields.length; i < len; ++i) {
					result.push(fields[i]);
				}
				return result;
			}
			case Kind.OUTPUT_FIELD: {
				return [node.type];
			}
			case Kind.UNION: {
				// Add entity to circle check
				seekCircle.add(node);
				// List types
				let result: Reference[] = [];
				for (let i = 0, fields = node.types, len = fields.length; i < len; ++i) {
					result.push(fields[i]);
				}
				return result;
			}
			case Kind.ENUM: {
				let result: FormattedEnumMember[] = [];
				for (let i = 0, members = node.members, len = members.length; i < len; ++i)
					result.push(members[i]);
				return result;
			}
			case Kind.LIST:
				return [node.type];
			case Kind.REF: {
				let entityName = node.name;
				if (mapEntityVar.has(entityName)) return undefined;
				let entity = rootOutput.get(entityName);
				if (entity == null) throw `Missing entity "${entityName}" referenced at ${node.fileName}`;
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
	function _seekOutputUp(entity: SeekNode, parentNode: SeekNode | undefined, childrenData: SeekOutputData[]): SeekOutputData {
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
							node: entity, field: circleFields[i], varId: fieldsVar
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
				break;
			}
			case Kind.OUTPUT_FIELD: {
				varId = childrenData[0] as ts.Expression | undefined; // "undefined" means has circular to parents
				if (varId != null) {
					// Type
					if (entity.required) varId = f.createNewExpression(GraphQLNonNull, undefined, [varId]);
					let fieldConf: { [k in keyof GraphQLFieldConfig<any, any, any>]: any } = {
						type: varId
					};
					// Other info
					if (entity.deprecated) fieldConf.deprecationReason = entity.deprecated;
					if (entity.jsDoc) fieldConf.description = entity.jsDoc;
					if (entity.method) {
						let methodVar = _import(entity.method);
						fieldConf.resolve = _wrapResolver(_getMethodCall(methodVar, entity.method), entity.param);
					} else if (entity.alias) {
						fieldConf.resolve = _resolveOutputAlias(entity.name);
					}
					varId = f.createPropertyAssignment(entity.alias ?? entity.name, _serializeObject(fieldConf));
				}
				break;
			}
			case Kind.UNION: {
				// Remove entity from circle check
				seekCircle.delete(entity);
				// Check for circles
				const types: ts.Expression[] = [];
				const circleTypes: (Omit<CircleQueueItemUnion, 'varId'> & { varId: undefined })[] = []
				for (let i = 0, arr = entity.types, len = arr.length; i < len; ++i) {
					let type = childrenData[i];
					if (type == null) circleTypes.push({
						union: entity, type: arr[i], index: i, varId: undefined
					});
					else types.push(type as ts.Expression);
				}
				// Create fields
				let typesArr: ts.Expression = f.createArrayLiteralExpression(types, pretty);
				if (circleTypes.length) {
					let v = f.createUniqueName(`${entity.escapedName}_types`);
					graphqlDeclarations.push(
						f.createVariableDeclaration(
							v, undefined, undefined, typesArr
						)
					);
					typesArr = v;
					// Add to circle queue
					for (let i = 0, len = circleTypes.length; i < len; ++i) {
						let item = circleTypes[i] as any as CircleQueueItemUnion;
						item.varId = v;
						circlesQueue.push(item);
					}
				}
				// create union
				let entityConf: { [k in keyof GraphQLUnionTypeConfig<any, any>]: any } = {
					name: entity.escapedName,
					types: typesArr,
					resolveType: _createMethod('resolveType', ['value', 'ctx', 'info'], [
						f.createReturnStatement(f.createElementAccessExpression(
							typesArr,
							f.createCallExpression(
								f.createPropertyAccessExpression(
									_import(entity.parser!),
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
				break;
			}
			case Kind.LIST: {
				varId = childrenData[0] as ts.Expression | undefined; // "undefined" means has circular to parents
				if (varId != null) {
					if (entity.required) {
						varId = f.createNewExpression(GraphQLNonNull, undefined, [varId]);
					}
					varId = f.createNewExpression(GraphQLList, undefined, [varId]);
				}
				break;
			}
			case Kind.REF: {
				varId = childrenData[0]; // "undefined" means has circular to parents
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
				break;
			}
			default: {
				let _never: never = entity;
				throw _never;
			}
		}
		return varId;
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
	/** Add resolver */
	function _wrapResolver(resolveCb: ts.Expression, param: Param | undefined): ts.Expression {
		// TODO implement resolver wrappers
		return resolveCb;
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
type CircleQueueItem = CircleQueueItemObj | CircleQueueItemUnion;
interface CircleQueueItemObj {
	/** Node containing circle */
	node: FormattedOutputNode,
	/** Field of circle */
	field: formattedOutputField,
	/** Fields var */
	varId: ts.Identifier
}

interface CircleQueueItemUnion {
	/** Union entity */
	union: FormattedUnion,
	/** Target type */
	type: Reference
	/** Index */
	index: number
	/** types array var */
	varId: ts.Identifier
}