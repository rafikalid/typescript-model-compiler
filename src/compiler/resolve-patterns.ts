import { getNodePath } from "@utils/node-path";
import ts from "typescript";

/**
 * Resolve patterns
 * @param libs - {libName: {className: 'Model', methods: Set('scan', 'scanGraphQL')}}
 */
export function resolvePatterns(
	program: ts.Program,
	files: IterableIterator<string>,
	libs: Record<string, MethodDesc>
): ResolvedPattern[] {
	const result: ResolvedPattern[] = [];
	const typeChecker = program.getTypeChecker();
	//* Selected all methods
	const methods = new Set();
	for (let k in libs) {
		if (libs.hasOwnProperty(k)) {
			libs[k].methods.forEach(e => methods.add(e));
		}
	}
	//* iterate over all files
	let done: boolean | undefined;
	const Queue: ts.Node[] = [];
	do {
		//* Load data
		const next = files.next();
		done = next.done;
		if (next.value == null) continue;
		const srcFile = program.getSourceFile(next.value);
		if (srcFile == null) continue;
		//* Check if file include target lib
		let libFound = false;
		Queue.length = 0;
		Queue.push(...srcFile.getChildren());
		for (let i = 0; i < Queue.length; ++i) {
			const node = Queue[i];
			if (ts.isImportDeclaration(node)) {
				const lib = node.moduleSpecifier.getText().slice(1, -1);
				const libInfo = libs[lib];
				if (libInfo == null) continue;
				node.importClause?.namedBindings?.forEachChild(function (n) {
					if (
						ts.isImportSpecifier(n) &&
						libInfo.className === (n.propertyName ?? n.name).getText()
					) {
						libFound = true;
					}
				});
				if (libFound) break;
			} else if (node.kind === ts.SyntaxKind.SyntaxList) {
				Queue.push(...node.getChildren());
			}
		}
		if (!libFound) continue;
		//* Look for pattern
		Queue.length = 0;
		Queue.push(srcFile);
		for (let i = 0; i < Queue.length; ++i) {
			const node = Queue[i];
			if (ts.isCallExpression(node)) {
				let expr = node.expression;
				let importSpecifier: ts.Node | undefined;
				let lib: MethodDesc;
				let methodName: string;
				if (
					ts.isPropertyAccessExpression(expr) &&
					(methodName = expr.name.getText()) &&
					methods.has(methodName) &&
					ts.isIdentifier(expr.expression) &&
					(importSpecifier = typeChecker.getSymbolAtLocation(expr.expression)?.declarations?.[0]) &&
					ts.isImportSpecifier(importSpecifier) &&
					(lib = libs[importSpecifier.parent.parent.parent.moduleSpecifier.getText().slice(1, -1)]) &&
					lib.className === (importSpecifier.propertyName ?? importSpecifier.name).getText() &&
					lib.methods.has(methodName)
				) {
					const info = lib.resolve(node, methodName, srcFile);
					if (info.files.length === 0)
						throw new Error(`Empty file result for pattern "${info.pattern}" at: ${getNodePath(node)}`);
					result.push(info);
				}
			} else {
				Queue.push(...node.getChildren());
			}
		}
	} while (!done);
	return result;
}

/** Result schema */
export type ResolvedPattern = ResolvedPatternScan | ResolvedPatternGraphQL
/** Result schema */
export interface _ResolvedPattern {
	filePath: string
	lib: string
	methodName: string
	pattern: string
	node: ts.Node
	/** Resolved files via Glob pattern */
	files: string[]
}

/** Graphql pattern */
export interface ResolvedPatternGraphQL extends _ResolvedPattern {
	lib: 'tt-model'
	methodName: 'scanGraphQL'
	schemaEntityName: string
	contextEntityName: string
	//TODO resolve jsDoc annotations
}

/** Scan pattern */
export interface ResolvedPatternScan extends _ResolvedPattern {
	lib: 'tt-model'
	methodName: 'scan'
}

/** Method type */
export interface MethodDesc {
	className: string,
	methods: Set<string>,
	resolve: (node: ts.CallExpression, methodName: string, srcFile: ts.SourceFile) => ResolvedPattern
}