/** Interface */

import ts from "typescript";
import { AllNodes } from "./model";

/** Interface */
export interface VisitorEntities {
	node: ts.Node;
	nodeType: ts.Type;
	parentDescriptor: AllNodes | undefined;
	srcFile: ts.SourceFile;
	isInput: boolean | undefined;
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
		node: ts.Node,
		nodeType: ts.Type,
		parentDescriptor: AllNodes | undefined,
		srcFile: ts.SourceFile,
		isInput?: boolean,
		entityName?: string
	) {
		var queue = this._queue;
		queue.push({
			node: node,
			nodeType: nodeType,
			parentDescriptor,
			srcFile,
			isInput,
			entityName
		});
		return this;
	}
}