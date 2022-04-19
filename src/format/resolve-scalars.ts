import { Kind } from "@parser/kind";
import { MethodNode, RootNode, ScalarNode } from "@parser/model";
import { parseSchema } from "@parser/parse";
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
	data.forEach(function (entity, scalarName) {
		if (entity == null) { }
		else if (entity.kind === Kind.SCALAR) {
			_parseHandler(entity, scalarName, 'assertJsDocParser', scalarsAssert);
			_parseHandler(entity, scalarName, 'defaultJsDocParser', scalarsDefault);
		}
	});
	return {
		assert: scalarsAssert,
		default: scalarsDefault
	};

	function _parseHandler(scalarNode: ScalarNode, scalarName: string, key: string, targetMap: Map<string, any>) {
		const callEl = scalarNode.fields.get(key);
		if (callEl?.method == null) return;
		const tsNode = callEl.method.tsNode;
		if (!ts.isCallExpression(tsNode))
			throw `Expected call expression for "${scalarName}.${key}" at: ${getNodePath(tsNode)}`;
		let fx = cacheCall.get(tsNode);
		if (fx == null) {
			fx = _resolveHandler(tsNode, compilerOptions);
			if (fx == null)
				throw `Could not compile handler for "${scalarName}.${key}" at: ${getNodePath(tsNode)}`;
			cacheCall.set(tsNode, fx);
		}
		targetMap.set(scalarName, fx);
	}
}



/** Scalar parsers */
type ScalarParsers = Pick<Scalar<any>, 'assertJsDocParser' | 'defaultJsDocParser'>; 