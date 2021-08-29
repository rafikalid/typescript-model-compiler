import ts from "typescript";
// import {readFileSync} from 'fs';
import {join, dirname, relative} from "path";
import { parse as ParseModelFrom } from "./parser";
import { PACKAGE_NAME } from "@src/config";
import { printTree } from "@src/utils/console-print";
import { format } from "@src/formater/formater";
import { info } from "@src/utils/log";
import { toGraphQL } from "@src/graphql/compiler";
import { _errorFile } from "@src/utils/error";

// import { compileGraphQL } from "@src/graphql/compiler";


/** Compile each file */
export function generateModel(filePath: string, fileContent: string, compilerOptions: ts.CompilerOptions, pretty:boolean):string|undefined{
	const f= ts.factory;
	//* Load source file
	var srcFile= ts.createSourceFile(filePath, fileContent, compilerOptions.target ?? ts.ScriptTarget.Latest, true);
	//* check for files with "Model.from('glob-path')"
	const mappedFiles= mapFilesWithModel(srcFile);

	if(!mappedFiles.patterns.size)
		return;
	
	//* Resolve Model for each pattern
	const relativeDirname= relative(process.cwd(), dirname(filePath));
	const mapGqlPatternToNode: Map<string, ts.CallExpression>= new Map();
	const mapFromPatternToNode: Map<string, ts.CallExpression>= new Map();
	const listImports: ts.Statement[]= [];
	info(`Compile File>> ${filePath}`);
	const srcFileDir= dirname(filePath);
	mappedFiles.patterns.forEach(function(p){
		info('COMPILE PATTERN>>', p);
		const pArr= p.slice(1, p.length-1).split(',').map(e=> join(relativeDirname, e.trim()) );
		var root= ParseModelFrom(pArr, compilerOptions);
		// console.log("===ROOT===\n", printTree(root, "\t"));
		// Create graphql object
		info('>> FORMAT DATA');
		var formated= format(root);
		// console.log("===FORMATED ROOT===\n", printTree(formated, '  '));
		if(mappedFiles.toGraphqlPatterns.has(p)){
			info('>> Compile to GraphQL');
			var {imports, node}= toGraphQL(formated, f, pretty, srcFileDir);
			// Map data
			mapGqlPatternToNode.set(p, node);
			listImports.push(...imports);
		}
		if(mappedFiles.fromPatterns.has(p)){
			throw new Error('Model.from not yeat implemented!');
		}
	});
	//* Inject imports
	if(listImports.length){
		srcFile= f.updateSourceFile(
			srcFile,
			listImports.concat(srcFile.statements),
			false,
			srcFile.referencedFiles,
			srcFile.typeReferenceDirectives,
			srcFile.hasNoDefaultLib,
			srcFile.libReferenceDirectives
		);
	}
	//* Replace patterns
	srcFile= ts.transform(srcFile, [function(ctx:ts.TransformationContext): ts.Transformer<ts.Node>{
		return _createModelInjectTransformer(ctx, srcFile, mappedFiles.ModelVarName, mapGqlPatternToNode, mapFromPatternToNode);
	}], compilerOptions).transformed[0] as ts.SourceFile;
	//* Return content
	info('>> Print file');
	return ts.createPrinter().printFile(srcFile);
}

/** filterFilesWithModel response */
interface FilterFilesWithModelResp{
	/** Absolute Glob pattern inside: "Model.from(pattern)" */
	patterns:			Set<string>
	fromPatterns:		Set<string>
	toGraphqlPatterns:	Set<string>
	/** Selected files (has "model.from") */
	file: ts.SourceFile
	ModelVarName: Set<string>
}
/** Filter files to get those with "Model.from('glob-path')" */
function mapFilesWithModel(srcFile: ts.SourceFile): FilterFilesWithModelResp{
	const fromPatterns:Set<string>= new Set();
	const toGraphqlPatterns:Set<string>= new Set();
	const foundGlobPatterns:Set<string>= new Set();
	const ModelVarName:Set<string>= new Set();
	//* Parse each file
	const fileName= srcFile.fileName;
	const queue:ts.Node[]= [srcFile];
	var node, j=0;
	while(j<queue.length){
		node= queue[j++];
		if(ts.isImportDeclaration(node) && node.moduleSpecifier.getText() === PACKAGE_NAME){
			// Load names used for "Model"
			node.importClause?.namedBindings?.forEachChild(function(n){
				if(ts.isImportSpecifier(n) && (n.propertyName ?? n.name).getText() === 'Model'){
					ModelVarName.add(n.name.getText());
				}
			});
		} else if(ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ModelVarName.has(node.expression.getFirstToken()!.getText())){
			let arg;
			if(node.arguments.length===1 && (arg= node.arguments[0]) && ts.isStringLiteral(arg)){
				let t= arg.getText();
				switch(node.expression.name.getText()){
					case 'from':
						foundGlobPatterns.add(t);
						fromPatterns.add(t)
						break;
					case 'toGraphQL':
						foundGlobPatterns.add(t);
						toGraphqlPatterns.add(t);
						break;
				}
			}
		} else if(node.getChildCount()){
			queue.push(...node.getChildren());
		}
	}
	// found
	return {
		patterns:	foundGlobPatterns,
		fromPatterns,
		toGraphqlPatterns,
		file: 		srcFile,
		ModelVarName: ModelVarName
	};
}

function _createModelInjectTransformer(
	ctx: ts.TransformationContext,
	srcFile: ts.SourceFile,
	ModelVarName: Set<string>,
	mapGqlPatternToNode: Map<string, ts.CallExpression>,
	mapFromPatternToNode: Map<string, ts.CallExpression>
): ts.Transformer<ts.Node> {
	const f= ctx.factory;
	return _visitor;
	// Visitor
	function _visitor(node:ts.Node):ts.Node{
		if(
			ts.isCallExpression(node)
			&& ts.isPropertyAccessExpression(node.expression)
			&& ModelVarName.has(node.expression.getFirstToken()!.getText())
			&& node.arguments.length === 1
		){
			let arg= node.arguments[0].getText();
			switch(node.expression.name.getText()){
				case 'from':
					throw new Error(`Model.from not yeat impelemented!`)
				// 	node= factory.createNewExpression(
				// 		factory.createIdentifier(node.expression.getFirstToken()!.getText()),
				// 		undefined,
				// 		[ModelMap.get(arg)!]
				// 	);
				// 	break;
				case 'toGraphQL':
					//ModelRoots
					let n= mapGqlPatternToNode.get(arg)!;
					if(n==null)
						throw new Error(`Enexpected empty result for pattern: ${arg} at ${_errorFile(srcFile, node)}`);
					node= n;
					break;
			}
		} else {
			node= ts.visitEachChild(node, _visitor, ctx);
		}
		return node;
	}
}

