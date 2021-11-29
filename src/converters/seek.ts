/** Create tree seeker */
export function seek<T, TData>(
	rootNodes: T | T[],
	/**
	 * @return  T[]	- List of children
	 * @return  undefined	- No child or already created
	 * @return  false	- ignore this field
	 */
	goDown: (node: T, isInput: boolean, parentNode: T | undefined) => T[] | { nodes: T[], isInput: boolean } | undefined | false,
	goUp: (node: T, isInput: boolean, parentNode: T | undefined, childrenData: TData[]) => TData | undefined | false
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
			childrenData: rootChildrenData,
			index: 0
		}, {
			node: rootNodes[i],
			isInput: false,
			parentNode: undefined,
			state: NodeVisitState.GO_UP,
			childrenData: nodeData
		}, {
			node: rootNodes[i],
			isInput: false,
			parentNode: undefined,
			state: NodeVisitState.GO_DOWN,
			childrenData: nodeData
		});
	}
	// Seek
	const errors: string[] = []
	var result: TData[];
	var childReturnedData: TData | undefined | false;
	const _isArray = Array.isArray;
	rootLoop: while (true) {
		try {
			const item = queue.pop()!;
			const { childrenData, state } = item;
			switch (state) {
				case NodeVisitState.GO_DOWN: {
					let { node, parentNode, isInput } = item;
					let childNodes = goDown(node, isInput, parentNode);
					if (childNodes == null || childNodes === false) break; // if circular or already created or ignore it
					if (!_isArray(childNodes)) {
						isInput = childNodes.isInput;
						childNodes = childNodes.nodes;
					}
					//* Go through children
					for (let i = 0, len = childNodes.length; i < len; ++i) {
						let childData: TData[] = [];
						queue.push({
							state: NodeVisitState.COLLECT_DATA,
							childrenData: childrenData,
							index: i
						}, {
							node: childNodes[i],
							isInput,
							parentNode: node,
							state: NodeVisitState.GO_UP,
							childrenData: childData
						}, {
							node: childNodes[i],
							isInput,
							parentNode: node,
							state: NodeVisitState.GO_DOWN,
							childrenData: childData
						});
					}
					break;
				}
				case NodeVisitState.COLLECT_DATA: {
					// @ts-ignore
					childrenData[item.index] = childReturnedData;
					// childrenData.push(childReturnedData);
					break;
				}
				case NodeVisitState.GO_UP: {
					let { node, parentNode, isInput } = item;
					childReturnedData = goUp(node, isInput, parentNode, childrenData);
					break;
				}
				case NodeVisitState.ROOT_NODE: {
					//* The end of seek
					result = childrenData;
					break rootLoop;
				}
				default: {
					let c: never = state;
				}
			}
		} catch (error) {
			if (typeof error === 'string') errors.push(error);
			else throw error;
		}
	}
	if (errors.length != 0) throw new Error("Errors:\n• " + errors.join("\n• "));
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
	/** Is input */
	isInput: boolean
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
	childrenData: TData[],
	/** Node index */
	index: number
}
/** Root node */
interface QueueRootNode<TData> {
	state: NodeVisitState.ROOT_NODE
	/** Data from child nodes */
	childrenData: TData[]
}