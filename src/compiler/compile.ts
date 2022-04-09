import { PACKAGE_NAME } from "@src/config";
import { info } from "@utils/log";
import ts from "typescript";
import { compileFiles } from "./compile-files";
import { ScanFile, TargetExtension } from "./interface";
import { _createProgram } from "./program";
import { resolvePatterns } from "./resolve-patterns";
import { parseTsConfig } from "./tsconfig-parser";

/** Compiler */
export class Compiler {
	/** Typescript Compiler Options */
	#compilerOptions: ts.CompilerOptions

	/** Scans */
	#scans: ScanFile[] = [];

	/** Dependent files (case of utilities like "partial") */
	#relatedFiles: Map<string, string[]> = new Map();

	/**
	 * Init compiler
	 * @param {ts.CompilerOptions | string}	compilerOptions	- Parsed typescript config or path to that file
	 */
	constructor(
		compilerOptions: ts.CompilerOptions | string,
	) {
		//* Parse ts config
		if (typeof compilerOptions === 'string') compilerOptions = parseTsConfig(compilerOptions);
		this.#compilerOptions = compilerOptions;
	}

	/**
	 * Compile files
	 * @param { string[]| Map<string, string> }	files	- List of target file paths or Map of files and their content
	 * @param { boolean }	pretty		- Render pretty code
	 * @param { boolean }	transpileToJS	- If convert code to JavaScript
	 * @return { string }	[filePath, fileContent, ...]
	 */
	compile(
		files: string[] | Map<string, string | undefined>,
		pretty: boolean = true,
		transpileToJS: boolean,
		encoding: BufferEncoding = 'utf8'
	): string[] {
		//* Load file data & paths
		info('>> Load Content');
		files = this.adjustFiles(files);
		const filePaths: Set<string> = new Set(files.keys());

		//* Program
		info('>> Create Program');
		const program = _createProgram(files, this.#compilerOptions, encoding);

		//* Load target files from patterns
		info(`Load Patterns and files >>`);
		const mapPatterns = this.resolvePatterns(program, filePaths.values());

		throw 'END';

		// //* Compile files
		// info('>> Compiling');
		// const compiled = compileFiles(program, files);

		// //* Print files
		// info('>> Print files');
		// let result = this.print(compiled);

		// //* Transpile
		// if (transpileToJS) {
		// 	info(`>> Transpile to JavaScript`);
		// 	result = this.transpile(result);
		// }
		// return result;
	}

	/** Resolve patterns */
	resolvePatterns(program: ts.Program, files: IterableIterator<string>) {
		return resolvePatterns(program, files, {
			'tt-model': {
				className: 'Model',
				methods: new Set(['scan', 'scanGraphQL'])
			}
		});
	}

	/** Adjust files and add dependents */
	adjustFiles(files: string[] | Map<string, string | undefined>): Map<string, string | undefined> {
		// const filesPath: Set<string> = new Set(Array.isArray(files) ? files : files.keys());
		if (Array.isArray(files)) {
			const mp: Map<string, string | undefined> = new Map();
			for (let i = 0, len = files.length; i < len; ++i) mp.set(files[i], undefined);
			files = mp;
		}
		//* Add dependent files
		// TODO load from glob and dependents
		return files;
	}

	/** print files */
	print(files: Map<string, ts.SourceFile>): string[] {
		const tsPrinter = ts.createPrinter();
		// //* Resolve imports
		// if (targetExtension != null)
		// 	files = _resolveImports(tsPrinter, compilerOptions, files, targetExtension);
		//* Print files
		const result: string[] = [];
		files.forEach(function (srcFile, path) {
			result.push(path, tsPrinter.printFile(srcFile));
		});
		return result;
	}

	/**
	 * Transpile results
	 * @param { string } data	- [filePath, fileContent, ...]
	 */
	transpile(data: string[]): string[] {
		const compilerOptions = this.#compilerOptions;
		for (let i = 0, len = data.length; i < len;) {
			const pathIndex = i++;
			const contentIndex = i++;
			const path = data[pathIndex];
			const content = data[contentIndex];
			data[contentIndex] = ts.transpile(content, compilerOptions, path);
		}
		return data;
	}

}
