//** PARSE TYPESCRIPT DATA

import { E, errorFile, TError } from "@src/utils/error";
import { warn } from "@src/utils/log";
import ts from "typescript";
import { AssertOptions, BasicScalar, Enum, EnumMember, InputField, Kind, List, MethodDescriptor, Node, OutputField, Param, Reference, Scalar, Union, InputNodes, OutputNodes, InputObject, OutputObject } from './model';
import { NodeVisitor } from "./visitor";
import Yaml from 'yaml';
const parseYaml = Yaml.parse;
//@ts-ignore
import strMath from 'string-math';
import bytes from 'bytes';
import { DEFAULT_SCALARS } from "tt-model";

/**
 * Extract Model from typescript code
 */
export function parse(files: readonly string[], program: ts.Program) {
	//* Init
	const INPUT_ENTITIES: Map<string, InputNodes> = new Map();
	const OUTPUT_ENTITIES: Map<string, OutputNodes> = new Map();
	//* Literal objects had no with missing name like Literal objects
	const LITERAL_OBJECTS: { node: InputObject | OutputObject, isInput: boolean, ref: Reference }[] = [];
	/** Helper entities */
	const HelperEntities: HelperEntity[] = [];
	/** Print Node Names */
	const tsNodePrinter = ts.createPrinter({ omitTrailingSemicolon: false, removeComments: true });
	/** Node Factory */
	const factory = ts.factory;
	/** Type Checker */
	const typeChecker = program.getTypeChecker();
	/** Parsing Errors */
	const errors: string[] = [];
	/** Node Visitor */
	const visitor = new NodeVisitor();
	//* Pase file and put root children into visitor's queue
	for (let i = 0, len = files.length; i < len; ++i) {
		let srcFile = program.getSourceFile(files[i])!;
		for (let j = 0, children = srcFile.getChildren(), jLen = children.length; j < jLen; ++j) {
			let node = children[j];
			visitor.push(node, typeChecker.getTypeAtLocation(node), undefined, srcFile, undefined);
		}
	}
	//* Iterate over all nodes
	const it = visitor.it();
	rootLoop: while (true) {
		try {
			//* Get next item
			let item = it.next();
			if (item.done) break;
			let { node, nodeType, parentDescriptor: pDesc, srcFile, isInput, entityName } = item.value;
			let nodeSymbol = nodeType.symbol;
			let fileName = srcFile.fileName;
			//* Extract jsDoc && Metadata
			let asserts: string[] | undefined;
			let deprecated: string | undefined;
			let defaultValue: any;
			let fieldAlias: string | undefined;
			let jsDocTags = ts.getJSDocTags(node);
			let jsDoc: string[] = nodeSymbol?.getDocumentationComment(typeChecker)
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
									.text.trim();
								if (defaultValue === 'true') defaultValue = true;
								else if (defaultValue === "false") defaultValue = false;
								else {
									try {
										// If fail to convert to number, keep it string
										defaultValue = _parseStringValue(defaultValue);
									} catch (error: any) { }
								}
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
					if (_hasNtExport(node, srcFile)) continue rootLoop; //* Ignore if has no export keyword
					let nodeEntity = node as ts.ClassDeclaration | ts.InterfaceDeclaration;
					//* Check if it is a helper entity (class that implements ResolverOutputConfig or ResolverInputConfig)
					let implementedEntities: string[] | undefined = undefined;
					let inheritedEntities: string[] | undefined = undefined;
					if (nodeEntity.heritageClauses != null) {
						let isInterface = ts.isInterfaceDeclaration(node);
						for (let i = 0, clauses = nodeEntity.heritageClauses, len = clauses.length; i < len; ++i) {
							for (let j = 0, types = clauses[i].types, jLen = types.length; j < jLen; ++j) {
								let type = types[j];
								let typeSymbol = typeChecker.getSymbolAtLocation(type.expression);
								if (typeSymbol == null || typeSymbol.name == null)
									throw `Could not resolve type "${type.expression.getText()}" at ${errorFile(srcFile, type)}`;
								switch (typeSymbol.name) {
									case 'ResolverInputConfig':
									case 'ResolverOutputConfig': {
										let resolverConfig = typeSymbol.name;
										if (isInterface)
											throw `An interface could not extends "${resolverConfig}". at ${errorFile(srcFile, type)}`;
										let isResolverOutputConfig = resolverConfig === 'ResolverOutputConfig';
										if (isInput === isResolverOutputConfig)
											throw `Could not implement "${resolverConfig}" for ${isResolverOutputConfig ? 'output' : 'input'} only entities. at ${errorFile(srcFile, type)}`;
										let t = type.typeArguments![0] as ts.TypeReferenceNode;
										// if (!ts.isTypeReferenceNode(t) || !typeChecker.getTypeFromTypeNode(t).isClassOrInterface())
										// 	throw `Expected "${resolverConfig}" argument to reference a "class" or "interface" at ${errorFile(srcFile, t)}`;
										// let typeName = typeChecker.getSymbolAtLocation(t.typeName)!.name;
										(implementedEntities ??= []).push(_getNodeName(t.typeName, srcFile));
										isInput = !isResolverOutputConfig;
										break;
									}
									default: {
										let refName = _getNodeName(type, srcFile);
										(inheritedEntities ??= []).push(refName);
										//TODO resolve referenced entity
										// let nRef: Reference = {
										// 	kind: Kind.REF,
										// 	fileName: fileName,
										// 	name: typeSymbol.name,
										// 	oName: typeSymbol.name,
										// 	fullName: undefined,
										// 	params:
										// 		type.typeArguments == null
										// 			? undefined
										// 			: [],
										// 	visibleFields: undefined
										// };
										// visitor.push(type.typeArguments, nRef, srcFile);
										// (inherited ??= []).push(nRef);
										// //TODO resolve real nodes names
										// jsDoc.push(`@Extends ${type.getText()}`);
									}
								}
							}
						}
					}
					// Resolve
					if (implementedEntities == null) {
						//* Normal entity
					} else {
						//* Helper entity
						entityName = nodeEntity.name?.getText(); //TODO fix for when using entityConfig
						if (entityName == null) throw `Unexpected anonymous class at ${errorFile(srcFile, node)}`;
						HelperEntities.push({ isInput: isInput!, name: entityName, entities: implementedEntities });
					}
				}
			}
		} catch (error: any) {
			if (typeof error === 'string') errors.push(error);
			else throw error;
		}
	}
	//* Throw errors if found
	if (errors.length) throw new TError(E.PARSING_ERRORS, `Parsing Errors: \n\t - ${errors.join('\n\t- ')} `);
	//* STEP 2: ADD DEFAULT SCALARS
	for (let i = 0, len = DEFAULT_SCALARS.length; i < len; ++i) {
		let fieldName = DEFAULT_SCALARS[i];
		let scalarNode: BasicScalar = {
			kind: Kind.BASIC_SCALAR,
			name: fieldName,
			deprecated: undefined,
			fileNames: [],
			jsDoc: []
		};
		if (!INPUT_ENTITIES.has(fieldName)) INPUT_ENTITIES.set(fieldName, scalarNode);
		if (!OUTPUT_ENTITIES.has(fieldName)) OUTPUT_ENTITIES.set(fieldName, scalarNode);
	}
	//* Resolve nameless entities
	for (
		let i = 0, len = LITERAL_OBJECTS.length, namelessMap: Map<string, number> = new Map(); i < len; ++i
	) {
		let item = LITERAL_OBJECTS[i];
		let node = item.node;
		let itemName = node.name ?? item.isInput ? 'Input' : 'Output';
		let targetMap = item.isInput ? INPUT_ENTITIES : OUTPUT_ENTITIES;
		let tmpN = itemName;
		let itemI = namelessMap.get(tmpN) ?? 0;
		while (targetMap.has(itemName)) {
			++itemI;
			itemName = `${tmpN}_${itemI}`;
		}
		namelessMap.set(tmpN, itemI);
		node.name = itemName;
		item.ref.name = itemName;
		targetMap.set(itemName, node);
	}
	return {
		input: INPUT_ENTITIES,
		output: OUTPUT_ENTITIES
	};

	// TODO
	/** Get entity name */
	function _getNodeName(node: ts.Node, srcFile: ts.SourceFile) {
		tsNodePrinter.printNode(ts.EmitHint.Unspecified, node, srcFile);
	}
}

