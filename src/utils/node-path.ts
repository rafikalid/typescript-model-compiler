import ts from "typescript";

/**
 * Get node path (file:line)
 */
export function getNodePath(node: ts.Node | ts.Node[]): string {
	try {
		if (Array.isArray(node)) {
			return node.map(getNodePath).join(', ');
		} else {
			const srcFile = node.getSourceFile();
			const { line, character } = srcFile.getLineAndCharacterOfPosition(node.getStart());
			return `${srcFile.fileName}:${line}:${character}`;
		}
	} catch (err: any) {
		console.error('NODE-PATH-ERROR>>', err);
		return `<ERR:${err.message}>`;
	}
}