import { getNodePath } from '@utils/node-path';
import ts from 'typescript';
import { runInNewContext } from 'vm';
import { CallCacheExprMap } from '..';

/**
 * Parse function from text to JS
 */
export function _resolveHandler(decoExpr: ts.CallExpression | ts.MethodDeclaration | ts.FunctionDeclaration, compilerOptions: ts.CompilerOptions) {
	// Prepare module text
	// let code = ts.transpile(`module.fx=${decoExpr.arguments[0].getText()}`, compilerOptions, undefined);
	let codeStr = decoExpr.getText();
	if (ts.isMethodDeclaration(decoExpr))
		codeStr = `module.fx=function ${codeStr};`;
	else
		codeStr = `module.fx=${codeStr};`;
	const code = ts.transpile(codeStr, compilerOptions, undefined);
	//* Prepare context
	const ctx: { module: { fx?: (...args: any[]) => any }, console: any } = { module: {}, console };
	//* Exec
	runInNewContext(code, ctx, { timeout: 1000 });
	return ctx.module.fx;
}

/**
 * Split access path
 * @example "path.to\.ele.node" into ['path', 'to.ele', 'node']
 * @example "path.[].ele\[\].node" into ['path', 0, 'ele[]', 'node']
 */
export function _splitAccessPath(path: string) {
	const buffer: string[] = [];
	const result: (string | number)[] = [];
	for (let i = 0, len = path.length; i < len; ++i) {
		const c = path.charAt(i);
		switch (c) {
			case '\\': // Ignore next element
				++i;
				buffer.push(path.charAt(i));
				break;
			case '.':
				if (buffer.length > 0) {
					result.push(buffer.join(''));
					buffer.length = 0;
				}
				break;
			case '[': {
				let cc: string;
				if (
					buffer.length === 0 && (
						(cc = path.slice(i - 1, i + 2)) === '.[].' ||
						cc === '.[]'
					)
				) {
					i = i + 2;
					result.push(0);
				} else {
					buffer.push(c);
				}
				break;
			}
			default:
				buffer.push(c);
		}
	}
	if (buffer.length > 0) {
		result.push(buffer.join(''));
		buffer.length = 0;
	}
	return result;
}

/** Get and parse call expression from node */
export function _getCallExpression(
	fxNode: ts.Node,
	typeChecker: ts.TypeChecker,
	cacheCall: CallCacheExprMap,
	compilerOptions: ts.CompilerOptions
): (...args: any[]) => any {
	if (
		ts.isMethodDeclaration(fxNode) ||
		ts.isFunctionDeclaration(fxNode) ||
		ts.isCallExpression(fxNode)
	) {
		let fx = cacheCall.get(fxNode);
		if (fx == null) {
			fx = _resolveHandler(fxNode, compilerOptions);
			if (fx == null)
				throw `Could not compile handler at: ${getNodePath(fxNode)}`;
			cacheCall.set(fxNode, fx);
		}
		return fx;
	} else {
		throw `Expected call expression. Got "${ts.SyntaxKind[fxNode.kind]}" at: ${getNodePath(fxNode)}`;
	}
}