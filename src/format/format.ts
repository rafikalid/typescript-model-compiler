import { Kind } from "@parser/kind";
import { FieldNode, Node, RootNode } from "@parser/model";
import type { parseSchema } from "@parser/parse";
import ts from "typescript";
import { Compiler } from "..";
import { FormattedField, FormattedRootNode } from "./model";
import { _resolveScalars } from "./resolve-scalars";

/**
 * Format parsed data
 */
export function format(compiler: Compiler, compilerOptions: ts.CompilerOptions, data: ReturnType<typeof parseSchema>) {
	return {
		input: _format(compiler, compilerOptions, data.input, true),
		output: _format(compiler, compilerOptions, data.output, false)
	};
}

/** Format input entities */
function _format(compiler: Compiler, compilerOptions: ts.CompilerOptions, data: Map<string, RootNode | undefined>, isInput: boolean) {
	//* Resolver scalar parsers
	const scalars = _resolveScalars(compiler, compilerOptions, data);
	const result: Map<string, FormattedRootNode> = new Map();
	//* format entities
	data.forEach(function (entity) {
		if (entity == null) return;
		const entityName = entity.name;
		if (result.has(entityName)) return; // Entity mapped twice
		// Compile jsDoc
		const jsDoc = _compileJsDoc(entity.jsDoc);
		let formattedEntity: FormattedRootNode;
		// Before and after
		const codeBefore: ts.Statement[] = [];
		const codeAfter: ts.Statement[] = [];
		// Add formatted entity
		switch (entity.kind) {
			case Kind.SCALAR:
				formattedEntity = {
					kind: Kind.SCALAR,
					name: entityName,
					jsDoc,
					before: codeBefore,
					after: codeAfter,
					// Fields
					parse: _formatField(entity.fields.get('parse')),
					serialize: _formatField(entity.fields.get('serialize')),
					fromDB: _formatField(entity.fields.get('fromDB')),
					toDB: _formatField(entity.fields.get('toDB')),
					default: _formatField(entity.fields.get('default')),
					defaultOutput: _formatField(entity.fields.get('defaultOutput')),
					mock: _formatField(entity.fields.get('mock'))
				};
				break;
			case Kind.ENUM:
				formattedEntity = {
					kind: Kind.ENUM,
					name: entityName,
					jsDoc,
					before: codeBefore,
					after: codeAfter
				};
				break;
			case Kind.LIST:
				formattedEntity = {
					kind: Kind.LIST,
					name: entityName,
					jsDoc,
					before: codeBefore,
					after: codeAfter
				};
				break;
			case Kind.OBJECT:
				formattedEntity = {
					kind: Kind.OBJECT,
					name: entityName,
					jsDoc,
					before: codeBefore,
					after: codeAfter
				};
				break;
			case Kind.UNION:
				// formattedEntity = {
				// 	kind: Kind.UNION,
				// 	name: entityName,
				// 	jsDoc,
				// 	before: codeBefore,
				// 	after: codeAfter
				// };
				break;
			default: {
				let n: never = entity;
			}
		}
		result.set(entityName, formattedEntity);
	});

	/** Format fields */
	function _formatField(field: FieldNode | undefined): FormattedField | undefined {
		if (field == null) return;
		// TODO add field formatter
	}
}


// /** Sort jsDoc */
// const sortJsDocKeywords = [
// 	'Generic',
// 	'Partial',
// 	'Implements',
// 	'Extends',
// 	'Inherit-from'
// ];
/** Compile jsDoc */
function _compileJsDoc(arr: string[]): string | undefined {
	const result = arr
		.filter((v, i, arr) => i === arr.indexOf(v)) // remove duplications
		.sort((a, b) => {
			if (a.startsWith('@')) {
				if (b.startsWith('@')) {
					let i = a.indexOf(' ');
					const at = i === -1 ? a : a.slice(0, i);
					i = b.indexOf(' ');
					const bt = i === -1 ? b : b.slice(0, i);
					return at.localeCompare(bt);
					// return (
					// 	sortJsDocKeywords.indexOf(at) -
					// 	sortJsDocKeywords.indexOf(bt)
					// );
				} else return 1;
			} else return -1;
		});
	return result.length ? result.join("\n") : undefined;
}