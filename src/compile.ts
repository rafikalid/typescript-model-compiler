import ts from "typescript";
import { readFileSync } from 'fs';
import { PACKAGE_NAME } from "./config";
import { errorFile } from "./utils/error";
import { info, warn } from "./utils/log";
import { normalize, resolve, dirname, relative } from 'path';
import Glob from 'glob';
import { parse as ParseModelFrom } from './parser/parser';
import { format, format as formatModel } from './parser/format';
import { printTree } from '@src/utils/console-print';
import Through from 'through2';
import Vinyl from 'vinyl';
import { toDataModel, ToDataReturn } from './converters/to-data-model';
import { toGraphQL } from "./converters/to-graphql";
import { _resolveImports } from "./utils/resolve-imports";
const TS_REGEX = /\.ts$/i

/** Compiler::compile */
export interface CompileResult {
	path: string,
	content: string
}

export type TargetExtension = '.js' | '.mjs' | '.cjs';

/** Compile and resolve Model */
export class Compiler {
	/** Typescript Compiler Options */
	#compilerOptions: ts.CompilerOptions
	/** Link each file to resolved files using patterns */
	#fileToResolvedFiles: Map<string, Set<string>> = new Map();
	/** Link resolved file to original files */
	#resolvedFileToFiles: Map<string, Set<string>> = new Map();
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
	 * @param { boolean }	transpile	- Transpile files to javascript
	 */
	compile(
		files: string[] | Map<string, string>,
		pretty: boolean = true,
		targetExtension?: TargetExtension
	): CompileResult[] {
		// Target extension
		if (targetExtension != null && targetExtension !== '.js' && targetExtension !== '.mjs' && targetExtension !== '.cjs')
			throw new Error(`Unsupported extension: ${targetExtension}`);
		// prepare
		let filePaths: Set<string>;
		let mapFiles: Map<string, string>;
		const compilerOptions = this.#compilerOptions;
		const factory = ts.factory;
		//* Load file data & paths
		info(`Load Content >>`);
		if (Array.isArray(files)) {
			filePaths = new Set(files);
			mapFiles = files = new Map();
			filePaths.forEach(function (file) {
				mapFiles.set(file, readFileSync(file, 'utf-8'));
			});
		} else {
			filePaths = new Set(files.keys());
			mapFiles = files;
		}
		//* Add linked files
		filePaths.forEach((file) => {
			this.#resolvedFileToFiles.get(file)?.forEach(f => {
				if (!filePaths.has(f)) {
					filePaths.add(f);
					mapFiles.set(file, readFileSync(file, 'utf-8'));
				}
			});
		});
		//* Parse files
		const srcFiles: ts.SourceFile[] = [];
		const rootFiles: Map<string, ts.SourceFile> = new Map();
		mapFiles.forEach(function (content, path) {
			let srcFile = ts.createSourceFile(path, content, compilerOptions.target ?? ts.ScriptTarget.Latest, true);
			srcFiles.push(srcFile);
			rootFiles.set(path, srcFile)
		});
		//* Load target files from patterns
		info(`Load Patterns and files >>`);
		const mapPatterns: Map<string, ResolvePatterns> = this._resolvePatterns(srcFiles);
		let patternItems = Array.from(mapPatterns.values());
		if (patternItems.length === 0) {
			warn('--- No pattern found on all files ---');
			let result = this.print(compilerOptions, rootFiles, targetExtension);
			info('</DONE>')
			return result;
		}
		//* Link files
		// info(`Link files >>`);
		// let resolvedFileToFiles = this.#resolvedFileToFiles;
		// let fileToResolvedFiles = this.#fileToResolvedFiles;
		// Load resolved file paths
		for (let i = 0, len = patternItems.length; i < len; ++i) {
			let item = patternItems[i];
			// Add resolved files to set
			item.resolvedFiles.forEach(file => {
				filePaths.add(file); // Add to paths
			});
		}
		//* Create program
		info(`Create Program >>`);
		const pHost = ts.createCompilerHost(compilerOptions, true);
		pHost.readFile = function (fileName: string): string {
			var k = normalize(fileName);
			var f = mapFiles.get(k);
			if (f == null) {
				f = readFileSync(fileName, 'utf-8');
				mapFiles.set(k, f);
			}
			return f;
		};
		/** Write results */
		pHost.writeFile = function (fileName: string, data: string, writeByteOrderMark: boolean, onError?: (message: string) => void, sourceFiles?: readonly ts.SourceFile[]) {
			// Write only to existing files
			if (mapFiles.has(fileName)) mapFiles.set(fileName, data);
		};
		const program = ts.createProgram(Array.from(filePaths), compilerOptions, pHost);
		//* Go through patterns and parse files
		info(`Parsing >>`);
		for (let i = 0, len = patternItems.length; i < len; ++i) {
			let { files, patterns, resolvedFiles } = patternItems[i];
			//* Parse resolved files
			let root = ParseModelFrom(resolvedFiles, program);
			// console.log('===ROOT===\n', printTree(root, '\t'));
			//* Format data
			let formatted = formatModel(root);
			console.log('===FORMATTED ROOT===\n', printTree(formatted, '\t'));
			//* Add to target files
			for (let j = 0, jLen = files.length; j < jLen; ++j) {
				let { srcFile, node: targetNode, type: methodName } = files[j];
				try {
					//* Compile data
					let { imports, node: resultNode } = this.convertData(factory, srcFile, methodName, formatted, pretty, targetExtension);
					//* Replace patterns
					srcFile = ts.transform(srcFile, [function (ctx: ts.TransformationContext) {
						function _visitor(node: ts.Node): ts.Node {
							if (node === targetNode) return resultNode;
							else return ts.visitEachChild(node, _visitor, ctx);
						}
						return _visitor;
					}], compilerOptions).transformed[0] as ts.SourceFile;
					//* Inject imports
					if (imports.length) {
						srcFile = factory.updateSourceFile(
							srcFile,
							[...imports, ...srcFile.statements],
							false,
							srcFile.referencedFiles,
							srcFile.typeReferenceDirectives,
							srcFile.hasNoDefaultLib,
							srcFile.libReferenceDirectives
						);
					}
					rootFiles.set(srcFile.fileName, srcFile);
				} catch (err: any) {
					if (typeof err === 'string') err = `Converter error: ${err} at ${errorFile(srcFile, targetNode)}`;
					else throw err;
				}
			}
		}

		let result = this.print(compilerOptions, rootFiles, targetExtension);
		info('</DONE>')
		return result;
	}

	/** Use by ::gulp adapter */
	#filesInfo: Map<string, { cwd: string, base: string }> = new Map();
	/**
	 * Gulp adapter
	 */
	gulp(
		pretty = true,
		targetExtension?: '.js' | '.mjs' | undefined
	) {
		const files: Map<string, string> = new Map();
		const self = this;
		const filesInfo = this.#filesInfo;
		return Through.obj(function (
			file: Vinyl,
			_: any,
			cb: Through.TransformCallback
		) {
			//* Collect files
			try {
				if (
					file.isDirectory() ||
					file.isStream() ||
					file.isSymbolic() ||
					file.extname.toLowerCase() !== '.ts'
				) {
					// Ignore file
					cb(null, file);
				}
				else {
					let content: string;
					let path = file.path;
					if (file.isBuffer()) content = file.contents!.toString('utf-8');
					else content = readFileSync(path, 'utf-8');
					files.set(path, content);
					filesInfo.set(path, { cwd: file.cwd, base: file.base });
					cb(null);
				}
			} catch (error) {
				cb(error ?? 'ERROR', file);
			}
		}, function (cb: Through.TransformCallback) {
			try {
				//* Compile files
				let result = self.compile(files, pretty, targetExtension);
				for (let i = 0, len = result.length; i < len; ++i) {
					let item = result[i];
					let path = item.path;
					let info = filesInfo.get(path);
					if (info == null)
						throw new Error(`Unexpected missing file info: ${path}`);
					this.push(new Vinyl({
						path: targetExtension ? path.replace(TS_REGEX, targetExtension) : path,
						base: info.base,
						cwd: info.cwd,
						contents: Buffer.from(item.content, 'utf-8')
					}));
				}
				cb();
			} catch (error) {
				cb(error ?? 'ERROR');
			}
		});
	}

	/** Resolve patterns, override this if you need to customize this logic */
	_resolvePatterns(srcFiles: ts.SourceFile[]) {
		return resolvePatterns(srcFiles, PACKAGE_NAME, 'Model', 'scan', 'scanGraphQL');
	}

	/** print files  */
	print(
		compilerOptions: ts.CompilerOptions,
		files: Map<string, ts.SourceFile>,
		targetExtension?: TargetExtension
	) {
		const tsPrinter = ts.createPrinter();
		//* Resolve imports
		if (targetExtension != null)
			files = _resolveImports(tsPrinter, compilerOptions, files, targetExtension);
		//* Print files
		info(`Print files >>`);
		const result: CompileResult[] = [];
		files.forEach(function (srcFile, path) {
			try {

				result.push({
					path,
					content: tsPrinter.printFile(srcFile)
				});
			} catch (error) {
				console.log('path>>', path);
				console.log('>>', error);
			}
		});
		//* Transpile to JS
		if (targetExtension !== null) {
			info('Compile to JS>>');
			for (let i = 0, len = result.length; i < len; ++i) {
				let item = result[i];
				item.content = ts.transpile(item.content, compilerOptions, item.path);
			}
		}
		return result;
	}

	/** Inject data into files */
	convertData(
		nodeFactory: ts.NodeFactory,
		srcFile: ts.SourceFile,
		methodName: string,
		data: ReturnType<typeof format>,
		pretty: boolean,
		targetExtension: TargetExtension | undefined
	): ToDataReturn {
		//* Convert data into ts nodes
		let result: ToDataReturn;
		switch (methodName) {
			case 'scan':
				result = toDataModel(nodeFactory, srcFile, data, pretty, targetExtension);
				break;
			case 'scanGraphQL':
				result = toGraphQL(nodeFactory, srcFile, data, pretty, targetExtension);
				break;
			default:
				throw `Unexpected method "${methodName}"`;
		}
		return result;
	}
}


