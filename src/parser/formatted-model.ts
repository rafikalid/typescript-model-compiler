import {
	Field,
	BasicScalar,
	Enum,
	InputField,
	MethodDescriptor,
	Kind,
	OutputField,
	Scalar,
	Union,
	_Node
} from './model';

/** Format response */
export interface FormatResponse {
	input: Map<string, FormattedInputNode>;
	output: Map<string, FormattedOutputNode>;
}


/** Formatted node */
export type FormattedInputNode =
	| FormattedInputObject
	| Enum
	| Union
	| Scalar
	| BasicScalar;
export type FormattedOutputNode =
	| FormattedOutputObject
	| Enum
	| Union
	| Scalar
	| BasicScalar;


/** Output Plain object */
export interface FormattedOutputObject {
	kind: Kind.FORMATTED_OUTPUT_OBJECT;
	/** Basic name: may contain special chars like | and <> */
	name: string;
	/** Escaped name to use with graphql */
	escapedName: string;
	/** Fields */
	fields: formattedOutputField[];
	/** Exec methods before fields validation */
	before: MethodDescriptor | undefined
	/** Exec methods After fields validation */
	after: MethodDescriptor | undefined
	/** JS DOCS */
	jsDoc: string | undefined;
	/** Deprecation message when exists */
	deprecated: string | undefined;
}

/** Input Plain object */
export interface FormattedInputObject {
	kind: Kind.FORMATTED_INPUT_OBJECT;
	/** Basic name: may contain special chars like | and <> */
	name: string;
	/** Escaped name to use with graphql */
	escapedName: string;
	/** Fields */
	fields: formattedInputField[];
	/** Exec methods before fields validation */
	before: MethodDescriptor | undefined
	/** Exec methods After fields validation */
	after: MethodDescriptor | undefined
	/** JS DOCS */
	jsDoc: string | undefined;
	/** Deprecation message when exists */
	deprecated: string | undefined;
}


export type formattedInputField = Omit<InputField, 'jsDoc'> & { jsDoc: string | undefined };
export type formattedOutputField = Omit<OutputField, 'jsDoc'> & { jsDoc: string | undefined };


// /** Resolved fields */
// interface ResolvedFieldInterface {
// 	field: Field;
// 	required: boolean;
// 	inheritedFrom: string | undefined;
// 	index: number;
// 	className: string;
// }