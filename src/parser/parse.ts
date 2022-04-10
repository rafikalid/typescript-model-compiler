import { getNodePath } from "@utils/node-path";
import ts from "typescript";
import { getImplementedEntities, HelperClass } from "./class-implemented-entities";
import { Node } from "./model";

/** 
 * Parse schema
 */
export function parseSchema(program: ts.Program, files: readonly string[]) {
	//* Prepare
	const typeChecker = program.getTypeChecker();
	const tsNodePrinter = ts.createPrinter({
		omitTrailingSemicolon: false,
		removeComments: true
	});
	//* Store values
	const IGNORED_ENTITIES: IgnoredEntity[] = [];
	//* Prepare queue
	const Q: QueueItem[] = [];
	for (let i = 0, len = files.length; i < len; ++i) {
		let srcFile = program.getSourceFile(files[i]);
		if (srcFile == null) throw new Error(`File included in pattern but not in your files to compile: ${files[i]}`);
		_queueChildren(srcFile);
	}
	//* Iterate over all nodes
	const errors: string[] = [];
	rootLoop: for (let Qi = 0; Qi < Q.length; ++Qi) {
		try {
			//* Get next item
			const QItem = Q[Qi];
			const { tsNode, parentNode, tsNodeType } = QItem;
			const tsNodeSymbol = QItem.tsNodeSymbol ?? tsNodeType.symbol;
			//* Parse jsDoc
			const jsDoc: string[] = tsNodeSymbol?.getDocumentationComment(typeChecker).map(e => e.text) ?? [];
			let jsDocTags: Map<string, (string | undefined)[]> | undefined; // Map<annotationName, annotationValue>
			const foundJsDocTags = tsNodeSymbol?.getJsDocTags();
			if (foundJsDocTags != null && foundJsDocTags.length > 0) {
				jsDocTags = new Map();
				for (let i = 0, len = foundJsDocTags.length; i < len; ++i) {
					const tag = foundJsDocTags[i];
					const tagText = tag.text?.map(c => c.text).join("\n").trim();
					// Ignore
					if (tag.name === 'ignore') continue rootLoop;
					const tags = jsDocTags.get(tag.name);
					if (tags == null) jsDocTags.set(tag.name, [tagText]);
					else tags.push(tag.name);
				}
			}
			//* Parse decorators
			//TODO parse decorators
			//TODO ignore if @ignore found
			//* Parse node
			switch (tsNode.kind) {
				case ts.SyntaxKind.InterfaceDeclaration:
				case ts.SyntaxKind.ClassDeclaration: {
					const entityNode = tsNode as ts.ClassDeclaration | ts.InterfaceDeclaration;
					const isClass = tsNode.kind === ts.SyntaxKind.ClassDeclaration;
					//* Ignore generic interfaces and classes
					if (entityNode.typeParameters != null) continue rootLoop;
					//* Get entity name
					const entityName = entityNode.name?.getText();
					if (entityName == null) throw `Unexpected anonymous ${isClass ? 'class' : 'interface'} at ${getNodePath(entityNode)}`;
					//* Check has export keyword
					const hasExportKeyword = tsNode.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
					if (!hasExportKeyword) {
						IGNORED_ENTITIES.push({ tsNode, name: entityName, missing: 'export' });
						continue rootLoop;
					}
					//* Get implemented or inherited entities
					const implemented = getImplementedEntities(typeChecker, entityNode, _getNodeName);
					switch (implemented.type) {
						case HelperClass.ENTITY:
							// Check if has @entity jsDoc tag
							if (!jsDocTags?.has('entity')) {
								IGNORED_ENTITIES.push({ tsNode, name: entityName, missing: "@entity" });
								continue rootLoop;
							}
							//TODO here ---
							break;
						case HelperClass.RESOLVERS:
							// Check jsDoc annotations
							if (jsDocTags != null) {
								if (jsDocTags.has('entity')) throw `Could not use "@entity" with "resolversOf" at: ${getNodePath(entityNode)}`;
								if (jsDocTags.has('input')) throw `Could not use "@input" with "resolversOf" at: ${getNodePath(entityNode)}`;
							}
							//TODO here ---
							break;
						case HelperClass.VALIDATORS:
							// Check jsDoc annotations
							if (jsDocTags != null) {
								if (jsDocTags.has('entity')) throw `Could not use "@entity" with "validatorsOf" at: ${getNodePath(entityNode)}`;
								if (jsDocTags.has('input')) throw `Could not use "@output" with "validatorsOf" at: ${getNodePath(entityNode)}`;
							}
							//TODO here ---
							break;
						default: {
							let n: never = implemented.type;
						}
					}
				}
			}

		} catch (err) {
			if (typeof err === 'string') errors.push(err);
			else throw err;
		}
	}
	//* Throw errors if found
	if (errors.length) throw new Error(`Parsing Errors: \n\t - ${errors.join('\n\t- ')} `);

	/** @private Add all children to queue */
	function _queueChildren(tsNode: ts.Node, parentNode?: Node, entityName?: string) {
		for (let i = 0, children = tsNode.getChildren(), len = children.length; i < len; ++i) {
			const child = children[i];
			Q.push({
				tsNode: child,
				parentNode,
				tsNodeType: typeChecker.getTypeAtLocation(child),
				entityName
			});
		}
	}

	/** @private get node name */
	function _getNodeName(tsNode: ts.Node): string {
		return tsNodePrinter.printNode(ts.EmitHint.Unspecified, tsNode, tsNode.getSourceFile());
	}
}

/**
 * Queue
 */
interface QueueItem {
	/** parent node */
	parentNode?: Node
	/** Typescript node */
	tsNode: ts.Node
	/** Node type */
	tsNodeType: ts.Type
	/** Node symbol: useful for generics */
	tsNodeSymbol?: ts.Symbol
	/** Entity name: use for nameless objects */
	entityName?: string
}

/** Ignored entities */
export interface IgnoredEntity {
	tsNode: ts.Node,
	name: string | undefined
	/** Ignored due to missing export keyword or @entity jsDoc tag */
	missing: 'export' | '@entity'
}

/** Get node name signature */
export type GetNodeNameSignature = (node: ts.Node) => string