/** Helper entity interface: enables to add resolvers to other entities fields */
interface HelperEntity {
	/** Class name */
	name: string,
	/** Is input or output */
	isInput: boolean
	/** Target entities */
	entities: string[]
}

function _getRefVisibleFields(nodeType: ts.Type) {
	const nodeSymbol = nodeType.getSymbol();
	if (
		nodeSymbol?.name === 'Promise'
	) {
		console.log('//Goy promise'); //-HERE --------------------
		// return _getRefVisibleFields(nodeType.);
		const visibleFields: Map<string, { flags: ts.SymbolFlags; className: string; }> = new Map();
		return visibleFields;
	} else {
		/** Load reference visible fields */
		const visibleFields: Map<string, { flags: ts.SymbolFlags; className: string; }> = new Map();
		for (let i = 0, props = nodeType.getProperties(), len = props.length; i < len; ++i) {
			let s = props[i];
			let clName = ((s.valueDeclaration ?? s.declarations?.[0])?.parent as ts.ClassDeclaration).name?.getText();
			if (clName != null) {
				visibleFields.set(s.name, {
					flags: s.flags,
					className: clName
				});
			}
		}
		// If union
		if (visibleFields.size === 0 && nodeType.isUnion()) {
			for (let i = 0, types = nodeType.types, len = types.length; i < len; ++i) {
				_getRefVisibleFields(types[i]).forEach((v, k) => {
					visibleFields.set(k, v);
				});
			}
		}
		return visibleFields;
	}
}
function _isFieldRequired(propertyNode: ts.PropertyDeclaration, typeChecker: ts.TypeChecker): boolean {
	if (propertyNode.questionToken) return false;
	// TODO check if this works as expected
	let type = typeChecker.getTypeAtLocation(propertyNode);
	return (type.flags & ts.TypeFlags.Undefined) === 0;
}

