/**
 * Node kinds
 */
export enum Kind {
	/** Object */
	OBJECT,
	/** Name less type */
	NAME_LESS_TYPE,
	/** Object field */
	FIELD,
	/** Method */
	METHOD,
	/** Method param */
	PARAM,
	/** List */
	LIST,
	/** Scalar */
	SCALAR,
	/** Reference */
	REF,
	/** Enumeration */
	ENUM,
	/** Enumeration member */
	ENUM_MEMBER,
	/** Static value */
	STATIC_VALUE,
	/** Validator class using "ValidatorsOf<T>" */
	VALIDATOR_CLASS,
	/** Resolver class using "ResolversOf<T>" */
	RESOLVER_CLASS,
}