/** Parse tsConfig */
export function parseTsConfig(tsConfigPath: string) {
	//* Parse tsConfig
	var tsP = ts.parseConfigFileTextToJson(
		tsConfigPath,
		readFileSync(tsConfigPath, 'utf-8')
	);
	if (tsP.error)
		throw new Error(
			'Config file parse fails:' + tsP.error.messageText.toString()
		);
	var tsP2 = ts.convertCompilerOptionsFromJson(
		tsP.config.compilerOptions,
		process.cwd(),
		tsConfigPath
	);
	if (tsP2.errors?.length)
		throw new Error(
			'Config file parse fails:' +
			tsP2.errors.map(e => e.messageText.toString())
		);
	return tsP2.options;
}

/** Resolve patterns response */
interface ResolvePatterns {
	/** Pattern key */
	id: string
	/** List of separated patterns */
	patterns: string[]
	/** Files containing patterns */
	files: {
		srcFile: ts.SourceFile
		node: ts.Node
		/** Method type */
		type: string
	}[]
	/** Paths of Resolved file by the pattern */
	resolvedFiles: string[]
}
/** Resolve patterns */
export function resolvePatterns(srcFiles: readonly ts.SourceFile[], packageName: string, className: string, ...methods: string[]): Map<string, ResolvePatterns> {
	const result: Map<string, ResolvePatterns> = new Map();
	const queue: ts.Node[] = [];
	const errors: string[] = [];
	for (let i = 0, len = srcFiles.length; i < len; ++i) {
		try {
			const srcFile = srcFiles[i];
			queue.length = 0;
			queue.push(srcFile);
			let ModelVarNames: Set<string> = new Set();
			const relativeDirname = relative(process.cwd(), dirname(srcFile.fileName));
			for (let j = 0; j < queue.length; ++j) {
				let node = queue[j];
				if (ts.isImportDeclaration(node)) {
					if (node.moduleSpecifier.getText().slice(1, -1) === packageName) {
						//* Load names used for "Model"
						node.importClause?.namedBindings?.forEachChild(function (n) {
							if (
								ts.isImportSpecifier(n) &&
								(n.propertyName ?? n.name).getText() === className
							) {
								ModelVarNames.add(n.name.getText());
							}
						});
					}
				} else if (ts.isCallExpression(node)) {
					let expr = node.expression;
					if (
						ts.isPropertyAccessExpression(expr) &&
						ts.isIdentifier(expr.expression) &&
						ModelVarNames.has(expr.expression.getText())
					) {
						let propName = expr.name.getText();
						if (methods.includes(propName)) {
							//* Load and unify patterns
							let patterns: string[] = extractStringArgs(node, srcFile);
							if (patterns.length === 0) break;
							let originalPattern = patterns.join(', ');
							patterns = originalPattern.split(',')
								.map(e => resolve(relativeDirname, e.trim())) // Get absolute paths
								.filter((a, i, arr) => arr.indexOf(a) === i); // Remove duplicates
							//* Add result
							let key = patterns
								.slice(0) // create copy
								.sort((a, b) => a.localeCompare(b)) // sort to get unify form
								.join(',');
							let v = result.get(key);
							if (v == null) {
								let filePaths = _resolveFilesFromPatterns(patterns);
								if (filePaths.length === 0)
									throw `No file found for pattern "${originalPattern}" at ${errorFile(srcFile, node)}`;
								result.set(key, {
									id: key,
									patterns,
									files: [{ srcFile, node, type: propName }],
									resolvedFiles: filePaths
								});
							} else {
								v.files.push({
									srcFile, node, type: propName
								});
							}
						}
					}
				} else {
					queue.push(...node.getChildren());
				}
			}
		} catch (err: any) {
			if (typeof err === 'string') errors.push(err);
			else throw err;
		}
	}
	if (errors.length > 0) throw new Error(`Got Errors:\n- ${errors.join("\n- ")}`);
	return result;
}

/** Resolve files from patterns */
function _resolveFilesFromPatterns(patterns: string[]): string[] {
	const files: string[] = [];
	for (let i = 0, len = patterns.length; i < len; ++i) {
		let f = Glob.sync(patterns[i]);
		for (let j = 0, jLen = f.length; j < jLen; ++j) {
			let file = f[j];
			if (!files.includes(file))
				files.push(file);
		}
	}
	return files;
}


/** Extract strings from call expression args */
export function extractStringArgs(node: ts.CallExpression, srcFile: ts.SourceFile) {
	let arr: string[] = [];
	for (let i = 0, args = node.arguments, len = args.length; i < len; ++i) {
		let arg = args[i];
		if (ts.isStringLiteral(arg)) arr.push(arg.getText().slice(1, -1));
		else throw `Expected only static texts as arguments to "${node.expression.getText()}" at ${errorFile(srcFile, node)}`;
	}
	return arr;
}
