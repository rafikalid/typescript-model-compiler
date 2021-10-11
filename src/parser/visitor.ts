/** Interface */

import ts from "typescript";
import { AllNodes } from "./model";

/** Interface */
export interface VisitorEntities {
	node: ts.Node;
	parentDescriptor: AllNodes | undefined;
	srcFile: ts.SourceFile;
	isInput: boolean | undefined;
	/** If export keyword is expected */
	expectExport: boolean
	/** Name of the target entity if specified by it's parent */
	entityName: string | undefined
}
/**
 * Visitor
 */
export class NodeVisitor {
	private _queue: VisitorEntities[] = [];
	/** Get next element */
	*it() {
		var i = 0;
		var q = this._queue;
		while (i < q.length) {
			yield q[i++];
		}
	}

	/** Push items */
	push(
		nodes: ts.Node | readonly ts.Node[] | undefined,
		parentDescriptor: AllNodes | undefined,
		expectExport: boolean,
		srcFile: ts.SourceFile,
		isInput?: boolean,
		entityName?: string
	) {
		var queue = this._queue;
		if (Array.isArray(nodes)) {
			for (let i = 0, len = nodes.length; i < len; ++i) {
				queue.push({
					node: nodes[i],
					parentDescriptor,
					expectExport,
					srcFile,
					isInput,
					entityName
				});
			}
		} else if (nodes != null) {
			queue.push({
				node: nodes as ts.Node,
				parentDescriptor,
				expectExport,
				srcFile,
				isInput,
				entityName
			});
		}
		return this;
	}
}