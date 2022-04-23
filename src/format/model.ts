import { Kind } from "@parser/kind";
import { MethodNode, ParamType } from "@parser/model";
import ts from "typescript";

/** Root nodes */
export type FormattedRootNode = FormattedObject | FormattedScalar | FormattedEnum | FormattedList | FormattedUnion;

/** @private formatted node */
interface _FormattedNode {
	kind: Kind
	name: string
	jsDoc: string | undefined
	/** Code to add before any validation / output or just after parsing */
	before: ts.Statement[]
	/** Code to add after validation or output */
	after: ts.Statement[]
}

/** Formatted object */
export interface FormattedObject extends _FormattedNode {
	kind: Kind.OBJECT
	fields: FormattedField[]
}

/** Formatted scalar */
export interface FormattedScalar extends _FormattedNode {
	kind: Kind.SCALAR
	parse: FormattedField | undefined
	serialize: FormattedField | undefined
	fromDB: FormattedField | undefined
	toDB: FormattedField | undefined
	default: FormattedField | undefined
	defaultOutput: FormattedField | undefined
	mock: FormattedField | undefined
}

/** Formatted field */
export interface FormattedField extends _FormattedNode {
	kind: Kind.FIELD
	required: boolean
	method: FormattedMethod | undefined,
	/** Literal types has no class or interface name */
	className: string | undefined
	/** Field index inside it's own class */
	idx: number
	type: FormattedFieldType
}

/** Formatted Enum */
export interface FormattedEnum extends _FormattedNode {
	kind: Kind.ENUM
	members: FormattedEnumMember[]
}

/** Formatted List */
export interface FormattedList extends _FormattedNode {
	kind: Kind.LIST
	type: FormattedFieldType
}

/** Enum member */
export interface FormattedEnumMember {
	kind: Kind.ENUM_MEMBER;
	name: string
	jsDoc: string | undefined;
	value: string | number;
}

/** Reference */
export interface FormattedRef {
	kind: Kind.REF
	name: string
	isAsync: boolean
}

/** Static value */
export interface FormattedStaticValue {
	kind: Kind.STATIC_VALUE
	value: string | number | boolean
	isAsync: false
}

/** Union */
export interface FormattedUnion extends _FormattedNode {
	kind: Kind.UNION
	/** Remember tsNodes, gql do not support union as input */
	tsNodes: ts.Node[]
	/** Resolver */
	resolve: FormattedField
}

/** Formatted method */
export interface FormattedMethod {
	kind: Kind.METHOD
	/** Class name */
	class: string
	/** method name */
	name: string
	/** File path */
	path: string
	/** Params */
	params: FormattedParamNode[]
	/** is prototype or static method */
	isStatic: boolean;
	/** Is async */
	isAsync: boolean
	/** ref */
	type: FormattedFieldType
}

/** Method params */
export interface FormattedParamNode {
	kind: Kind.PARAM
	/** name */
	name: string
	/** If param is required */
	required: boolean;
	/** Type */
	type: FormattedFieldType;
	/** Param type */
	paramType: ParamType
}

/** Formatted ANY */
export interface FormattedAny {
	kind: Kind.ANY
	isAsync: false
}

/** Field type */
export type FormattedFieldType = FormattedRef | FormattedStaticValue | FormattedAny;