import { JsDocUtils } from "tt-model";
import ts from "typescript";

export const JsDocUtilsImp: JsDocUtils = {
	uniqueName(name: string) { return ts.factory.createUniqueName(name); },
	code(str: TemplateStringsArray, ...args: any[]): ts.Statement[] {
		const result: ts.Statement[] = [];
		const factory = ts.factory;
		for (let i = 0, len = str.length; i < len; ++i) {
			_createTsNode(result, factory, str[i]);
			_createTsNode(result, factory, args[i]);
		}
		return result;
	}
}

/** Create ts node */
function _createTsNode(result: ts.Statement[], factory: ts.NodeFactory, arg: string | boolean | number | ts.Node): void {
	if (arg == null) return
	else if (typeof arg === 'string') result.push(factory.createExpressionStatement(factory.createIdentifier(arg)));
	else if (typeof arg === 'number') result.push(factory.createExpressionStatement(factory.createNumericLiteral(arg)));
	else if (typeof arg === 'boolean') result.push(factory.createExpressionStatement(arg ? factory.createTrue() : factory.createFalse()));
	else if (Array.isArray(arg)) {
		for (let i = 0, len = arg.length; i < len; ++i)
			_createTsNode(result, factory, arg[i]);
	}
	else if (ts.isIdentifier(arg)) { // pretend ts.Node
		result.push(factory.createExpressionStatement(arg));
	} else if (ts.isExpressionStatement(arg)) {
		result.push(arg);
	} else {
		throw `Unexpected argument: ${ts.SyntaxKind[arg.kind]}`;
	}
}