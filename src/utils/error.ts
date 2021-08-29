import ts from "typescript";

/** Generate error */
export function _errorFile(srcFile: ts.SourceFile, node: ts.Node){
	let {line, character}= srcFile.getLineAndCharacterOfPosition(node.getStart());
	return `${srcFile.fileName}:${line}:${character}`;
}