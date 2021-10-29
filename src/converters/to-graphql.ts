import { format } from '@src/parser/format';
import ts from 'typescript';
import { ToDataReturn } from './to-data-model';
import { FormattedOutputNode, FormattedInputNode, formattedInputField, formattedOutputField } from '@src/parser/formatted-model';
import { FieldType, Kind } from '../parser/model';
/**
 * Generate Graphql schema from data
 */
export function toGraphQL(
	f: ts.NodeFactory,
	{
		input: rootInput,
		output: rootOutput,
		wrappers: rootWrappers
	}: ReturnType<typeof format>,
	pretty: boolean
): ToDataReturn {
	/** Validation schema declarations by the API */
	const inputDeclarations: ts.VariableDeclaration[] = [];
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
		'GraphQLScalarType', GraphQLScalarType,
		'GraphQLSchema', GraphQLSchema,
		'GraphQLEnumType', GraphQLEnumType,
		'GraphQLObjectType', GraphQLObjectType,
		'GraphQLInputObjectType', GraphQLInputObjectType,
		'GraphQLList', GraphQLList,
		'GraphQLNonNull', GraphQLNonNull,
		'GraphQLUnionType', GraphQLUnionType,
		'GraphQLFieldResolver', GraphQLFieldResolver
	];
	//* tt-model imports
	const validateObj = f.createUniqueName('validateObj');
	const ttModelImports: (string | ts.Identifier)[] = [
		'validateObj', validateObj // TODO convert to validate graphQl object
	];
	//* Other imports
	const srcImports: Map<
		string,
		Map<string, { varName: ts.Identifier; isClass: boolean }>
	> = new Map();
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
	const mapEntityVar: Map<FormattedInputNode | FormattedOutputNode, ts.Identifier> = new Map();
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

	//* Return
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
	/** Generate Input object model */
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