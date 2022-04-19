import ts from 'typescript';
import { runInNewContext } from 'vm';

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