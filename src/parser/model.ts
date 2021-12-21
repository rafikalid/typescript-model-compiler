//** PARSER MODEL

import { DEFAULT_SCALARS } from "tt-model";
import ts from "typescript";

/** Kinds */
export enum Kind {
	/** Input object */
	INPUT_OBJECT,

	/** Output Object */
	OUTPUT_OBJECT,

	/** Helper: Input resolvers */
	INPUT_RESOLVERS,

	/** Helper: Output resolvers */
	OUTPUT_RESOLVERS,

	/** Input field */
	INPUT_FIELD,
	/** Output field */
	OUTPUT_FIELD,

	/** Param */
	PARAM,

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
	REF,

	/** Formatted Input object */
	FORMATTED_OUTPUT_OBJECT,
	/** Formatted output object */
	FORMATTED_INPUT_OBJECT,

	/** Converter */
	CONVERTER
}

/** Node */
export type Node =
	| InputObject
	| OutputObject
	| Enum
	| Union
	| Scalar
	| BasicScalar;
/** Input nodes */
export type InputNode =
	| InputObject
	| Enum
	| Union
	| Scalar
	| BasicScalar;
/** Output nodes */
export type OutputNode =
	| OutputObject
	| Enum
	| Union
	| Scalar
	| BasicScalar;
// | ObjectLiteral;
export type AllNodes = Node | InputField | OutputField | List | Reference | Param | ConvertObj;

/** @abstract basic node */
export interface _Node {
	kind: Kind;
	/** Node's name: may contains special chars like | and <> */
	name: string;
	/** JS DOCS */
	jsDoc: string[];
	/** Deprecation message when exists */
	deprecated: string | undefined;
	/** Files where this entity found */
	fileNames: String[]
}

/** Output Object */
export interface OutputObject extends _Node {
	kind: Kind.OUTPUT_OBJECT;
	/** Name without generic parameters */
	escapedName: string | undefined;
	/** inherited classes and interfaces */
	inherit: string[] | undefined;
	/** Do order fields by name */
	orderByName: boolean | undefined;
	/** Fields */
	fields: Map<string, OutputField>;
	/** Wrap object validation */
	wrappers: MethodDescM[] | undefined
	before: MethodDescM[] | undefined
	after: MethodDescM[] | undefined
	/** Owned fields count */
	ownedFieldsCount: number
	/** Converter */
	convert: ConvertObj | undefined
}

/** Input Object  */
export interface InputObject extends Omit<OutputObject, 'kind' | 'fields'> {
	kind: Kind.INPUT_OBJECT;
	/** Fields */
	fields: Map<string, InputField>;
}
/** Convert object format */
export interface ConvertObj extends MethodDescM {
	kind: Kind.CONVERTER;
	type: Reference | undefined;
}


/** Commons between input and output fields */
interface _Field extends _Node {
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
export interface InputField extends _Field {
	kind: Kind.INPUT_FIELD;
	/** Input Assert */
	asserts: AssertOptions | undefined;
	/** Input validator */
	method: MethodDescriptor | undefined;
}

/** Object field */
export interface OutputField extends _Field {
	kind: Kind.OUTPUT_FIELD;
	/** Resolver method */
	method: MethodDescriptor | undefined;
	/** Method main parameter */
	param: Param | undefined; // Param is a reference, could not be array or any else.
}


/** Method descriptor minimal */
export interface MethodDescM {
	/** File name */
	fileName: string;
	/** class name */
	className: string;
	/** Method name */
	name: string | undefined;
	/** If this method is async (has promise) */
	isAsync: boolean
}
/** Method descriptor */
export interface MethodDescriptor extends MethodDescM {
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
	/** Escaped name to use with graphql */
	escapedName: string;
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
	parser: MethodDescriptor | undefined;
	/** Escaped name to use with graphql */
	escapedName: string;
}

/** Assert options */
export interface AssertOptions {
	/** Min value, arr.length or string.length */
	min?: string;
	/** Max value, arr.length or string.length */
	max?: string;
	/** less than value, arr.length or string.length */
	lt?: string;
	/** greater than value, arr.length or string.length */
	gt?: string;
	/** less than or equals value, arr.length or string.length */
	lte?: string;
	/** greater than or equals value, arr.length or string.length */
	gte?: string;
	/** Value equals */
	eq?: string;
	/** Value not equals */
	ne?: string;
	/** arr.length or string.length */
	length?: string;
	/** Regular expression */
	regex?: RegExp;
}

/** Scalar definition */
export interface Scalar extends _Node {
	kind: Kind.SCALAR;
	parser: MethodDescriptor;
	/** Escaped name to use with graphql */
	escapedName: string;
}

/** Basic scalar */
export interface BasicScalar extends _Node {
	kind: Kind.BASIC_SCALAR;
	name: typeof DEFAULT_SCALARS[number];
	/** Escaped name to use with graphql */
	escapedName: string;
}

/** Generic reference or operation: Example: Page<User>, Partial<Booking> */
export interface Reference {
	kind: Kind.REF;
	/** Reference name */
	name: string;
	/** source file name. Used for debugger */
	fileName: string;
	// /** Params in case of generic type */
	// params: FieldType[] | undefined;
	// /** Node: enables us to resolve fields for dynamic fields (like Omit and Partial) */
	// visibleFields:
	// | Map<
	// 	string,
	// 	{
	// 		flags: ts.SymbolFlags;
	// 		className: string;
	// 	}
	// >
	// | undefined;
}

/** Field possible types (string means reference) */
export type FieldType = List | Reference;

/** Param */
export interface Param extends _Node {
	kind: Kind.PARAM;
	type: Reference | undefined;
}


/** Root config interface */
export interface RootConfig {
	before: MethodDescM[];
	after: MethodDescM[];
	wrappers: MethodDescM[];
}