import { Kind } from "@parser/kind";
import { RootNode, ScalarNode } from "@parser/model";
import { getNodePath } from "@utils/node-path";
import { Scalar } from "tt-model";
import ts from "typescript";
import { Compiler } from "..";
import { _resolveHandler } from "./utils";

/**
 * Resolve scalars
 */
export function _resolveScalars(compiler: Compiler, compilerOptions: ts.CompilerOptions, data: Map<string, RootNode | undefined>) {
	//* Resolve scalars and their parsers
	const scalarsAssert = new Map<string, Scalar<any>["assertJsDocParser"]>();
	const scalarsDefault = new Map<string, Scalar<any>["defaultJsDocParser"]>();
	const cacheCall = compiler._cacheCallExpression;
	const errors: string[] = [];
	data.forEach(function (entity, scalarName) {
		try {
			if (entity == null) { }
			else if (entity.kind === Kind.SCALAR) {
				_parseHandler(entity, scalarName, 'assertJsDocParser', scalarsAssert);
				_parseHandler(entity, scalarName, 'defaultJsDocParser', scalarsDefault);
			}
		} catch (err) {
			if (typeof err === 'string') errors.push(err);
			else throw err;
		}
	});
	//* Throw errors if found
	if (errors.length) throw new Error(`Parsing Errors: \n\t- ${errors.join('\n\t- ')}`);
	//* Return
	return {
		assert: scalarsAssert,
		default: scalarsDefault
	};

	function _parseHandler(scalarNode: ScalarNode, scalarName: string, key: string, targetMap: Map<string, any>) {
		const callEl = scalarNode.fields.get(key);
		if (callEl?.method == null) return;
		const tsNode = callEl.method.tsNode;
		if (
			ts.isMethodDeclaration(tsNode) ||
			ts.isFunctionDeclaration(tsNode) ||
			ts.isCallExpression(tsNode)
		) {
			let fx = cacheCall.get(tsNode);
			if (fx == null) {
				fx = _resolveHandler(tsNode, compilerOptions);
				if (fx == null)
					throw `Could not compile handler for "${scalarName}.${key}" at: ${getNodePath(tsNode)}`;
				cacheCall.set(tsNode, fx);
			}
			targetMap.set(scalarName, fx);
		} else {
			throw `Expected call expression for "${scalarName}.${key}". Got "${ts.SyntaxKind[tsNode.kind]}" at: ${getNodePath(tsNode)}`;
		}
	}
}



/** Scalar parsers */
type ScalarParsers = Pick<Scalar<any>, 'assertJsDocParser' | 'defaultJsDocParser'>; 