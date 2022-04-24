import { JsDocUtils } from "tt-model";
import ts from "typescript";

export class JsDocUtilsImp implements JsDocUtils {
	uniqueName(name: string) { return ts.factory.createUniqueName(name); }
	code(str: TemplateStringsArray, ...args: any[]) {
		const result: ts.Node[] = [];
		const factory = ts.factory;
		for (let i = 0, len = str.length; i < len; ++i) {
			_createTsNode(result, factory, str[i]);
			_createTsNode(result, factory, args[i]);
		}
		return result;
	};
}

/** Create ts node */
function _createTsNode(result: ts.Node[], factory: ts.NodeFactory, arg: any): void {
	if (arg == null) return
	else if (typeof arg === 'string') result.push(factory.createIdentifier(arg));
	else if (typeof arg === 'number') result.push(factory.createNumericLiteral(arg));
	else if (typeof arg === 'boolean') result.push(arg ? factory.createTrue() : factory.createFalse());
	else if (Array.isArray(arg)) {
		for (let i = 0, len = arg.length; i < len; ++i)
			_createTsNode(result, factory, arg[i]);
	}
	else if (typeof arg.kind === 'number') { // pretend ts.Node
		result.push(arg);
	}
}