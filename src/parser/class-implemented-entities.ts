import { getNodePath } from "@utils/node-path";
import ts from "typescript";
import { GetNodeNameSignature } from "./parse";

/**
 * Check if a class is a helper class
 */
export function getImplementedEntities(typeChecker: ts.TypeChecker, tsEntity: ts.ClassDeclaration | ts.InterfaceDeclaration, getNodeName: GetNodeNameSignature): { type: HelperClass, entities: string[] } {
	const entities: string[] = [];
	const result = {
		type: HelperClass.ENTITY,
		entities
	}
	const clauses = tsEntity.heritageClauses;
	if (clauses == null) return result;
	for (let i = 0, len = clauses.length; i < len; ++i) {
		for (let j = 0, types = clauses[i].types, jLen = types.length; j < jLen; ++j) {
			let type = types[j];
			let typeSymbol = typeChecker.getSymbolAtLocation(type.expression);
			const refName = typeSymbol?.name;
			if (refName == null)
				throw `Could not resolve type "${type.expression.getText()}" at: ${getNodePath(type)}`;
			switch (refName) {
				case 'ValidatorsOf':
				case 'ResolversOf': {
					const isInterface = tsEntity.kind === ts.SyntaxKind.InterfaceDeclaration;
					if (isInterface)
						throw `An interface could not extends "${refName}" at: ${getNodePath(type)}`;
					const targetType = type.typeArguments?.[0];
					if (targetType == null)
						throw `Missing type for "${refName}" at: ${getNodePath(type)}`;
					// let isResolversOf = refName === 'ResolversOf';
					// const typeName: ts.Node = (type.typeArguments![0] as ts.TypeReferenceNode).typeName;
					// const targetSym = typeChecker.getTypeAtLocation(typeName).symbol;
					// const targetType = ((targetSym?.valueDeclaration ?? targetSym.declarations?.[0]) as ts.InterfaceDeclaration)?.name;
					// if (!ts.isTypeReferenceNode(t) || !typeChecker.getTypeFromTypeNode(t).isClassOrInterface())
					// 	throw `Expected "${resolverConfig}" argument to reference a "class" or "interface" at ${errorFile(srcFile, t)}`;
					// let typeName = typeChecker.getSymbolAtLocation(t.typeName)!.name;
					// (implementedEntities ??= []).push(targetType == null ? _getNodeName(typeName, srcFile) : _getNodeName(targetType, targetType.getSourceFile()));
					// isInput = !isResolversOf;
					entities.push(getNodeName(targetType));
					result.type = refName === 'ResolversOf' ? HelperClass.RESOLVERS : HelperClass.VALIDATORS;
					break;
				}
				default: {
					entities.push(getNodeName(type));
				}
			}
		}
	}
	return result;
}
/** Helper class return value */
export enum HelperClass {
	RESOLVERS,
	VALIDATORS,
	ENTITY
}