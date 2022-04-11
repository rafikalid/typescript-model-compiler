import { getNodePath } from "@utils/node-path";
import ts from "typescript";
import { getImplementedEntities, HelperClass } from "./class-implemented-entities";
import { isAsync } from "./is-async";
import { Kind } from "./kind";
import { Annotation, MethodNode, Node, ObjectNode, ResolverClassNode, RootNode, ValidatorClassNode } from "./model";
import { resolveParams } from "./resolve-params";

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
	const IGNORED_ENTITIES: Map<string, IgnoredEntity[]> = new Map();
	const INPUT_ENTITIES: Map<string, RootNode> = new Map();
	const OUTPUT_ENTITIES: Map<string, RootNode> = new Map();
	const RESOLVERS: ResolverClassNode[] = [];
	const VALIDATORS: ValidatorClassNode[] = [];
	//* Prepare queue
	const Q: QueueItem[] = [];
	for (let i = 0, len = files.length; i < len; ++i) {
		let srcFile = program.getSourceFile(files[i]);
		if (srcFile == null) throw new Error(`File included in pattern but not in your files to compile: ${files[i]}`);
		_queueChildren(true, srcFile); // Read as input entities
		_queueChildren(false, srcFile);// Read as output entities
	}
	//* Iterate over all nodes
	const errors: string[] = [];
	rootLoop: for (let Qi = 0; Qi < Q.length; ++Qi) {
		try {
			//* Get next item
			const QItem = Q[Qi];
			const { tsNode, parentNode, tsNodeType, isInput, isImplementation, entityName } = QItem;
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
					switch (tag.name) {
						case 'ignore':
							continue rootLoop;
						case 'input':
							if (!isInput) continue rootLoop;
							break;
						case 'output':
							if (isInput) continue rootLoop;
							break;
					}
					// Save tag
					const tags = jsDocTags.get(tag.name);
					if (tags == null) jsDocTags.set(tag.name, [tagText]);
					else tags.push(tag.name);
				}
			}
			//* Parse decorators
			const annotations: Annotation[] = [];
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
						_ignoreEntity(entityName, 'export', tsNode);
						continue rootLoop;
					}
					//* Get implemented or inherited entities
					const implemented = getImplementedEntities(typeChecker, entityNode, _getNodeName);
					let entity: Node | undefined;
					let isImplementation: boolean; // If is @entity or @resolver or validators
					switch (implemented.type) {
						case HelperClass.ENTITY:
							// Check if has @entity jsDoc tag
							if (jsDocTags == null) {
								_ignoreEntity(entityName, '@entity', tsNode);
								continue rootLoop;
							}
							else if (jsDocTags.has('resolvers')) {
								isImplementation = true; // If methods are resolvers or entity methods
								if (jsDocTags.has('entity'))
									throw `@entity and @resolvers are exclusive. at ${getNodePath(tsNode)}`;
							}
							else if (jsDocTags.has('entity')) {
								isImplementation = false;
							} else {
								_ignoreEntity(entityName, '@entity', tsNode);
								continue rootLoop;
							}
							// Create entity
							const targetMap = isInput ? INPUT_ENTITIES : OUTPUT_ENTITIES;
							entity = targetMap.get(entityName);
							if (entity == null) {
								entity = {
									kind: Kind.OBJECT,
									isInput,
									name: entityName,
									annotations,
									fields: new Map(),
									inherit: implemented.entities,
									isClass,
									jsDoc,
									jsDocTags,
									tsNodes: [entityNode]
								};
								targetMap.set(entityName, entity);
							} else if (entity.kind !== Kind.OBJECT) {
								throw new Error(`Duplicated entity ${entityName} as Object and ${Kind[entity.kind]} at ${getNodePath(entityNode)} and ${getNodePath(entity.tsNodes)}`);
							} else {
								entity.annotations.push(...annotations);
								entity.jsDoc.push(...jsDoc);
								entity.inherit.push(...implemented.entities);
								entity.tsNodes.push(entityNode);
								_mergeJsDocTags(entity.jsDocTags, jsDocTags);
							}
							break;
						case HelperClass.RESOLVERS:
							// Check jsDoc annotations
							if (jsDocTags != null) {
								if (jsDocTags.has('input')) throw `Could not use "@input" with "resolversOf" at: ${getNodePath(entityNode)}`;
								if (jsDocTags.has('entity')) throw `Could not use "@entity" with "resolversOf" at: ${getNodePath(entityNode)}`;
							}
							if (isInput) continue rootLoop;
							//Entity
							entity = {
								kind: Kind.RESOLVER_CLASS,
								name: entityName,
								isInput,
								jsDoc,
								jsDocTags,
								tsNodes: [entityNode],
								entities: implemented.entities,
								annotations,
								fields: new Map()
							};
							RESOLVERS.push(entity);
							isImplementation = true;
							break;
						case HelperClass.VALIDATORS:
							// Check jsDoc annotations
							if (jsDocTags != null) {
								if (jsDocTags.has('output')) throw `Could not use "@output" with "validatorsOf" at: ${getNodePath(entityNode)}`;
								if (jsDocTags.has('entity')) throw `Could not use "@entity" with "validatorsOf" at: ${getNodePath(entityNode)}`;
							}
							if (!isInput) continue rootLoop;
							//Entity
							entity = {
								kind: Kind.VALIDATOR_CLASS,
								name: entityName,
								isInput,
								jsDoc,
								jsDocTags,
								tsNodes: [entityNode],
								entities: implemented.entities,
								annotations,
								fields: new Map()
							};
							VALIDATORS.push(entity);
							isImplementation = true;
							break;
						default: {
							let n: never = implemented.type;
							continue rootLoop;
						}
					}
					//* Go through properties
					for (let i = 0, props = tsNodeType.getProperties(), len = props.length; i < len; ++i) {
						let s = props[i];
						let dec = s.valueDeclaration ?? s.declarations?.[0];
						if (dec == null) continue;
						let propType = typeChecker.getTypeOfSymbolAtLocation(s, entityNode);
						Q.push({
							isInput,
							tsNode: dec,
							tsNodeType: propType,
							entityName: s.name,
							parentNode: entity,
							tsNodeSymbol: s,
							isImplementation
						});
					}
					break;
				}
				case ts.SyntaxKind.PropertySignature:
				case ts.SyntaxKind.MethodDeclaration:
				case ts.SyntaxKind.PropertyDeclaration: {
					if (parentNode == null) continue rootLoop;
					if (
						parentNode.kind != Kind.OBJECT &&
						parentNode.kind != Kind.VALIDATOR_CLASS &&
						parentNode.kind != Kind.RESOLVER_CLASS
					)
						throw `Unexpected parent node "${Kind[parentNode.kind]}" for property at ${getNodePath(tsNode)}`;
					if (entityName == null)
						throw `Missing name for property at ${getNodePath(tsNode)}`;
					const propertyNode = tsNode as ts.PropertySignature | ts.MethodDeclaration | ts.PropertyDeclaration;
					const className = (propertyNode.parent as ts.ClassLikeDeclaration).name?.getText();
					//* Method
					let method: MethodNode | undefined;
					const isMethod = tsNode.kind === ts.SyntaxKind.MethodDeclaration;
					if (isMethod) {
						// Ignore if is entity (not implementation)
						if (!isImplementation) continue rootLoop;
						if (className == null) throw `Unexpected anonymous class for method implementation at ${getNodePath(tsNode)}`;
						const tsMethod = tsNode as ts.MethodDeclaration;
						method = {
							kind: Kind.METHOD,
							class: className,
							name: entityName,
							isAsync: isAsync(typeChecker, tsMethod),
							isStatic: tsNode.modifiers?.some(n => n.kind === ts.SyntaxKind.StaticKeyword) ?? false,
							params: tsMethod.parameters == null ? [] : resolveParams(typeChecker, tsMethod.parameters), //TODO
							tsNode: tsMethod
						};
					}
					// Add field
					let field = parentNode.fields.get(entityName);
					if (field == null) { } else {
						field.annotations.push(...annotations);
						field.jsDoc.push(...jsDoc);
						field.tsNodes.push(tsNode);
						if (jsDocTags != null) {
							if (field.jsDocTags == null) field.jsDocTags = jsDocTags;
							else _mergeJsDocTags(field.jsDocTags, jsDocTags);
						}
					}
					break;
				}
				case ts.SyntaxKind.SyntaxList:
				case ts.SyntaxKind.ModuleDeclaration:
				case ts.SyntaxKind.ModuleBlock:
					_queueChildren(isInput, tsNode, parentNode);
					break;
				case ts.SyntaxKind.TupleType:
					throw `Tuples are not supported, did you mean Array of type? at ${getNodePath(tsNode)}`;
				case ts.SyntaxKind.TypeOperator: {
					console.log('FOUND typeOperator: ', _getNodeName(tsNode), '>>', getNodePath(tsNode));
					//FIXME Check what TypeOperatorNode do!
					// let tp = (node as ts.TypeOperatorNode).type;
					// visitor.push(tp, typeChecker.getTypeAtLocation(tp), pDesc, srcFile, isInput);
					break;
				}
			}
		} catch (err) {
			if (typeof err === 'string') errors.push(err);
			else throw err;
		}
	}
	//* Throw errors if found
	if (errors.length) throw new Error(`Parsing Errors: \n\t - ${errors.join('\n\t- ')} `);

	//* Add default scalars
	//TODO
	//* Add helpers
	//TODO
	//* Add nameless entities
	//TODO
	//* Return
	return {
		input: INPUT_ENTITIES,
		output: OUTPUT_ENTITIES,
		ignored: IGNORED_ENTITIES
	}

	/** @private Add all children to queue */
	function _queueChildren(isInput: boolean, tsNode: ts.Node, parentNode?: Node, entityName?: string) {
		for (let i = 0, children = tsNode.getChildren(), len = children.length; i < len; ++i) {
			const child = children[i];
			Q.push({
				isInput,
				isImplementation: false,
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

	/** @private add missing entity */
	function _ignoreEntity(name: string, missing: 'export' | '@entity', tsNode: ts.Node) {
		const info: IgnoredEntity = { tsNode, missing };
		const v = IGNORED_ENTITIES.get(name);
		if (v == null) IGNORED_ENTITIES.set(name, [info]);
		else v.push(info);
	}
}

/**
 * Queue
 */
interface QueueItem {
	/** Is input field */
	isInput: boolean
	/** if methods are "resolvers", "validators" or ignore them (entity methods for internal use) */
	isImplementation: boolean,
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
	/** Ignored due to missing export keyword or @entity jsDoc tag */
	missing: 'export' | '@entity'
}

/** Get node name signature */
export type GetNodeNameSignature = (node: ts.Node) => string


//* Merge jsDoc tags
function _mergeJsDocTags(target: Map<string, (string | undefined)[]>, src: Map<string, (string | undefined)[]>) {
	src.forEach(function (value, key) {
		const v = target.get(key);
		if (v == null) target.set(key, value);
		else v.push(...value);
	});
}
