import { PACKAGE_NAME } from "@src/config";
import { info } from "@utils/log";
import { getNodePath } from "@utils/node-path";
import ts from "typescript";
import { compileFiles } from "./compile-files";
import { ScanFile, TargetExtension } from "./interface";
import { _createProgram } from "./program";
import { ResolvedPattern, resolvePatterns } from "./resolve-patterns";
import { parseTsConfig } from "./tsconfig-parser";
import { resolveFilePattern } from "@utils/file-pattern";
import { parseSchema } from "@parser/parse";
import { printTree } from "@utils/console-print";

/** Compiler */
export class Compiler {
	/** Typescript Compiler Options */
	#compilerOptions: ts.CompilerOptions

	/** Scans */
	#scans: ScanFile[] = [];

	/** Dependent files (case of utilities like "partial") */
	#relatedFiles: Map<string, string[]> = new Map();

	/** Current program */
	#program?: ts.Program;

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
		const program = this.#program = _createProgram(files, this.#compilerOptions, encoding, this.#program);

		//* Load target files from patterns
		info(`>> Load Patterns and files`);
		const mapPatterns = this.resolvePatterns(program, filePaths.values());

		//* Parse patterns
		for (let i = 0, len = mapPatterns.length; i < len; ++i) {
			const parseOptions = mapPatterns[i];
			info(`Parsing >> ${parseOptions.methodText}`);
			const parsed = this._parse(program, parseOptions.files, parseOptions.contextEntities);
			console.log(printTree(parsed, '\t'));
		}

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

	/** Resolve patterns by scan */
	resolvePatterns(program: ts.Program, files: IterableIterator<string>): ResolvedPattern[] {
		return resolvePatterns(program, files, this._resolvePatternsOptions());
	}

	/** Resolve pattern options: Enables override by inheritance */
	_resolvePatternsOptions() {
		return {
			'tt-model': {
				className: 'Model',
				methods: new Set(['scan', 'scanGraphQL']),
				resolve: (node: ts.CallExpression, methodName: string, srcFile: ts.SourceFile): ResolvedPattern => {
					const typeChecker = this.#program!.getTypeChecker();
					if (node.arguments.length !== 1)
						throw new Error(`Expected exactly one argument for Model.${methodName} at: ${getNodePath(node)}`);
					const arg = node.arguments[0];
					if (!ts.isStringLiteral(arg))
						throw new Error(`Expected Static string as argument for Model.${methodName} at: ${getNodePath(node)}`);
					if (methodName != "scan" && methodName != "scanGraphQL")
						throw new Error(`Unexpected method Model.${methodName} at: ${getNodePath(node)}`);
					const typeArguments = node.typeArguments;
					if (typeArguments == null)
						throw new Error(`Expect type references for Mode.${methodName} at: ${getNodePath(node)}`);
					const pattern = arg.getText().slice(1, -1);
					//* Resolve Context Entities
					const contextEntities: string[] = [];
					const additionalEntitiesArg = node.typeArguments?.[2];
					if (additionalEntitiesArg == null) { }
					else if (ts.isTupleTypeNode(additionalEntitiesArg)) {
						additionalEntitiesArg.elements?.forEach(typeNode => {
							if (ts.isNamedTupleMember(typeNode)) typeNode = typeNode.type;
							const type = typeChecker.getTypeFromTypeNode(typeNode);
							const typeName = (type.aliasSymbol ?? type.symbol).name;
							contextEntities.push(typeName);
						});
					} else {
						const type = typeChecker.getTypeFromTypeNode(additionalEntitiesArg);
						const typeName = (type.aliasSymbol ?? type.symbol).name;
						contextEntities.push(typeName);
					}
					//* Return
					return {
						filePath: srcFile.fileName,
						lib: 'tt-model',
						methodName,
						methodText: node.getText(),
						node,
						pattern,
						files: resolveFilePattern(srcFile.fileName, pattern),
						schemaEntityName: typeArguments[0].getText(),
						contextEntityName: typeArguments[1]?.getText(),
						// TODO resolve annotation class
						contextEntities
					};
				}
			}
		}
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

	/**
	 * Parse files
	 * @param { ts.Program } program
	 * @param { string[] } files				- Path to files to parse
	 * @param { string[] } contextEntities		- Additional entities added by user
	 */
	_parse(program: ts.Program, files: string[], contextEntities: string[]) {
		return parseSchema(this, program, files, contextEntities);
	}

	/**
	 * Check package name
	 * Utils for child packages
	 */
	_isFromPackage(filePath: string | ts.Node | undefined) {
		if (filePath == null) return false;
		else if (typeof filePath !== 'string')
			filePath = filePath.getSourceFile().fileName;
		return filePath.includes('/node_modules/tt-model/');
	}
}
