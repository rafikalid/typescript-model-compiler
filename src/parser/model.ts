import { Kind } from "./kind";
import { ScalarOptions } from 'tt-model';


/** Nodes */
export type Node = ObjectNode | FieldNode | MethodNode | ParamNode |
	ListNode | ScalarNode | NameLessTypeNode | RefNode |
	StaticValueNode | EnumNode | EnumMemberNode | ValidatorClassNode | ResolverClassNode;

/** Root nodes */
export type RootNode = ObjectNode | ListNode | ScalarNode | EnumNode;

/** Field possible types (string means reference) */
export type FieldType = ListNode | NameLessTypeNode | RefNode | StaticValueNode;

/** @abstract root node */
export interface _Node {
	kind: Kind;
	/** JS DOCS */
	jsDoc: string[];
	/** Deprecation message when exists */
	deprecated: string | undefined;
	/** code path where node exists, debug mode only */
	paths: string[]
	/** Is input or output or both (undefined) */
	isInput: boolean | undefined
}

/** @abstract Named node */
export interface _NamedNode {
	/** Node's name: may contains special chars like | and <> */
	name: string;
}

/** Object */
export interface ObjectNode extends _NamedNode {
	kind: Kind.OBJECT
	/** inherited classes and interfaces */
	inherit: string[] | undefined;
	/** Do order fields by name */
	orderByName: boolean | undefined;
	/** Fields */
	fields: Map<string, FieldNode | MethodNode>;
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
	/** Field alias */
	alias?: string;
	/** If field is required */
	required: boolean;
	/** Default value */
	defaultValue: string;
	/** Asserts */
	asserts: string
	/** Annotations: [AnnotationName, AnnotationValue, ...] */
	annotations: Annotation[]
	/** Name of the class, interface or type */
	className: string;
	/** Content type: List or type name */
	type: FieldType;
	/** Method: resolver or validator */
	method?: MethodNode
}

/** Method */
export interface MethodNode extends Omit<FieldNode, 'kind'> {
	kind: Kind.METHOD
	/** Params */
	params: ParamNode[]
	/** If this method is async (has promise) */
	isAsync: boolean
	/** is prototype or static method */
	isStatic: boolean;
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
export interface ListNode extends _Node {
	kind: Kind.LIST
	/** If list contains null or undefined entries */
	required: boolean
}

/** Scalar */
export interface ScalarNode extends _NamedNode, Record<keyof ScalarOptions<unknown>, Method> {
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

/** Uname typ */
export interface NameLessTypeNode extends Omit<ObjectNode, 'kind' | 'inherit'> {
	kind: Kind.NAME_LESS_TYPE
}

/** Reference */
export interface RefNode extends _Node {
	kind: Kind.REF
}

/** Static value */
export interface StaticValueNode extends _NamedNode {
	kind: Kind.STATIC_VALUE
	type: string
	value: any
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
export interface UnionNode extends _NamedNode {
	kind: Kind.UNION;
	types: FieldType[];
	resolver: Method;
}

/**
 * Validator class
 * implements ValidatorsOf<Entity>, ValidatorsOf<Helper<Entity>>, ValidatorsOf<Helper<any>>
 */
export interface ValidatorClassNode extends _NamedNode {
	kind: Kind.VALIDATOR_CLASS,
	/** Implemented entities including generics without "any" keywords */
	entities: string[]
	/** Implemented generic entities with "any" keyword */
	anyGenerics: string[]
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