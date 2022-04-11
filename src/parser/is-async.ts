import { getNodePath } from "@utils/node-path";
import ts from "typescript";

/**
 * Check if a method or function or type is async
 */
export function isAsync(typeChecker: ts.TypeChecker, node: ts.SignatureDeclaration | ts.ObjectLiteralElementLike | ts.FunctionExpression): boolean {
	// Get method
	if (ts.isObjectLiteralElementLike(node)) {
		if (ts.isPropertyAssignment(node)) {
			if (node.initializer != null && ts.isFunctionLike(node.initializer)) {
				node = node.initializer;
			} else {
				throw `"${node.name.getText()} Expected method! at ${getNodePath(node)}`;
			}
		} else if (!ts.isMethodDeclaration(node)) {
			throw `Unexpected type "${ts.SyntaxKind[node.kind]}" for property "${node.name?.getText()} at ${getNodePath(node)}`
		}
	}
	// Get return type of signature
	var sign = typeChecker.getSignatureFromDeclaration(node);
	if (sign == null) throw `Fail to get method signature at ${getNodePath(node)}`
	var returnType = typeChecker.getNonNullableType(typeChecker.getReturnTypeOfSignature(sign));
	let hasPromise = false;
	if (returnType.isUnionOrIntersection()) {
		for (let i = 0, types = returnType.types, len = types.length; i < len; ++i) {
			let type = types[i];
			if (type.symbol?.name === 'Promise') {
				hasPromise = true;
				break;
			}
		}
	} else hasPromise = returnType.symbol?.name === 'Promise';
	return hasPromise;
}