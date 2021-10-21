

let prop = s.valueDeclaration as ts.PropertyDeclaration;
if (prop == null) continue;
let propType = typeChecker.getTypeAtLocation(prop);
let propTypeNode = typeChecker.typeToTypeNode(propType, node, undefined)
if (propTypeNode == null) continue;
let propertyEntity = _getNodeName(prop.type!, srcFile);
//TODO fix for union types
console.log('>', s.name, ':: ',);
// Get property type----
let tp = typeChecker.getTypeFromTypeNode(prop.type!);
if (tp.symbol) {
	console.log('--x--', tp.symbol.name)
}
tp.getProperties().forEach(p => {
	let c = typeChecker.getTypeOfSymbolAtLocation(p, prop);
	console.log('==xx==>', p.name, ':', pt == null ? 'NULL' : ts.SyntaxKind[pt.kind] + '::' + _getNodeName(pt, srcFile))
});
// console.log('target>>', targetc == null ? 'NULL' : _getNodeName(targetc, srcFile))
// visitor.push(propTypeNode, propType, entity, srcFile, true);

PropertySignature
-----------


	console.log('------x----->', s.name, '::', ts.SyntaxKind[s.valueDeclaration.kind])
let propTypeNode = typeChecker.typeToTypeNode(
	propType, s.valueDeclaration,
	ts.NodeBuilderFlags.AllowUniqueESSymbolType
);
if (propTypeNode == null) continue;
let propName = _getNodeName(propTypeNode, srcFile);
console.log('----------->', propName, '::', ts.SyntaxKind[propTypeNode.kind])