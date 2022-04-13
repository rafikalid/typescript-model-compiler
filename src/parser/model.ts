import { Kind } from "./kind";
import ts from "typescript";
import { Scalar } from "tt-model";


/** Nodes */
export type Node = ObjectNode | FieldNode | MethodNode | ParamNode |
	ListNode | ScalarNode | DefaultScalarNode | RefNode |
	StaticValueNode | EnumNode | EnumMemberNode | ValidatorClassNode | ResolverClassNode | UnionNode | ScalarNode;

/** Root nodes */
export type RootNode = ObjectNode | ListNode | ScalarNode | DefaultScalarNode | UnionNode | EnumNode;

/** Field possible types (string means reference) */
export type FieldType = RefNode | StaticValueNode | undefined;

/** @abstract root node */
export interface _Node {
	kind: Kind;
	/** JS DOCS */
	jsDoc: string[];
	/** jsDocTags */
	jsDocTags: Map<string, (string | undefined)[]> | undefined
	/** code path where node exists, debug mode only */
	tsNodes: ts.Node[]
	/** Is input or output or both (undefined) */
	isInput: boolean
}

/** @abstract Named node */
export interface _NamedNode extends _Node {
	/** Node's name: may contains special chars like | and <> */
	name: string;
}

/** Object */
export interface ObjectNode extends _NamedNode {
	kind: Kind.OBJECT
	/** inherited classes and interfaces */
	inherit: string[];
	/** jsDoc tags */
	jsDocTags: Map<string, (string | undefined)[]>
	/** Do order fields by name */
	// orderByName: boolean | undefined;
	/** Fields */
	fields: Map<string, FieldNode>;
	/** Annotations: [AnnotationName, AnnotationValue, ...] */
	annotations: Annotation[]
	/** Is target a class */
	isClass: boolean;
}


/** Field */
export interface FieldNode extends _NamedNode {
	kind: Kind.FIELD
	/** Field index inside it's parent object */
	idx: number;
	/** If field is required */
	required: boolean;
	/** Annotations: [AnnotationName, AnnotationValue, ...] */
	annotations: Annotation[]
	/** jsDoc tags */
	jsDocTags: Map<string, (string | undefined)[]> | undefined
	/** Name of the class, interface or type */
	className: string | undefined;
	/** Content type: List or type name */
	type: FieldType;
	/** Method: resolver or validator */
	method?: MethodNode
}

/** Method */
export interface MethodNode {
	kind: Kind.METHOD
	/** Class name */
	class: string
	/** Field name */
	name: string
	/** Params */
	params: ParamNode[]
	/** is prototype or static method */
	isStatic: boolean;
	/** tsNode */
	tsNode: ts.Node;
	/** ref */
	type: RefNode
}

/** Method params */
export interface ParamNode extends _NamedNode {
	kind: Kind.PARAM
	/** If param is required */
	required: boolean;
	/** Type */
	type: FieldType;
}

/** List */
export interface ListNode extends _NamedNode {
	kind: Kind.LIST
	/** If list contains null or undefined entries */
	required: boolean
	/** Content type: List or type name */
	type: FieldType;
}

/** Scalar */
export interface ScalarNode extends Omit<ValidatorClassNode, 'kind'> {
	kind: Kind.SCALAR
}

/**
 * Method
 */
export interface Method {
	/**
	 * Method full qualify name
	 * @example intScalar.parse
	 */
	name: string
	isAsync: boolean
	filePath: string
}

/** Reference */
export interface RefNode extends _NamedNode {
	kind: Kind.REF
	isAsync: boolean
}

/** Static value */
export interface StaticValueNode extends _NamedNode {
	kind: Kind.STATIC_VALUE
	value: string | number
	isAsync: boolean
}

/** ENUM */
export interface EnumNode extends _NamedNode {
	kind: Kind.ENUM;
	members: EnumMemberNode[];
}

/** ENUM member */
export interface EnumMemberNode extends _NamedNode {
	kind: Kind.ENUM_MEMBER;
	value: string | number;
}

/** Union */
export interface UnionNode extends Omit<ValidatorClassNode, 'kind'> {
	kind: Kind.UNION;
}

/**
 * Validator class
 * implements ValidatorsOf<Entity>, ValidatorsOf<Helper<Entity>>, ValidatorsOf<Helper<any>>
 */
export interface ValidatorClassNode extends _NamedNode {
	kind: Kind.VALIDATOR_CLASS,
	/** Implemented entities including generics without "any" keywords */
	entities: string[]
	/** Fields */
	fields: Map<string, FieldNode>;
	/** Annotations: [AnnotationName, AnnotationValue, ...] */
	annotations: Annotation[]
}
/**
 * Resolver class
 * implements ResolversOf<Entity>, ResolversOf<Helper<Entity>>, ResolversOf<Helper<any>>
 */
export interface ResolverClassNode extends Omit<ValidatorClassNode, 'kind'> {
	kind: Kind.RESOLVER_CLASS
}


/** Annotation */
export interface Annotation {
	/** Annotation name */
	name: string
	/** Annotation argument */
	arg: string
	/** Annotation file path */
	path?: string
	/** Is annotation from JSDoc or Decorator */
	isJSDoc: boolean
}

/** Default scalar node */
export interface DefaultScalarNode extends _NamedNode {
	kind: Kind.DEFAULT_SCALAR
	class: new () => Scalar<any>
}