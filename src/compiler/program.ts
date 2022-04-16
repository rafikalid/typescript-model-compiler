import ts from "typescript";
import { normalize, resolve, dirname, relative } from 'path';
import { readFileSync } from 'fs';

/**
 * Create program
 * @internal
 */
export function _createProgram(
	filesContent: Map<string, string | undefined>,
	compilerOptions: ts.CompilerOptions,
	encoding: BufferEncoding,
	oldProgram: ts.Program | undefined
) {
	//* Host
	const pHost = ts.createCompilerHost(compilerOptions, true);
	pHost.readFile = function (fileName: string): string {
		var filePath = normalize(fileName);
		var content = filesContent.get(filePath);
		if (content == null) {
			content = readFileSync(fileName, encoding);
			filesContent.set(filePath, content);
		}
		return content;
	};
	/** Write results */
	pHost.writeFile = function (
		fileName: string,
		data: string,
		writeByteOrderMark: boolean,
		onError?: (message: string) => void,
		sourceFiles?: readonly ts.SourceFile[]
	) {
		// Write only to existing files
		if (filesContent.has(fileName)) filesContent.set(fileName, data);
	};

	//* Program
	return ts.createProgram(Array.from(filesContent.keys()), compilerOptions, pHost, oldProgram);
}