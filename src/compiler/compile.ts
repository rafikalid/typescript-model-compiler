import { info } from "@utils/log";
import { getNodePath } from "@utils/node-path";
import ts from "typescript";
import { ScanFile } from "./interface";
import { _createProgram } from "./program";
import { MethodDesc, ResolvedPattern, resolvePatterns } from "./resolve-patterns";
import { parseTsConfig } from "./tsconfig-parser";
import { resolveFilePattern } from "@utils/file-pattern";
import { parseSchema } from "@parser/parse";
import { printTree } from "@utils/console-print";
import { format } from "@src/format/format";
import { resolve as resolvePath } from 'path';
import { JsDocAnnotationMethod } from "tt-model";
import { _getCallExpression } from "@src/format/utils";
import { ScalarParsers, _resolveScalars } from "@src/format/resolve-scalars";


/** Compiler */
export class Compiler {
	/** Default libs */
	_libs = [
		resolvePath('node_modules/tt-model/src/interfaces/scalars-default.ts')
	];
	/** Typescript Compiler Options */
	readonly _compilerOptions: ts.CompilerOptions

	/** Scans */
	#scans: ScanFile[] = [];

	/** Dependent files (case of utilities like "partial") */
	#relatedFiles: Map<string, string[]> = new Map();

	/** Current program */
	#program!: ts.Program;

	/** Call expression parser cache */
	_cacheCallExpression: CallCacheExprMap = new Map();

	/** Store file contents */
	#files: Map<string, string | undefined> = new Map();

