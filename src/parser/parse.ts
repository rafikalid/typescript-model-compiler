import { ResolvedPattern } from "@compiler/resolve-patterns";
import ts from "typescript";

/** 
 * Parse schema
 */
export function parseSchema(program: ts.Program, files: readonly string[]) {
	//* Prepare queue
	const Q: QueueItem[] = [];
	for (let i = 0, len = files.length; i < len; ++i) {
		let srcFile = program.getSourceFile(files[i]);
		if (srcFile == null) throw new Error(`File included in pattern but not in your files to compile: ${files[i]}`);
		Q.push({ node: srcFile });
	}
	//* Iterate over all nodes
	const errors: string[] = [];
	for (let Qi = 0; Qi < Q.length; ++Qi) {
		try {
			//* Get next item
			const { node } = Q[Qi];
		} catch (err) {
			if (typeof err === 'string') errors.push(err);
			else throw err;
		}
	}
	//* Throw errors if found
	if (errors.length) throw new Error(`Parsing Errors: \n\t - ${errors.join('\n\t- ')} `);
}

/**
 * Queue
 */
interface QueueItem {
	node: ts.Node
}