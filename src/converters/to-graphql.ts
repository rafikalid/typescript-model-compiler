import { format } from '@src/parser/format';
import ts from 'typescript';
import { ToDataReturn } from './to-data-model';
import { FormattedOutputNode, FormattedInputNode, formattedInputField, formattedOutputField } from '@src/parser/formatted-model';
import { FieldType, Kind, MethodDescriptor } from '../parser/model';
import { relative } from 'path';
import { GraphQLSchemaConfig } from 'graphql';

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
	/** srcFile path */
	const srcFilePath = srcFile.fileName;
	/** Validation schema declarations by the API */
	const inputDeclarations: ts.VariableDeclaration[] = [];
	/** Graphql types declaration */
	const graphqlDeclarations: ts.VariableDeclaration[] = [];
	/** Graphql imports */
	const gqlImports: Map<string, ts.Identifier> = new Map();
	const GraphQLSchema = _gqlImport('GraphQLSchema');
	/** Import from tt-model */
	const ttModelImports: Map<string, ts.Identifier> = new Map();
	//* Other imports
	type srcImportEntry = Map<string, { varName: ts.Identifier; isClass: boolean }>;
	const srcImports: Map<string, srcImportEntry> = new Map();
	/** Create class objects */
	const importCreateObjects: ts.VariableDeclaration[] = [];
	//* Go through Model
	const queue: (FormattedOutputNode | FieldType)[] = [];
	/** Is node visited for first time (as 0) or second time (as 1) */
	const queueState: NodeVisit[] = [];
	let node: FormattedOutputNode | undefined;
	if (node = rootOutput.get('Subscription')) { queue.push(node); queueState.push(NodeVisit.FIRST_TIME); }
	if (node = rootOutput.get('Mutation')) { queue.push(node); queueState.push(NodeVisit.FIRST_TIME); }
	if (node = rootOutput.get('Query')) { queue.push(node); queueState.push(NodeVisit.FIRST_TIME); }
	//* Create schema
	/** Map entities to their vars */
	const mapEntityVar: Map<string, ts.Identifier> = new Map();
	rootLoop: while (true) {
		// Get current node
		const node = queue.pop();
		if (node == null) break;
		const nodeVisit = queueState.pop();
		// Switch on node type
		switch (node.kind) {
			case Kind.FORMATTED_OUTPUT_OBJECT: {
				if (nodeVisit === NodeVisit.FIRST_TIME) {
					// Go through fields
					for (let i = 0, fields = node.fields, len = fields.length; i < len; ++i) {
						let field = fields[i];
					}
				} else {

				}
				break;
			}
			case Kind.ENUM: {
				break;
			}
			case Kind.UNION: {
				break;
			}
			case Kind.SCALAR: {
				break;
			}
			case Kind.BASIC_SCALAR: {
				break;
			}
			case Kind.LIST: {
				break;
			}
			case Kind.REF: {
				break;
			}
			default: {
				let _never: never = node;
				throw _never;
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
}

/** Node state: is node visited for the first time or second time */
enum NodeVisit {
	FIRST_TIME,
	SECOND_TIME
};

/** Output Seek Queue */
interface OutputSeekQueue {
	node: FormattedOutputNode | FieldType,
	/** Is visited for the first or second time */
	isFirstTime: boolean,
	/** Field circles  */
}


/** Relative path */
function _relative(from: string, to: string) {
	var p = relative(from, to);
	p = p.replace(/\\/g, '/');
	var c = p.charAt(0);
	if (c !== '.' && c !== '/') p = './' + p;
	return p;
}