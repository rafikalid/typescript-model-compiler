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
	/** If this class is a helper class that contains resolves of an other class */
	isResolversImplementation: boolean | undefined;
	/** Name of the target entity if specified by it's parent */
	entityName: string | undefined,
	/** Property type in case of generic */
	propertyType: ts.Type | undefined,
	/** Property symbol */
	symbol: ts.Symbol | undefined
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
		entityName?: string,
		isResolversImplementation?: boolean,
		/** Type of property in case of generics */
		propertyType?: ts.Type,
		symbol?: ts.Symbol
	) {
		const queue = this._queue;
		queue.push({
			node: node,
			nodeType: nodeType,
			parentDescriptor,
			srcFile,
			isInput,
			entityName,
			isResolversImplementation,
			propertyType,
			symbol
		});
		return this;
	}
	pushChildren(
		typeChecker: ts.TypeChecker,
		node: ts.Node,
		parentDescriptor: AllNodes | undefined,
		srcFile: ts.SourceFile,
		isInput?: boolean,
		entityName?: string,
		isResolversImplementation?: boolean
	) {
		const queue = this._queue;
		for (let j = 0, children = node.getChildren(), jLen = children.length; j < jLen; ++j) {
			let child = children[j];
			queue.push({
				node: child,
				nodeType: typeChecker.getTypeAtLocation(child),
				parentDescriptor,
				srcFile,
				isInput,
				entityName,
				isResolversImplementation,
				propertyType: undefined,
				symbol: undefined
			});
		}
	}
}