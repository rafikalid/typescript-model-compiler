//** PARSE TYPESCRIPT DATA

import { E, errorFile, TError } from "@src/utils/error";
import { info, warn } from "@src/utils/log";
import ts from "typescript";
import { Kind, Node, PlainObject, Reference } from "./model";
import { NodeVisitor } from "./visitor";

/**
 * Extract Model from typescript code
 */
export function parse(files: string[], program: ts.Program): Map<string, Node> {
	info('>> Parsing...');
	const ROOT: Map<string, Node> = new Map();
	/** Entities with missing name like Literal objects */
	const namelessEntities: NamelessEntity[] = [];
	/** Parsing Errors */
	const errors: string[] = [];
	const typeChecker = program.getTypeChecker();
	const visitor = new NodeVisitor();
	//* Pase file and put root children into visitor's queue
	for (let i = 0, len = files.length; i < len; ++i) {
		let srcFile = program.getSourceFile(files[i])!;
		visitor.push(srcFile.getChildren(), undefined, true, srcFile, undefined);
	}
	//* Iterate over all nodes
	const it = visitor.it();
	rootLoop: while (true) {
		try {
			//* Get next item
			let item = it.next();
			if (item.done) break;
			let { node, parentDescriptor: pDesc, expectExport, srcFile, isInput, entityName } = item.value;
			let nodeType = typeChecker.getTypeAtLocation(node);
			let nodeSymbol = nodeType.symbol;
			//* Check for export keyword
			if (expectExport && !node.modifiers?.some(e => e.kind === ts.SyntaxKind.ExportKeyword)) {
				warn(`Missing "export" keyword on ${ts.SyntaxKind[node.kind]} at ${errorFile(srcFile, node)}`);
				continue rootLoop;
			}
			//* Extract jsDoc && Metadata
			let asserts: string[] | undefined;
			let deprecated: string | undefined;
			let defaultValue: string | undefined;
			let fieldAlias: string | undefined;
			let jsDocTags = ts.getJSDocTags(node);
			let jsDoc: string[] =
				nodeSymbol
					?.getDocumentationComment(typeChecker)
					.map(e => e.text) ?? [
					(
						node
							.getChildren()
							.find(
								e => e.kind === ts.SyntaxKind.JSDocComment
							) as ts.JSDoc
					)?.comment
				] ??
				[];
			// Parse JsDocTags
			if (jsDocTags.length) {
				for (let i = 0, len = jsDocTags.length; i < len; ++i) {
					let tag = jsDocTags[i];
					jsDoc.push(tag.getText());
					let tagName = tag.tagName.getText();
					let tagText: any;
					switch (tagName) {
						case 'ignore':
						case 'virtual':
							// Ignore this Node
							continue rootLoop;
						case 'deprecated':
							tagText = tag.comment;
							if (tagText == null) deprecated = '';
							else {
								if (Array.isArray(tagText))
									tagText = tagText
										.map((l: ts.JSDocText) => l.text)
										.join('\n');
								deprecated = tagText.toString();
							}
							break;
						case 'assert':
							tagText = tag.comment;
							if (tagText != null) {
								if (Array.isArray(tagText))
									tagText = tagText
										.map((l: ts.JSDocText) => l.text)
										.join(', ');
								// FIXME check using multiple lines for jsdoc tag
								if (tagText) {
									tagText = tagText.trim();
									if (!tagText.startsWith('{'))
										tagText = `{${tagText}}`;
									(asserts ??= []).push(tagText);
								}
							}
							break;
						case 'default':
							if (Array.isArray(tag.comment)) {
								defaultValue = (tag.comment[0] as ts.JSDocText)
									.text;
							}
							break;
						case 'input':
							isInput = true;
							break;
						case 'output':
							isInput = false;
							break;
						case 'alias':
							if (typeof tag.comment === 'string')
								fieldAlias = tag.comment.trim().split(/\s/, 1)[0];
							break;
					}
				}
			}
			// ADD decorators as part of description
			node.decorators?.forEach(function (deco) {
				jsDoc.push(deco.getText());
			});
			//* Parse Node Specific Info
			switch (node.kind) {
				case ts.SyntaxKind.InterfaceDeclaration:
				case ts.SyntaxKind.ClassDeclaration: {
					//* Get entity name
					let entity = node as ts.ClassDeclaration;
					let realNodeName = entity.name?.getText();
					entityName ??= realNodeName;
					if (entityName == null)
						throw `Missing entity name at: ${errorFile(srcFile, node)}`;
					//* Check if this class resolves methods from an other entity
					let targetEntities: string[] = [];
					let inherited: Reference[] | undefined;
					if (entity.heritageClauses == null) {
						isInput = undefined;
					} else {
						let isInterface = ts.isInterfaceDeclaration(node);
						for (let i = 0, clauses = entity.heritageClauses, len = clauses.length; i < len; ++i) {
							for (let j = 0, types = clauses[i].types, jLen = types.length; j < jLen; ++j) {
								let type = types[j];
								// Check for "ResolverOutputConfig" && "ResolverInputConfig"
								let typeSymbol = typeChecker.getSymbolAtLocation(type.expression);
								if (typeSymbol == null || typeSymbol.name == null)
									throw `Could not resolve type "${type.expression.getText()}" at ${errorFile(srcFile, type)}`;
								switch (typeSymbol.name) {
									case 'ResolverInputConfig':
									case 'ResolverOutputMethod':
										{
											if (isInterface)
												throw `An interface could not extends "${typeSymbol.name}". at ${errorFile(srcFile, type)}`;
											let isResolverOutputMethod = typeSymbol.name === 'ResolverOutputMethod';
											if (isInput === isResolverOutputMethod)
												throw `Could not implement "${typeSymbol.name}" for ${isResolverOutputMethod ? 'output' : 'input'} only entities. at ${errorFile(srcFile, type)}`;
											let t = type.typeArguments![0];
											if (!ts.isTypeReferenceNode(t) || !typeChecker.getTypeFromTypeNode(t).isClassOrInterface())
												throw `Expected "ResolverInputConfig" argument to reference a "class" or "interface" at ${errorFile(srcFile, t)}`;
											let typeName = typeChecker.getSymbolAtLocation(t.typeName)!.name;
											targetEntities.push(typeName);
											isInput = !isResolverOutputMethod;
											// Add to JsDoc
											jsDoc.push(
												isResolverOutputMethod ? `@ResolversAt ${realNodeName}` : `@InputResolversAt ${realNodeName}`
											);
										}
										break;
									default:
										{
											let nRef: Reference = {
												kind: Kind.REF,
												fileName: srcFile.fileName,
												name: typeSymbol.name,
												oName: typeSymbol.name,
												fullName: undefined,
												params:
													type.typeArguments == null
														? undefined
														: [],
												visibleFields: undefined
											};
											visitor.push(type.typeArguments, nRef, false, srcFile);
											(inherited ??= []).push(nRef);
											//TODO resolve real nodes names
											jsDoc.push(`@Extends ${type.getText()}`);
										}
								}
							}
						}
					}
					if (targetEntities.length === 0) targetEntities.push(entityName);
					//* Visible fields
					let visibleFields = _getRefVisibleFields(node, typeChecker);
					//* Add entity
					for (let i = 0, len = targetEntities.length; i < len; ++i) {
						let entityName = targetEntities[i]
						let entityDesc = ROOT.get(entityName);
						if (entityDesc == null) {
							// Add Generic params
							let generics: string[] | undefined; // TODO generate generics using References
							let tpParams = entity.typeParameters;
							if (tpParams != null) {
								generics = [];
								for (let i = 0, len = tpParams.length; i < len; ++i) {
									generics.push(tpParams[i].name.getText());
								}
							}
							// Entity
							let entityD: PlainObject = {
								kind: Kind.PLAIN_OBJECT,
								name: entityName,
								escapedName: entityName, // TODO check this
								deprecated: deprecated,
								fileNames: [srcFile.fileName],
								inherit: inherited,
								generics: generics,
								input: {
									before: undefined,
									after: undefined,
									ownedFields: 0,
									fields: new Map(),
									visibleFields: visibleFields,
									jsDoc: jsDoc
								},
								output: {
									before: undefined,
									after: undefined,
									ownedFields: 0,
									fields: new Map(),
									visibleFields: new Map(visibleFields),
									jsDoc: jsDoc.slice(0)
								}
							}
							entityDesc = entityD;
							ROOT.set(entityName, entityDesc);
						} else if (entityDesc.kind === Kind.SCALAR) {
							// Do nothing, just keep entity as scalar
							break;
						} else if (entityDesc.kind !== Kind.PLAIN_OBJECT) {
							throw new Error(
								`Entity "${entityName}" has multiple types:\n\t> PLAIN_OBJECT at : ${srcFile.fileName}\n\t> ${Kind[entityDesc.kind]} at ${entityDesc.fileNames.join(', ')}`
							);
						} else {
							if (inherited != null)
								(entityDesc.inherit ??= []).push(...inherited);
							entityDesc.deprecated ??= deprecated;
							// as input only
							if (isInput !== false) {
								let inputObj = (entityDesc as PlainObject).input;
								visibleFields.forEach((v, k) => {
									inputObj.visibleFields.set(k, v);
								});
								// JsDoc
								inputObj.jsDoc.push(...jsDoc);
							}
							// as output only
							if (isInput !== true) {
								let outputObj = (entityDesc as PlainObject).output
								visibleFields.forEach((v, k) => {
									outputObj.visibleFields.set(k, v);
								});
								// JsDoc
								outputObj.jsDoc.push(...jsDoc);
							}
						}
					}
					break;
				}
			}
		} catch (error: any) {
			if (typeof error === 'string') errors.push(error);
			else throw error;
		}
	}

	//* Throw warnings if found
	if (errors.length) throw new TError(E.PARSING_ERRORS, `Parsing Errors: \n\t - ${errors.join('\n\t- ')} `);
	return ROOT;
}

/** Nameless entities */
interface NamelessEntity {
	/** Hint name or prefix */
	name: string | undefined;
	/** Target entity */
	node: Node;
	/** Target reference */
	ref: Reference;
}

/** Load reference visible fields */
function _getRefVisibleFields(r: ts.Node, typeChecker: ts.TypeChecker) {
	var visibleFields: Map<
		string,
		{
			flags: ts.SymbolFlags;
			className: string;
		}
	> = new Map();
	for (
		let i = 0,
		props = typeChecker.getTypeAtLocation(r).getProperties(),
		len = props.length;
		i < len;
		++i
	) {
		let s = props[i];
		let clName = (
			(s.valueDeclaration ?? s.declarations?.[0])
				?.parent as ts.ClassDeclaration
		).name?.getText();
		if (clName != null) {
			visibleFields.set(s.name, {
				flags: s.flags,
				className: clName
			});
		}
	}
	return visibleFields;
}
