import { ConvertObj, MethodDescriptor } from '..';
import {
	BasicScalar,
	Enum,
	EnumMember,
	InputField,
	Kind,
	OutputField,
	Scalar,
	Union,
	MethodDescM,
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
	wrappers: MethodDescM[] | undefined
	before: MethodDescM[] | undefined
	after: MethodDescM[] | undefined
	/** JS DOCS */
	jsDoc: string | undefined;
	/** Deprecation message when exists */
	deprecated: string | undefined;
	/** Converter */
	convert: ConvertObj | undefined
}

/** Input Plain object */
export interface FormattedInputObject extends Omit<FormattedOutputObject, 'kind' | 'fields'> {
	kind: Kind.FORMATTED_INPUT_OBJECT;
	/** Fields */
	fields: formattedInputField[];
}


export interface FormattedFieldsAdditional {
	jsDoc: string | undefined
	/** Referenced object convert method */
	convert: ConvertObj | undefined
}

export type formattedInputField = Omit<InputField, keyof FormattedFieldsAdditional> & FormattedFieldsAdditional;
export type formattedOutputField = Omit<OutputField, keyof FormattedFieldsAdditional> & FormattedFieldsAdditional;


// /** Resolved fields */
// interface ResolvedFieldInterface {
// 	field: Field;
// 	required: boolean;
// 	inheritedFrom: string | undefined;
// 	index: number;
// 	className: string;
// }