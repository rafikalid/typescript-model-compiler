import ts from "typescript";

/**
 * Compile files
 */
export function compileFiles(
	program: ts.Program,
	filesContent: Map<string, string | undefined>
): Map<string, ts.SourceFile> {
	const rootFiles: Map<string, ts.SourceFile> = new Map();

	return rootFiles;
}