import type { InputResolver } from "@src/parser/interfaces";
import type { ModelKind } from "@src/parser/model";

export type GqlNode=  GqlObjectNode | GqlListNode;
/** Graphql validation plain object */
export interface GqlObjectNode{
	kind:	ModelKind.PLAIN_OBJECT
	fields: GqlField[]
}

/** Graphql validation field */
export interface GqlField{
	name:		string
	kind:		ModelKind.INPUT_FIELD
	type?:		GqlNode
	/** Input validator */
	input?:		InputResolver<unknown, unknown>
	/** Asserts */
	assert?:	(value: unknown)=> unknown
}

/** List */
export interface GqlListNode{
	kind: ModelKind.LIST
	/** items type */
	type: GqlNode
	/** Input validator */
	input?:		InputResolver<unknown, unknown>
	/** Asserts */
	assert?:	(value: unknown)=> unknown
}