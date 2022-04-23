import { Kind } from "./kind";
import ts from "typescript";
import type { StaticValue } from 'tt-model';


/** Nodes */
export type Node = ObjectNode | FieldNode | MethodNode | ParamNode |
	ListNode | ScalarNode | RefNode | StaticValueNode | EnumNode | EnumMemberNode |
	ValidatorClassNode | ResolverClassNode | UnionNode | ScalarNode | AnyNode;

/** Root nodes */
export type RootNode = ObjectNode | ListNode | ScalarNode | UnionNode | EnumNode;

/** Field possible types (string means reference) */
export type FieldType = RefNode | StaticValueNode | AnyNode | undefined;

/** @abstract root node */
export interface _Node {
	kind: Kind;
	/** JS DOCS */
	jsDoc: string[];
	/** jsDocTags */
	jsDocTags: JsDocTag[]
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
	/** Do order fields by name */
	// orderByName: boolean | undefined;
	/** Fields */
	fields: Map<string, FieldNode>;
	/** Annotations: [AnnotationName, AnnotationValue, ...] */
	annotations: Annotation[]
	/** Is target a class */
	isClass: boolean;
	/** Use for compatibility */
	parentsName: undefined
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
	/** Name of the class, interface or type */
	className: string | undefined;
	/** Content type: List or type name */
	type: FieldType;
	/** Method: resolver or validator */
	method?: MethodNode
	/** Parent node */
	parent: ObjectNode | ScalarNode | ValidatorClassNode | ResolverClassNode | UnionNode
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
	type: FieldType
	parent: FieldNode
}

/** Method params */
export interface ParamNode extends _NamedNode {
	kind: Kind.PARAM
	/** If param is required */
	required: boolean;
	/** Type */
	type: FieldType;
	/** Parent node */
	parent: MethodNode
	/** Param type */
	paramType: ParamType
}

/** Params type */
export enum ParamType {
	/** Is the type of parent node */ PARENT,
	/** Is the input type */ INPUT,
	/** Is Package helper */ PACKAGE,
	/** Is user defined helper */ CONTEXT
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
	/** If this reference to a type in tt-model or it's sub-package */
	isFromPackage: boolean
}

/** Static value */
export interface StaticValueNode {
	kind: Kind.STATIC_VALUE
	value: string
	name: string
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
	/** Full qualified name */
	fullName: string
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
	entities: ImplementedEntity[]
	/** Fields */
	fields: Map<string, FieldNode>;
	/** Annotations: [AnnotationName, AnnotationValue, ...] */
	annotations: Annotation[]
	/** Parents name */
	parentsName: string
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
	kind: Kind.DECORATOR
	/** Annotation name */
	name: string
	/** File path */
	fileName: string
	/** If is from tt-Model or sub-package */
	isFromPackage: boolean
	/** Annotation argument */
	params: StaticValueResponse[]
	/** Target tsNode */
	tsNode: ts.Node
	/** Annotation Handler */
	handler?: ts.CallExpression | ts.FunctionDeclaration | ts.MethodDeclaration
}

/** Js Doc Tag */
export interface JsDocTag {
	kind: Kind.JSDOC_TAG
	name: string
	params: StaticValueResponse[]
}

/** Any */
export interface AnyNode {
	kind: Kind.ANY
	isAsync: false
	name: string
}



/** Static value response */
export interface StaticValueResponse {
	/** Current name */
	name: string
	/** Original name */
	nativeName: string | undefined
	/** Static value */
	value: StaticValue
	/** Ts node */
	tsNode: ts.Node
	/** Target ts node */
	targetTsNode: ts.Node | undefined
}


export interface ImplementedEntity {
	name: string,
	/** used for indexing */
	cleanName: string
}