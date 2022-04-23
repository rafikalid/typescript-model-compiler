import { Kind } from "@parser/kind";
import { FieldNode, ObjectNode, ParamType, RootNode, Node, MethodNode, FieldType, EnumMemberNode, ValidatorClassNode, ResolverClassNode } from "@parser/model";
import { Annotation, ObjectElement, PropertyElement } from "tt-model";
import { _splitAccessPath } from "./utils";

/** Element */
abstract class _Element {
	protected _elNode: ObjectNode | FieldNode;
	protected _mapNodes: Map<string, RootNode>

	constructor(node: FieldNode | ObjectNode, mapNodes: Map<string, RootNode>) {
		this._elNode = node;
		this._mapNodes = mapNodes;
	}

	/** Has annotation */
	hasAnnotation(name: string) {
		const field = this._elNode;
		return field.annotations.some(a => a.name === name) ||
			field.jsDocTags.some(a => a.name === name);
	}
	/** Annotations */
	get annotations(): Annotation[] {
		const field = this._elNode;
		const jsDocTags: Annotation[] = field.jsDocTags.map(a => ({
			type: 'JSDOC_TAG',
			name: a.name,
			args: a.params,
			element: this as unknown as PropertyElement
		}));
		const annotations: Annotation[] = field.annotations.map(a => ({
			type: 'DECORATOR',
			name: a.name,
			args: a.params,
			element: this as unknown as PropertyElement
		}));
		return jsDocTags.concat(annotations);
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
export class PropertyElementImp extends _Element implements PropertyElement {
	name: string
	required: boolean;
	type: 'Field' | 'Method'
	isAsync: boolean;
	//* Type info
	/** Alias to typeName */
	parentTypeName: string

	_elNode: FieldNode;

	constructor(field: FieldNode, mapNodes: Map<string, RootNode>) {
		super(field, mapNodes);
		this._elNode = field;
		this.name = field.name;
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
export class ObjectElementImp extends _Element implements ObjectElement {
	name: string
	type: 'object' = 'object'
	_elNode: ObjectNode

	constructor(obj: ObjectNode, mapNodes: Map<string, RootNode>) {
		super(obj, mapNodes);
		this._elNode = obj;
		this.name = obj.name;
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