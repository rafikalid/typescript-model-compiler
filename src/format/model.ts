import { Kind } from "@parser/kind";
import { MethodNode } from "@parser/model";
import ts from "typescript";

/** Root nodes */
export type FormattedRootNode = FormattedObject | FormattedScalar | FormattedEnum | FormattedList;

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
	method: MethodNode | undefined
}

/** Formatted Enum */
export interface FormattedEnum extends _FormattedNode {
	kind: Kind.ENUM
}

/** Formatted List */
export interface FormattedList extends _FormattedNode {
	kind: Kind.LIST
}