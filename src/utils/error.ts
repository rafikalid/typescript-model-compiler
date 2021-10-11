import ts from "typescript";

/**
 * Error codes
 */
export enum E {
	/** Parsing errors */
	PARSING_ERRORS
};

/** Error */
export class TError extends Error {
	code: E
	constructor(code: E, message: string) {
		super(message);
		this.code = code;
	}
}


/** Generate error */
export function errorFile(srcFile: ts.SourceFile, node: ts.Node) {
	let { line, character } = srcFile.getLineAndCharacterOfPosition(
		node.getStart()
	);
	return `${srcFile.fileName}:${line}:${character}`;
}
