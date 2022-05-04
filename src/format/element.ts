import { Kind } from "@parser/kind";
import { FieldNode, ObjectNode, ParamType, RootNode, Node, MethodNode, FieldType, EnumMemberNode, ValidatorClassNode, ResolverClassNode, Annotation as CompilerAnnotation } from "@parser/model";
import { Annotation, Element, ObjectElement, PropertyElement } from "tt-model";
import { _splitAccessPath } from "./utils";

/** Element */
abstract class _Element<T extends FieldNode | RootNode> implements Element {
	protected _elNode: T;
	protected _mapNodes: Map<string, RootNode | undefined>;
	name: string

	constructor(node: T, mapNodes: Map<string, RootNode | undefined>) {
		this.name = node.name;
		this._elNode = node;
		this._mapNodes = mapNodes;
	}

	/** Has annotation */
	hasAnnotation(name: string) {
		return this._elNode.annotations.some(a => a.name === name);
	}
	/** Annotations */
	get annotations(): Annotation[] {
		return this._elNode.annotations.map(a => ({
			type: a.kind === Kind.DECORATOR ? 'DECORATOR' : 'JSDOC_TAG',
			name: a.name,
			args: a.params,
			element: this as unknown as PropertyElement
		}));
	}

	/** Get annotation */
	getAnnotation(name: string) {
		const result: Annotation[] = [];
		this._elNode.annotations.forEach(a => {
			if (a.name === name)
				result.push({
					type: a.kind === Kind.DECORATOR ? 'DECORATOR' : 'JSDOC_TAG',
					name: a.name,
					args: a.params,
					element: this as unknown as PropertyElement
				});
		});
		return result;
	}

	/** Resolve path */
	_resolvePath(type: RootNode | FieldNode | MethodNode | undefined | ValidatorClassNode | ResolverClassNode, path: string): Node | undefined {
		let result: Node | undefined = type;
		const mapNodes = this._mapNodes;
		const pathArr = _splitAccessPath(path);
		for (let i = 0, len = pathArr.length; i < len; ++i) {
			const p = pathArr[i];
			let ref: FieldType | EnumMemberNode;
			if (result == null) return;
			switch (result.kind) {
				case Kind.OBJECT:
				case Kind.UNION:
				case Kind.RESOLVER_CLASS:
				case Kind.VALIDATOR_CLASS:
					if (typeof p === 'number') return; // Expected not array
					ref = result.fields.get(p)?.type;
					break;
				case Kind.LIST:
					if (typeof p !== 'number') return; // Expected array
					ref = result.type;
					break;
				case Kind.ENUM:
					if (typeof p === 'number') return; // Expected not array
					ref = result.members.find(m => m.name === p);
					break;
				case Kind.METHOD: // Resolve params
					if (typeof p === 'number') return; // Expected not array
					ref = result.params.find(e => e.name === p)?.type;
					break;
				case Kind.FIELD:
					ref = result.type;
					--i;
					break;
				case Kind.SCALAR:
				case Kind.ENUM_MEMBER:
					return; // enum member has no sub-nodes
				default: {
					const n: never = result;
					return; // Unexpected
				}
			}
			// Resolve reference
			if (ref == null) return;
			switch (ref.kind) {
				case Kind.REF:
					result = mapNodes.get(ref.name);
					break;
				case Kind.ENUM_MEMBER:
					result = ref;
					break;
				case Kind.STATIC_VALUE:
				case Kind.ANY:
					return; // Unexpected to return this
				default: {
					const n: never = ref;
				}
			}
		}
		return result;
	}
}

/**
 * property element
 */
export class PropertyElementImp extends _Element<FieldNode> implements PropertyElement {
	required: boolean;
	type: 'Field' | 'Method'
	isAsync: boolean;
	//* Type info
	/** Alias to typeName */
	parentTypeName: string

	constructor(field: FieldNode, mapNodes: Map<string, RootNode | undefined>) {
		super(field, mapNodes);
		this.type = field.method ? 'Method' : 'Field';
		this.required = field.required;
		this.isAsync = field.type?.isAsync ?? false;
		this.parentTypeName = field.parent.name;
	}

	get typeName(): string {
		const type = this._elNode.type;
		return type == null ? 'undefined' :
			type.kind === Kind.ANY ? 'any' :
				type.kind === Kind.REF ? type.name : String(type.value)
	}
	get outputTypeName() { return this.typeName; }
	get inputTypeName() {
		return this._elNode.method?.params.find(e => e.paramType === ParamType.INPUT)?.name;
	}


	/**
	 * Check if has an input
	 * @example hasInput('inputArg')
	 * @example hasInput('inputArg.id')
	 * @example hasInput('inputArg\\.name.id') to escape "." add "\\"
	 * @example hasInput('inputArg.list.[].id') "[]" means list. to escape it add "\\"
	 */
	hasParam(path: string): boolean {
		return this._resolvePath(this._elNode.method, path) != null;
	}
	/**
	 * Check if has an output
	 * @example hasOutput('inputArg')
	 * @example hasOutput('inputArg.id')
	 * @example hasOutput('inputArg\\.name.id') to escape "." add "\\"
	 * @example hasOutput('inputArg.list.[].id') "[]" means list. to escape it add "\\"
	 */
	hasOutput(path: string): boolean {
		return this._resolvePath(this._elNode, path) != null;
	}
	/**
	 * Check if has sibling property
	 */
	hasSibling(path: string): boolean {
		return this._resolvePath(this._elNode.parent, path) != null;
	}

}

/**
 * Object element
 */
export class ObjectElementImp extends _Element<RootNode> implements ObjectElement {
	type: 'object' = 'object'

	constructor(obj: RootNode, mapNodes: Map<string, RootNode | undefined>) {
		super(obj, mapNodes);
	}

	/**
	 * Check if has a property
	 * @example has('inputArg')
	 * @example has('inputArg.id')
	 * @example has('inputArg\\.name.id') to escape "." add "\\"
	 * @example has('inputArg.list.[].id') "[]" means list. to escape it add "\\"
	 */
	has(path: string): boolean {
		return this._resolvePath(this._elNode, path) != null;
	}
}

/** Convert compiler annotation model to tt-model */
export function _convertAnnotation(
	p: RootNode | FieldNode,
	mapNodes: Map<string, RootNode | undefined>,
	annotations: CompilerAnnotation[]
): Annotation[] {
	const el = p.kind === Kind.FIELD ? new PropertyElementImp(p, mapNodes) : new ObjectElementImp(p, mapNodes);
	return annotations.map(a => ({
		type: a.kind === Kind.DECORATOR ? 'DECORATOR' : 'JSDOC_TAG',
		name: a.name,
		args: a.params,
		element: el
	}));
}