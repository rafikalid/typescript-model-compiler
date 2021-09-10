import {
	BasicScalar,
	Enum,
	InputField,
	ModelKind,
	OutputField,
	Scalar,
	Union,
	_Node,
} from 'tt-model';

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
export interface FormattedOutputObject extends Omit<_Node, 'fileName'> {
	kind: ModelKind.FORMATTED_OUTPUT_OBJECT;
	/** Fields */
	fields: formattedOutputField[];
	/** Escaped name */
	escapedName: string;
}

/** Input Plain object */
export interface FormattedInputObject extends Omit<_Node, 'fileName'> {
	kind: ModelKind.FORMATTED_INPUT_OBJECT;
	/** Fields */
	fields: formattedInputField[];
	/** Escaped name */
	escapedName: string;
}

/** Formatted input field */
export type formattedInputField = Omit<InputField, 'fileName'>;
export type formattedOutputField = Omit<OutputField, 'fileName'>;
