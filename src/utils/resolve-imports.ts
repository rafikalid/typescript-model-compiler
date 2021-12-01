import ts from "typescript";
import { statSync } from 'fs';
import { resolve, dirname, relative, sep as PathSep } from 'path';
import { errorFile } from "./error";
const isWindows = PathSep === '\\';

/**
 * Resolve imports to be usable by js
 */
export function _resolveImports(
	tsPrinter: ts.Printer,
	compilerOptions: ts.CompilerOptions,
	files: Map<string, ts.SourceFile>,
	targetExtension: string
): Map<string, ts.SourceFile> {
	// Base dir
	const baseDir = resolve(typeof compilerOptions.baseUrl === 'string' ? compilerOptions.baseUrl : '.');
	// Load mapped paths from compiler options
	const mappedPaths: Map<string, string> = new Map();
	const paths = compilerOptions.paths ?? {};
	for (let k in paths) {
		var v = paths[k];
		if (v.length != 1)
			throw new Error(`Typescript options>> Expected one entry for each path, found ${v.length} at ${k}`);
		// remove trailing slash
		k = k.replace(/\/\*?$/, '');
		mappedPaths.set(k, resolve(baseDir, v[0].replace(/\/\*?$/, '')));
	}
	// Resolve imports
	files.forEach((srcFile, filePath) => {
		srcFile = ts.transform(srcFile, [function (ctx: ts.TransformationContext) {
			return _importTransform(tsPrinter, ctx, srcFile, filePath, targetExtension, mappedPaths)
		}]).transformed[0] as ts.SourceFile;
		files.set(filePath, srcFile);
	});
	return files;
}

function _importTransform(
	tsPrinter: ts.Printer,
	ctx: ts.TransformationContext,
	srcFile: ts.SourceFile,
	filePath: string,
	targetExtension: string,
	mappedPaths: Map<string, string>
) {
	const f = ctx.factory;
	const _dirname = dirname(filePath);
	const replacerRegex = /^(@[^\/\\'"`]+)/;
	return _visitor;
	function _visitor(node: ts.Node): ts.Node {
		if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) {
			//* Import declaration
			return f.updateImportDeclaration(
				node, node.decorators, node.modifiers, node.importClause,
				f.createStringLiteral(_resolvePath(node.moduleSpecifier)), undefined
			);
		} else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
			//* Export declaration
			return f.updateExportDeclaration(
				node, node.decorators, node.modifiers, node.isTypeOnly, node.exportClause,
				f.createStringLiteral(_resolvePath(node.moduleSpecifier)), undefined
			);
		} else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
			//* Dynamic import
			if (node.arguments.length !== 1)
				throw new Error(`Dynamic import must have one specifier as an argument at ${errorFile(srcFile, node)}`);
			var expr: ts.Expression = node.arguments[0];
			if (ts.isStringLiteral(expr)) {
				expr = f.createStringLiteral(_resolvePath(node.arguments[0]));
			} else {
				expr = ts.visitEachChild<ts.Expression>(
					expr,
					function (n: ts.Node) {
						if (ts.isStringLiteral(n))
							n = f.createStringLiteral(_resolvePath(n));
						return n;
					},
					ctx
				);
			}
			return f.updateCallExpression(
				node, node.expression, node.typeArguments, [expr]
			);
		}
		return ts.visitEachChild(node, _visitor, ctx);
	}
	/** Resolve path */
	function _resolvePath(node: ts.Expression) {
		// Remove quotes, parsing using JSON.parse fails on simple quoted strings
		//TODO find better solution to parse string
		var path = tsPrinter.printNode(ts.EmitHint.Unspecified, node, srcFile);
		path = path.slice(1, -1);
		// replace @specifier
		let startsWithAt;
		if (
			(startsWithAt = path.charAt(0) === '@') ||
			(path.charAt(0) === '.' && !path.endsWith(targetExtension))
		) {
			// get absolute path
			if (startsWithAt) path = path.replace(replacerRegex, _replaceCb);
			else path = resolve(_dirname, path);
			// check file exists
			path = _resolveFilePath(path);
			// create relative path to current file
			path = relative(_dirname, path);
			// Replace windows anti-slashes
			if (isWindows) path = path.replace(/\\/g, '/');
			// Add prefix "./"
			if (path.charAt(0) === '/') path = '.' + path;
			else if (path.charAt(0) !== '.') path = './' + path;
		}
		return path;
	}
	// Path replacer
	function _replaceCb(txt: string, k: string) {
		return mappedPaths.get(k) ?? txt;
	}
	// Resolve file path
	function _resolveFilePath(path: string) {
		// Check if directory
		try {
			// If isn't directory, we will not change it's extension
			if (statSync(path).isDirectory())
				path = resolve(path, 'index' + targetExtension);
		} catch (err) {
			try {
				if (statSync(path + '.ts').isFile()) path += targetExtension;
			} catch (e) {
				// try {
				// 	if (
				// 		-!path.endsWith('.js') &&
				// 		statSync(path + '.js').isFile()
				// 	)
				// 		path += '.js';
				// } catch (e) {
				console.error(err);
				// }
			}
		}
		return path;
	}
}


