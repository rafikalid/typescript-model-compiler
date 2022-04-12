import ts from "typescript";
const IS_OF_TYPE_NULL = ts.TypeFlags.Undefined | ts.TypeFlags.Null;

/**
 * Check if a field or param or type are required
 */
export function doesTypeHaveNull(typeChecker: ts.TypeChecker, nodeType: ts.Type): boolean {
	//* Basic check
	if (nodeType.flags & IS_OF_TYPE_NULL) return true;
	//* Union
	let t = typeChecker.getNullableType(nodeType, nodeType.flags);
	if (t.flags & IS_OF_TYPE_NULL) return true;
	//* Promise
	// t = rmPromises(typeChecker, nodeType);
	// if (t.flags & IS_OF_TYPE_NULL) return true;
	//* has not null
	return false;
}


/**
 * Remove promises and null values
 */
export function cleanType(typechecker: ts.TypeChecker, type: ts.Type) {
	let hasPromise= false;
	let hasNullValue= false;
	const result: ts.Type[] = [];
	const queue: ts.Type[] = [type];
	while (queue.length > 0) {
		let tp: ts.Type | undefined = queue.pop()!;
		if(tp.isIntersection()) result.push(tp);
		else if(tp.isUnion()){
			console.log('===UNION=====')
			queue.push(...tp.types);
		} else if (tp.symbol?.name === 'Promise') {
			tp = (tp as ts.TypeReference).typeArguments?.[0];
			if (tp != null) queue.push(tp);
		} else {
			result.push(tp);
		}
	}

	return {
		types: result,
		text: result.map(t=> typechecker.typeToString(t)).join('|')
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