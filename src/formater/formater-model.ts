import { BasicScalar, Enum, InputField, ModelKind, OutputField, Scalar, Union, _Node } from "../parser/model";

/** Formated node */
export type FormatedInputNode=	FormatedInputObject | Enum | Union | Scalar | BasicScalar;
export type FormatedOutputNode=	FormatedOutputObject | Enum | Union | Scalar | BasicScalar;


/** Output Plain object */
export interface FormatedOutputObject extends Omit<_Node, 'fileName'>{
	kind:		ModelKind.FORMATED_OUTPUT_OBJECT
	/** Fields */
	fields:		formatedOutputField[]
	/** Escaped name */
	escapedName: string
}

/** Input Plain object */
export interface FormatedInputObject extends Omit<_Node, 'fileName'>{
	kind:		ModelKind.FORMATED_INPUT_OBJECT
	/** Fields */
	fields:		formatedInputField[]
	/** Escaped name */
	escapedName: string
}

/** Formated input field */
export type formatedInputField= Omit<InputField, 'fileName'>
export type formatedOutputField= Omit<OutputField, 'fileName'>