/** Compile assert expressions */
function _compileAsserts(
	asserts: string[],
	prevAsserts: AssertOptions | undefined,
	srcFile: ts.SourceFile,
	node: ts.Node
): AssertOptions | undefined {
	try {
		if (asserts.length) {
			prevAsserts = Object.assign(
				prevAsserts ?? {},
				...asserts.map(e => _evaluateString(e))
			);
		}
		return prevAsserts;
	} catch (err: any) {
		if (typeof err === 'string')
			throw `Fail to parse @assert: ${err} At ${errorFile(srcFile, node)}`;
		else
			throw `Fail to parse: @assert ${asserts.join('\n')}: ${err?.message ?? err}\nAt ${errorFile(srcFile, node)}`;
	}
}

// Assert keys
const ASSERT_KEYS_TMP: { [k in keyof AssertOptions]-?: 1 } = {
	min: 1,
	max: 1,
	lt: 1,
	gt: 1,
	lte: 1,
	gte: 1,
	eq: 1,
	ne: 1,
	length: 1,
	regex: 1
};
const ASSERT_KEYS = new Set(Object.keys(ASSERT_KEYS_TMP));

/** Evaluate expression */
function _evaluateString(str: string) {
	let obj = parseYaml(str);
	for (let k in obj) {
		if (!ASSERT_KEYS.has(k)) {
			if (k.includes(':')) throw `Missing space after symbol ":" on: "${k}"`;
			throw `Unknown assert's key "${k}"`;
		}
		let v = obj[k];
		if (typeof v === 'number') { }
		else if (typeof v === 'string')
			obj[k] = _parseStringValue(v);
		else throw 0;
	}
	return obj;
}

function _parseStringValue(v: string): number {
	v = v.trim();
	var result: number;
	// Check for bytes
	let b = /(.*?)([kmgtp]?b)$/i.exec(v);
	if (b == null) {
		result = strMath(v)
	} else {
		result = bytes(strMath(b[1]) + b[2]);
	}
	return result;
}

/** Resolve reference target name */
function _refTargetName(ref: ts.TypeReferenceNode, typeChecker: ts.TypeChecker) {
	let refTypeSymb = typeChecker.getTypeAtLocation(ref.typeName).symbol;
	let refTargetNode =
		refTypeSymb == null
			? undefined
			: refTypeSymb.valueDeclaration ?? refTypeSymb.declarations?.[0];

	let refTextName: string;
	if (refTargetNode == null) refTextName = ref.typeName.getText();
	else {
		// Get parent of enums
		if (ts.isEnumMember(refTargetNode))
			refTargetNode = refTargetNode.parent;
		refTextName =
			(refTargetNode as ts.InterfaceDeclaration).name?.getText() ||
			ref.typeName.getText();
	}
	return refTextName;
}

/** Check for export keyword on a node */
function _hasNtExport(node: ts.Node, srcFile: ts.SourceFile) {
	//* Check for export keyword
	var modifiers = node.modifiers;
	if (modifiers != null) {
		for (let i = 0, len = modifiers.length; i < len; ++i) {
			if (modifiers[i].kind === ts.SyntaxKind.ExportKeyword) return false;
		}
	}
	warn(`Missing "export" keyword on ${ts.SyntaxKind[node.kind]} at ${errorFile(srcFile, node)}`);
	return true;
}