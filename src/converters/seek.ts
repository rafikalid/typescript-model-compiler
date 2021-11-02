/** Create tree seeker */
export function seek<T, TData>(
	rootNodes: T | T[],
	/**
	 * @return  T[]	- List of children
	 * @return  undefined	- No child or already created
	 * @return  false	- Circulation: Same parent is referenced
	 */
	goDown: (node: T, parentNode: T | undefined) => T[] | false | undefined,
	goUp: (node: T, parentNode: T | undefined, childrenData: TData[]) => TData
): TData[] {
	const rootChildrenData: TData[] = [];
	const queue: QueueSchema<T, TData>[] = [
		{
			state: NodeVisitState.ROOT_NODE,
			childrenData: []
		}
	];
	//* Add root nodes
	if (!Array.isArray(rootNodes)) rootNodes = [rootNodes];
	for (let i = 0, len = rootNodes.length; i < len; ++i) {
		let nodeData: TData[] = []
		queue.push({
			state: NodeVisitState.COLLECT_DATA,
			childrenData: rootChildrenData
		}, {
			node: rootNodes[i],
			parentNode: undefined,
			state: NodeVisitState.GO_UP,
			childrenData: nodeData
		}, {
			node: rootNodes[i],
			parentNode: undefined,
			state: NodeVisitState.GO_DOWN,
			childrenData: nodeData
		});
	}
	// Seek
	const errors: string[] = []
	var result: TData[];
	rootLoop: while (true) {
		try {
			const item = queue.pop()!;
			const { childrenData, state } = item;
			let childReturnedData: TData;
			switch (state) {
				case NodeVisitState.GO_DOWN: {
					let { node, parentNode } = item;
					let childNodes = goDown(node, parentNode);
					if (childNodes === false) {
						//* Circulation detected
					} else if (childNodes != null) {
						//* Go through children
						for (let i = 0, len = childNodes.length; i < len; ++i) {
							let childData: TData[] = [];
							queue.push({
								state: NodeVisitState.COLLECT_DATA,
								childrenData: childrenData
							}, {
								node: childNodes[i],
								parentNode: node,
								state: NodeVisitState.GO_UP,
								childrenData: childData
							}, {
								node: childNodes[i],
								parentNode: node,
								state: NodeVisitState.GO_DOWN,
								childrenData: childData
							});
						}
					}
					break;
				}
				case NodeVisitState.COLLECT_DATA: {
					// @ts-ignore
					childrenData.push(childReturnedData);
					break;
				}
				case NodeVisitState.GO_UP: {
					let { node, parentNode } = item;
					childReturnedData = goUp(node, parentNode, childrenData);
					break;
				}
				case NodeVisitState.ROOT_NODE: {
					//* The end of seek
					result = childrenData;
					break rootLoop;
				}
			}
		} catch (error) {
			if (typeof error === 'string') errors.push(error);
			else throw error;
		}
	}
	if (errors.length != 0) throw '•' + errors.join("\n•");
	return result;
}

/** Node Visit state */
enum NodeVisitState {
	GO_DOWN,
	COLLECT_DATA,
	GO_UP,
	/** Used to collect last data to be returned by the function */
	ROOT_NODE
}

/** Queue schema */
type QueueSchema<T, TData> = QueueSchemaSeek<T, TData> | QueueSchemaCollect<TData> | QueueRootNode<TData>;

/** Go Up and Down */
interface QueueSchemaSeek<T, TData> {
	/** Current node */
	node: T,
	/** Parent node */
	parentNode: T | undefined
	/** Current visit state */
	state: NodeVisitState.GO_DOWN | NodeVisitState.GO_UP,
	/** Data from child nodes */
	childrenData: TData[]
}

/** Collect data */
interface QueueSchemaCollect<TData> {
	state: NodeVisitState.COLLECT_DATA,
	/** Data from child nodes */
	childrenData: TData[]
}
/** Root node */
interface QueueRootNode<TData> {
	state: NodeVisitState.ROOT_NODE
	/** Data from child nodes */
	childrenData: TData[]
}