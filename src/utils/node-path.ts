import ts from "typescript";

/**
 * Get node path (file:line)
 */
export function getNodePath(node: ts.Node | ts.Node[]): string {
	if (node == null) return '<ERR: NULL>'
	else if (Array.isArray(node)) {
		return node.map(getNodePath).join(', ');
	} else {
		for (let t = 0; t < 4; t++) {
			try {
				const srcFile = node.getSourceFile();
				if (srcFile == null) return `<ERR: No source file> at ${new Error().stack}`;
				const { line, character } = srcFile.getLineAndCharacterOfPosition(node.getStart());
				return `${srcFile.fileName}:${line}:${character}`;
			} catch (err: any) {
				node = node.parent;
				if (node == null) return `<ERR: ${err?.message}>`;
			}
		}
		return '<ERR: FAIL to Get Node Path!>';
	}
}