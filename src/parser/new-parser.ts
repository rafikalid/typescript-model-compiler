import { E, errorFile, TError } from "@src/utils/error";
import { warn } from "@src/utils/log";
import ts from "typescript";
import { AssertOptions, BasicScalar, Enum, EnumMember, InputField, Kind, List, MethodDescriptor, Node, OutputField, Param, Reference, Scalar, Union, InputNode, InputObject, OutputObject, OutputNode, AllNodes } from './model';
import { NodeVisitor } from "./visitor";
import Yaml from 'yaml';
const parseYaml = Yaml.parse;
//@ts-ignore
import { Converter, DEFAULT_SCALARS, ResolverConfig, RootConfig as RootConfigTTModel } from "tt-model";
import { MethodDescM, RootConfig } from "..";


/**
 * This parser will both parse and insert modifications
 * like "MarcoAnnotations"
 */
export function parseAndUpdate(
	/** Root file mapping */
	filesMap: Map<string, ts.SourceFile>,
	/** Target files to parse */
	targetFiles: readonly string[],
	/** Program */
	program: ts.Program
) {
	//* Init
	const INPUT_ENTITIES: Map<string, InputNode> = new Map();
	const OUTPUT_ENTITIES: Map<string, OutputNode> = new Map();
	//* Literal objects had no with missing name like Literal objects
	const LITERAL_OBJECTS: { node: InputObject | OutputObject, isInput: boolean | undefined, ref: Reference }[] = [];
	/** Root wrappers: wrap root controller */
	const rootConfig: RootConfig = {
		before: [],
		after: [],
		wrappers: []
	};
	/** Helper entities */
	const inputHelperEntities: Map<string, InputObject[]> = new Map();
	const outputHelperEntities: Map<string, OutputObject[]> = new Map();
	/** Print Node Names */
	const tsNodePrinter = ts.createPrinter({
		omitTrailingSemicolon: false,
		removeComments: true
	});
	/** Node Factory */
	const factory = ts.factory;
	/** Type Checker */
	const typeChecker = program.getTypeChecker();
	/** Parsing Errors */
	const errors: string[] = [];
	/** Parse each file */
	for (let i = 0, len = targetFiles.length; i < len; ++i) {
		let filePath = targetFiles[i];
		let isToCompile = true;
		let file = filesMap.get(filePath);
		if (file == null) {
			file = program.getSourceFile(filePath);
			isToCompile = false;
		}
		let resultFile = _transform(file);
		if (file != resultFile) {
			if (isToCompile) filesMap.set(filePath, resultFile);
			else errors.push(`File missing from your compile list: ${filePath}`);
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
			escapedName: escapeEntityName(fieldName),
			deprecated: undefined,
			fileNames: [],
			jsDoc: []
		};
		let entity = INPUT_ENTITIES.get(fieldName);
		if (entity == null || entity.kind === Kind.UNION) {
			INPUT_ENTITIES.set(fieldName, scalarNode);
			OUTPUT_ENTITIES.set(fieldName, scalarNode);
		}
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
		(targetMap as Map<string, InputObject | OutputObject>).set(itemName, node);
	}
	//* Make Entities Escaped Names Unique
	let nmSet = new Set<string>();
	OUTPUT_ENTITIES.forEach((entity) => {
		let escName = entity.escapedName;
		if (escName != null) {
			if (entity.kind === Kind.OUTPUT_OBJECT && nmSet.has(escName)) {
				let i = 0, escName2 = escName;
				while (nmSet.has(escName)) {
					escName = `${escName2}_${++i}`;
				}
				entity.escapedName = escName;
			}
			nmSet.add(escName);
		}
		//* List full inheritance list
		if (entity.kind === Kind.OUTPUT_OBJECT) _adjustInheritance(entity, OUTPUT_ENTITIES);
	});
	INPUT_ENTITIES.forEach((entity) => {
		let escName = entity.escapedName;
		if (escName != null) {
			if (entity.kind === Kind.INPUT_OBJECT && nmSet.has(escName)) {
				escName += 'Input';
				let i = 0, escName2 = escName;
				while (nmSet.has(escName)) {
					escName = `${escName2}_${++i}`;
				}
				entity.escapedName = escName;
			}
			nmSet.add(escName);
		}
		//* List full inheritance list
		if (entity.kind === Kind.INPUT_OBJECT) _adjustInheritance(entity, INPUT_ENTITIES);
	});
	//* Return
	return {
		input: INPUT_ENTITIES,
		output: OUTPUT_ENTITIES,
		rootConfig,
		inputHelperEntities: _mergeEntityHelpers(inputHelperEntities),
		outputHelperEntities: _mergeEntityHelpers(outputHelperEntities)
	};
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
function _evaluateString(str: string): Record<string, string> {
	let obj = parseYaml(str);
	for (let k in obj) {
		if (!ASSERT_KEYS.has(k)) {
			if (k.includes(':')) throw `Missing space after symbol ":" on: "${k}"`;
			throw `Unknown assert's key "${k}"`;
		}
		if (typeof obj[k] !== 'string') obj[k] = String(obj[k]);
		// let v = obj[k];
		// if (typeof v === 'number') { }
		// else if (typeof v === 'string')
		// 	obj[k] = _parseStringValue(v);
		// else throw 0;
	}
	return obj;
}

// function _parseStringValue(v: string): number {
// 	v = v.trim();
// 	var result: number;
// 	// Check for bytes
// 	let b = /(.*?)([kmgtp]?b)$/i.exec(v);
// 	if (b == null) {
// 		result = strMath(v)
// 	} else {
// 		result = bytes(strMath(b[1]) + b[2]);
// 	}
// 	return result;
// }

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


/** Merge helpers */
function _mergeEntityHelpers<T extends InputObject | OutputObject>(entities: Map<string, T[]>) {
	const result: Map<string, T> = new Map();
	entities.forEach((arr, name) => {
		const obj = arr[0];
		obj.wrappers ??= [];
		for (let i = 1, len = arr.length; i < len; ++i) {
			let node = arr[i];
			obj.escapedName ??= node.escapedName;
			// Inheritance
			if (obj.inherit == null) obj.inherit = node.inherit;
			else if (node.inherit != null) obj.inherit.push(...node.inherit);
			// before & after
			if (node.wrappers != null) obj.wrappers.push(...node.wrappers);
			// Fields
			node.fields.forEach((field, fieldName) => {
				let objField = obj.fields.get(fieldName);
				if (objField == null) (obj.fields as Map<string, OutputField | InputField>).set(fieldName, field);
				else {
					objField.alias ??= field.alias;
					objField.defaultValue ??= field.defaultValue;

					if (objField.kind === Kind.INPUT_FIELD) {
						objField.asserts ??= (field as InputField).asserts;
						if ((field as InputField).pipe.length) {
							objField.pipe.push(...(field as InputField).pipe);
							objField.type = field.type;
						}
					} else {
						if (objField.method == null) {
							objField.method = (field as OutputField).method;
							objField.type = field.type;
							objField.param = (field as OutputField).param;
						}
					}
				}
			});
		}
		result.set(name, obj);
	});
	return result;
}

/** Escape entity name */
export function escapeEntityName(name: string) {
	return name.replace(/^\W+|\W+$/g, '').replace(/\W+/g, '_');
}

/** Adjust inheritance list */
function _adjustInheritance(entity: InputObject | OutputObject, mp: Map<string, InputNode | OutputObject>) {
	if (entity.inherit != null) {
		for (let i = 0, lst = entity.inherit; i < lst.length; i++) {
			let clz = lst[i];
			let e = mp.get(clz);
			let l = (e as InputObject | undefined)?.inherit;
			if (l != null) {
				for (let j = 0, len = l.length; j < len; ++j) {
					let c = l[j];
					if (lst.includes(c) === false) lst.push(c);
				}
			}
		}
	}
}
/** Remove "null" and "undefined" */
function _rmNull(type: ts.TypeNode | undefined): ts.TypeNode | undefined {
	if (type != null && ts.isUnionTypeNode(type)) {
		let result: ts.TypeNode | undefined;
		for (let i = 0, types = type.types, len = types.length; i < len; ++i) {
			let tp = types[i];
			let tpN = tp.getText();
			if (tpN !== 'undefined' && tpN !== 'null') {
				if (result == null) result = tp;
				else throw `Expected only one type for node: < ${type.getText()} > at ${errorFile(type.getSourceFile(), type)}`
			}
		}
		type = result;
	}
	return type;
}
