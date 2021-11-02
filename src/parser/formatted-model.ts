import {
	BasicScalar,
	Enum,
	EnumMember,
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
	| FormattedEnum
	| FormattedUnion
	| FormattedScalar
	| FormattedBasicScalar;
export type FormattedOutputNode =
	| FormattedOutputObject
	| FormattedEnum
	| FormattedUnion
	| FormattedScalar
	| FormattedBasicScalar;

/** Formatted Node */
export interface FormattedNode {
	jsDoc: string | undefined
}
type _FormattedNodeKeys = keyof FormattedNode;
type _Formatted<T> = Omit<T, _FormattedNodeKeys> & FormattedNode;

/** Formatted enum */
export type FormattedEnumMember = _Formatted<EnumMember>;
export type FormattedEnum = Omit<Enum, 'jsDoc' | 'members'> & { jsDoc: string | undefined, members: FormattedEnumMember[] };
export type FormattedUnion = _Formatted<Union>;
export type FormattedScalar = _Formatted<Scalar>;
export type FormattedBasicScalar = _Formatted<BasicScalar>;


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