	/**
	 * Init compiler
	 * @param {ts.CompilerOptions | string}	compilerOptions	- Parsed typescript config or path to that file
	 */
	constructor(
		compilerOptions: ts.CompilerOptions | string,
	) {
		//* Parse ts config
		if (typeof compilerOptions === 'string') compilerOptions = parseTsConfig(compilerOptions);
		this._compilerOptions = compilerOptions;
		//* Add tt-model default scalars
		const mapFiles = this.#files;
		this._libs.forEach(file => {
			mapFiles.set(file, undefined);
		});
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
		const updatedFiles = Array.isArray(files) ? files : Array.from(files.keys());
		this._loadFiles(files);
		files = this.#files;
		// const filePaths: Set<string> = new Set(files.keys());

		//* Program
		info('>> Create Program');
		const program = this.#program = _createProgram(files, this._compilerOptions, encoding, this.#program);

		//* Load target files from patterns
		info(`>> Load Patterns and files`);
		const mapPatterns = this.resolvePatterns(program, updatedFiles);

		//* Parse patterns
		for (let i = 0, len = mapPatterns.length; i < len; ++i) {
			const parseOptions = mapPatterns[i];
			//* Parse
			info(`>> Parsing ${parseOptions.methodText}`);
			const parsed = this._parse(parseOptions.files, parseOptions.contextEntities, parseOptions.jsDocAnnotations);
			info('>> Resolve scalars');
			//* Resolver scalar parsers
			const scalars = _resolveScalars(this, this._compilerOptions, parsed, this.#program.getTypeChecker());
			//* Format
			info('>> Format');
			const formatted = this._format(parsed, parseOptions, scalars);
			console.log(printTree(formatted, '\t'));
		}

		throw 'END';

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
	resolvePatterns(program: ts.Program, files: string[]): ResolvedPattern[] {
		return resolvePatterns(program, files, this);
	}

	/** Resolve pattern options: Enables override by inheritance */
	_resolvePatternsOptions(): Record<string, MethodDesc> {
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
					const contextEntities: Set<string> = new Set();
					const additionalEntitiesArg = node.typeArguments?.[2];
					if (additionalEntitiesArg == null) { }
					else if (ts.isTupleTypeNode(additionalEntitiesArg)) {
						additionalEntitiesArg.elements?.forEach(typeNode => {
							if (ts.isNamedTupleMember(typeNode)) typeNode = typeNode.type;
							const type = typeChecker.getTypeFromTypeNode(typeNode);
							const typeName = (type.aliasSymbol ?? type.symbol).name;
							contextEntities.add(typeName);
						});
					} else {
						const type = typeChecker.getTypeFromTypeNode(additionalEntitiesArg);
						const typeName = (type.aliasSymbol ?? type.symbol).name;
						contextEntities.add(typeName);
					}
					//* Resolve jsDoc Annotation resolvers
					let jsDocAnnotations: Map<string, JsDocAnnotationMethod> = new Map();
					const jsDocArg = typeArguments[1];
					if (jsDocArg != null && jsDocArg.kind !== ts.SyntaxKind.VoidKeyword) {
						if (jsDocArg.kind !== ts.SyntaxKind.TypeReference)
							throw `Unexpected value for argument "jsDocAnnotation" at: ${getNodePath(jsDocArg)}`;
						const jsType = typeChecker.getTypeAtLocation(jsDocArg);
						const decSym = jsType.aliasSymbol ?? jsType.symbol;
						if (decSym == null)
							throw `Could not find "${jsDocArg.getText()}" at: ${getNodePath(jsDocArg)}`;
						// if (ts)
						// 	throw `Expected class for argument "jsDocAnnotation". Got "${ts.SyntaxKind[dec.kind]}" at: ${getNodePath(jsDocArg)}`;
						const errors: string[] = [];
						decSym.members?.forEach(s => {
							const prop = s.declarations?.[0];
							if (prop == null) return;
							try {
								const propCall = _getCallExpression(prop, typeChecker, this._cacheCallExpression, this._compilerOptions);
								jsDocAnnotations.set(s.name, propCall);
							} catch (error: any) {
								if (typeof error !== 'string') error = error?.message ?? error;
								error = `Fail to parse handler for annotation "${s.name}" at ${getNodePath(prop)}. Caused by: ${error?.message ?? error}`
								errors.push(error);
							}
						});
						if (errors.length > 0)
							throw new Error(`JsDoc Annotation Errors: \n\t${errors.join('\n\t')}`);
					}
					//* Resolve files
					const files = resolveFilePattern(srcFile.fileName, pattern);
					files.push(...this._libs);
					//* Return
					return {
						filePath: srcFile.fileName,
						lib: 'tt-model',
						methodName,
						methodText: node.getText(),
						node,
						pattern,
						files,
						schemaEntityName: typeArguments[0].getText(),
						contextEntities,
						jsDocAnnotations: jsDocAnnotations
					};
				}
			}
		}
	}

	/** Adjust files and add dependents */
	_loadFiles(files: string[] | Map<string, string | undefined>): void {
		// const filesPath: Set<string> = new Set(Array.isArray(files) ? files : files.keys());
		const target = this.#files;
		if (Array.isArray(files)) {
			for (let i = 0, len = files.length; i < len; ++i)
				target.set(files[i], undefined);
		} else {
			files.forEach(function (v, k) {
				target.set(k, v);
			});
		}
		//* Add dependent files
		// TODO load from glob and dependents
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
		const compilerOptions = this._compilerOptions;
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
	 * @param { string[] } files				- Path to files to parse
	 * @param { string[] } contextEntities		- Additional entities added by user
	 */
	_parse(files: string[], contextEntities: Set<string>, jsDocAnnotations: Map<string, JsDocAnnotationMethod>) {
		return parseSchema(this, this.#program, files, contextEntities, jsDocAnnotations);
	}

	/**
	 * Format parsed entities
	 */
	_format(data: ReturnType<typeof parseSchema>, parseOptions: ResolvedPattern, scalars: ScalarParsers) {
		return format(this, this._compilerOptions, data, parseOptions, scalars);
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

	/** Parse jsDocTag arguments */
	_parseJsDocTagArgs(args: string | undefined): string[] {
		const result: string[] = [];
		if (args == null) return result;
		/**
		 * States
		 * 		0: ignore white space
		 * 		1: buffer data
		 * 		2: inside quote
		 */
		let state: 0 | 1 | 2 = 0;
		const bufferResult: string[] = [];
		let quote: '"' | "'" = '"';
		for (let i = 0, len = args.length; i < len; ++i) {
			const c = args.charAt(i);
			switch (state) {
				case 0: // Ignore whitespace
					switch (c) {
						case ' ':
							break;
						case '"':
						case "'":
							state = 2; // inside quote
							quote = c;
							break;
						default:
							state = 1; // buffer data
							bufferResult.push(c);
							break;
					}
					break;
				case 1: // Buffer result
					switch (c) {
						case '"':
						case "'":
							state = 2;
							quote = c;
							result.push(bufferResult.join(''));
							bufferResult.length = 0;
							break;
						case ' ':
						case ',':
						case ';':
							state = 0;
							result.push(bufferResult.join(''));
							bufferResult.length = 0;
							break;
						default:
							bufferResult.push(c);
					}
					break;
				case 2: // Quoted
					if (c === '\\') { // ignore next char
						++i;
						bufferResult.push(args.charAt(i));
					} else if (c === quote) {
						state = 0;
						result.push(bufferResult.join(''));
						bufferResult.length = 0;
					} else {
						bufferResult.push(c);
					}
					break;
				default: {
					const n: never = state;
				}
			}
		}
		if (bufferResult.length)
			result.push(bufferResult.join(''));
		return result;
	}
}


export type CallCacheExprMap = Map<ts.CallExpression | ts.MethodDeclaration | ts.FunctionDeclaration, (...args: any[]) => any>;