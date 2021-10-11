//** PARSER MODEL

import ts from "typescript";

/** Kinds */
export enum Kind {
	/** Plain object */
	PLAIN_OBJECT,
	/** Object literal */
	OBJECT_LITERAL,

	/** Input field */
	INPUT_FIELD,
	/** Output field */
	OUTPUT_FIELD,

	/** Enumeration */
	ENUM,

	/** Enum member */
	ENUM_MEMBER,

	/** List of sub entries */
	LIST,

	/** Multiple possible kinds */
	UNION,

	/** Scalar */
	SCALAR,
	/** Basic scalar */
	BASIC_SCALAR,
	/** Reference */
	REF
}

/** Node */
export type Node =
	| PlainObject
	| Enum
	| Union
	| Scalar;
// | ObjectLiteral;
export type AllNodes = Node | InputField | OutputField | List | Reference;

/** @abstract basic node */
export interface _Node {
	kind: Kind;
	/** Basic name: may contain special chars like | and <> */
	name: string;
	/** Escaped name used as the main name of the entity */
	escapedName: string;
	/** JS DOCS */
	jsDoc: string[];
	/** Deprecation message when exists */
	deprecated: string | undefined;
	/** Files where this entity exists */
	fileNames: String[]
}

/** Plain object */
export interface PlainObject extends Omit<_Node, 'jsDoc'> {
	kind: Kind.PLAIN_OBJECT;
	/** inheritance: parent classes implemented interfaces */
	inherit: Reference[] | undefined;
	/** In case of generic: Generic keys */
	generics: string[] | undefined;
	/** Input info */
	input: InputPlainObject
	/** Output info */
	output: OutputPlainObject
}

export interface OutputPlainObject {
	/** Fields */
	fields: Map<string, OutputField>;
	/** Visible owned and inherited fields with their flags */
	visibleFields: Map<string, { flags: ts.SymbolFlags; className: string }>;
	/** Fields count: used to generate indexes for owned fields */
	ownedFields: number;
	/** Exec methods before fields validation */
	before: MethodDescriptor | undefined
	/** Exec methods After fields validation */
	after: MethodDescriptor | undefined
	/** JS DOCS */
	jsDoc: string[];
}

export interface InputPlainObject extends Omit<OutputPlainObject, 'fields'> {
	/** Fields */
	fields: Map<string, InputField>;
}


/** Object Literal */
export interface ObjectLiteral extends _Node {
	kind: Kind.OBJECT_LITERAL;
	/** Fields: Could be input or output field */
	fields: Map<string, InputField>;
	/** Fields count: used to generate indexes for owned fields */
	ownedFields: number;
}

/** Commons between input and output fields */
export interface Field {
	/** Field index inside it's parent object */
	idx: number;
	/** Name of the class */
	className: string | undefined;
	/** Field alias */
	alias: string | undefined;

	/** If field is required */
	required: boolean;
	/** Content type: List or type name */
	type: FieldType;
	/** Default value */
	defaultValue: any;
}

/** Input field */
export interface InputField extends Field {
	kind: Kind.INPUT_FIELD;
	/** Input Assert */
	asserts: AssertOptions | undefined;
	/** Input validator */
	validate: MethodDescriptor | undefined;
}

/** Object field */
export interface OutputField extends Field {
	kind: Kind.OUTPUT_FIELD;
	/** Resolver method */
	method: MethodDescriptor | undefined;
	/** Method main parameter */
	param: Reference | undefined; // Param is a reference, could not be array or any else.
}


/** Method descriptor */
export interface MethodDescriptor {
	/** File name */
	fileName: string;
	/** class name */
	className: string;
	/** Method name */
	name: string | undefined;
	/** is prototype or static method */
	isStatic: boolean;
	/** Is target a class */
	isClass: boolean;
}

/** List */
export interface List extends Omit<_Node, 'name'> {
	kind: Kind.LIST;
	required: boolean;
	type: FieldType;
}


/** ENUM */
export interface Enum extends _Node {
	kind: Kind.ENUM;
	members: EnumMember[];
}

/** ENUM member */
export interface EnumMember extends _Node {
	kind: Kind.ENUM_MEMBER;
	value: string | number;
}

/** UNION */
export interface Union extends _Node {
	kind: Kind.UNION;
	/** TODO convert this to references to plain objects */
	types: Reference[];
	parser: MethodDescriptor;
}

/** Assert options */
export interface AssertOptions {
	/** Min value, arr.length or string.length */
	min?: number;
	/** Max value, arr.length or string.length */
	max?: number;
	/** less than value, arr.length or string.length */
	lt?: number;
	/** greater than value, arr.length or string.length */
	gt?: number;
	/** less than or equals value, arr.length or string.length */
	lte?: number;
	/** greater than or equals value, arr.length or string.length */
	gte?: number;
	/** Value equals */
	eq?: number | string;
	/** Value not equals */
	ne?: number | string;
	/** arr.length or string.length */
	length?: number;
	/** Regular expression */
	regex?: RegExp;
}

/** Scalar definition */
export interface Scalar extends _Node {
	kind: Kind.SCALAR;
	parser: MethodDescriptor;
}

/** Generic reference or operation: Example: Page<User>, Partial<Booking> */
export interface Reference {
	kind: Kind.REF;
	/** Resolved reference name */
	name: string;
	/** Original reference name (effective name in the code) */
	oName: string;
	/** Reference full name */
	fullName: string | undefined;
	/** source file name. Used for debugger */
	fileName: string;
	/** Params in case of generic type */
	params: FieldType[] | undefined;
	/** Node: enables us to resolve fields for dynamic fields (like Omit and Partial) */
	visibleFields:
	| Map<
		string,
		{
			flags: ts.SymbolFlags;
			className: string;
		}
	>
	| undefined;
}

/** Field possible types (string means reference) */
export type FieldType = List | Reference;
