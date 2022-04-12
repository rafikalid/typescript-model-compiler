import ts from "typescript";
const IS_OF_TYPE_NULL = ts.TypeFlags.Undefined | ts.TypeFlags.Null;

/**
 * Check if a field or param or type are required
 */
export function doesTypeHaveNull(typeChecker: ts.TypeChecker, nodeType: ts.Type): boolean {
	let typeName: string|undefined;
	//* Union
	if(nodeType.isUnion())
		return nodeType.types.some(t=> doesTypeHaveNull(typeChecker, t));
	//* Basic check
	else if(
		(nodeType.flags & IS_OF_TYPE_NULL) &&
		(typeName= typeChecker.typeToString(nodeType)) &&
		(typeName==='undefined' || typeName==='null')
	)
		return true;
	else if(nodeType.symbol?.name === 'Promise'){
		const tp = (nodeType as ts.TypeReference).typeArguments?.[0];
		if(tp!=null)
			return doesTypeHaveNull(typeChecker, tp);
	}
	return false;
}


/**
 * Remove promises and null values
 */
export function cleanType(typeChecker: ts.TypeChecker, type: ts.Type) {
	let hasPromise= false;
	const result: ts.Type[] = [];
	const queue: ts.Type[] = [typeChecker.getNonNullableType(type)];
	let typeName:string | null
	while (queue.length > 0) {
		const tp = queue.pop()!;
		if(tp.isIntersection() || tp.isClassOrInterface()){
			result.push(tp); // only resolve real type format
		}else if(tp.isUnion()){
			// Fix union issue
			typeName= typeChecker.typeToString(tp);
			if(typeName.includes('|')) queue.push(...tp.types);
			else result.push(tp);
		} else if (tp.symbol?.name === 'Promise') {
			hasPromise= true;
			const tp2 = (tp as ts.TypeReference).typeArguments?.[0];
			if (tp2 != null) queue.push(typeChecker.getNonNullableType(tp2));
		} else {
			result.push(tp);
		}
	}

	return {
		types: result,
		hasPromise
	}
}
// export function rmPromises(type: ts.TypeNode): ts.TypeNode {
// 	switch(type.kind){typechecker
// 		case ts.SyntaxKind.UnionType:{
// 			const unionType= 
// 			type= ts.factory.createUnionTypeNode()
// 			break;
// 		}
// 		case ts.SyntaxKind.IntersectionType: {
// 			break;
// 		}
// 		case ts.SyntaxKind.ArrayType: {
// 			break;
// 		}
// 		case ts.SyntaxKind.TypeReference: {
// 			break;
// 		}
// 	}
// 	if(type.isUnion()){
// 		const tp= type;
// 		type.types.forEach(rmPromises)
		
// 	} else if(type.isIntersection()){} else if(type.symbol?.name === 'Promise'){}
// 	return type;
// }