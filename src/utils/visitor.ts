/** Queue visitor */

import ts from "typescript";

/** Visitor pattern using generators */
export class Visitor<T, TModelNode>{
	private _queue: VisitorEntities<T, TModelNode>[] = [];
	/** Get next element */
	*it() {
		var i = 0;
		var q = this._queue;
		while (i < q.length) {
			yield q[i++];
		}
	}
	/** Push items */
	push(nodes: T | readonly T[]|undefined, parentDescriptor: TModelNode|undefined, srcFile: ts.SourceFile, isInput?: boolean){
		var queue= this._queue;
		if(Array.isArray(nodes)){
			var i, len;
			for (i = 0, len = nodes.length; i < len; ++i) {
				queue.push({
					node: nodes[i],
					parentDescriptor,
					srcFile,
					isInput
				});
			}
		} else if(nodes!= null) {
			queue.push({
				node: nodes as T,
				parentDescriptor,
				srcFile,
				isInput
			});
		}
		return this;
	}
	/**
	 * Clear visitor
	 */
	 clear(){
		this._queue.length= 0;
		return this;
	}

	/** Length */
	get length(){
		return this._queue.length;
	}
}

/** Interface */
export interface VisitorEntities<T, TModelNode>{
	node: T
	parentDescriptor: 	TModelNode|undefined
	srcFile:			ts.SourceFile
	isInput:			boolean|undefined
}