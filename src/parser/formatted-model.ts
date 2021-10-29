import {
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
	/** Exec methods before and after fields validation */
	wrappers: MethodDescriptor[] | undefined
	/** JS DOCS */
	jsDoc: string | undefined;
	/** Deprecation message when exists */
	deprecated: string | undefined;
}

/** Input Plain object */
export interface FormattedInputObject extends Omit<FormattedOutputObject, 'kind' | 'fields'> {
	kind: Kind.FORMATTED_INPUT_OBJECT;
	/** Fields */
	fields: formattedInputField[];
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