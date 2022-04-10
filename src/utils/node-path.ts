import ts from "typescript";

/**
 * Get node path (file:line)
 */
export function getNodePath(node: ts.Node) {
	const srcFile = node.getSourceFile();
	const { line, character } = srcFile.getLineAndCharacterOfPosition(node.getStart());
	return `${srcFile.fileName}:${line}:${character}`;
}