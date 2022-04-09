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
	console.log('Resolve patterns ********************')
	const result: ResolvedPattern[] = [];
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
				let info: MethodDesc;
				if (
					ts.isPropertyAccessExpression(expr) &&
					ts.isIdentifier(expr.expression) &&
					methods.has(expr.name.getText())
				) {
					let propName = expr.name.getText();
					console.log('--- FOUND:', propName);
				}
			} else {
				Queue.push(...node.getChildren());
			}
		}
	} while (!done);
	return result;
}

/** Result schema */
export interface ResolvedPattern {
	pattern: string
	filePath: string
	node: ts.Node
}

/** Method type */
export interface MethodDesc {
	className: string,
	methods: Set<string>
}