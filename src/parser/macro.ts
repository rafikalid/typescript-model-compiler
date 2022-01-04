import { PACKAGE_NAME } from "@src/config";
import ts from "typescript";
import { MacroAnnotationHandler, MacroAnnotationNode, MacroUtils } from 'tt-model';
import { runInNewContext } from 'vm';
import { errorFile } from "@src/utils/error";

/**
 * Resolve Annotation Macro
 */
export function resolveAnnotationMacro(
	srcFile: ts.SourceFile,
	compilerOptions: ts.CompilerOptions,
	typechecker: ts.TypeChecker,
	program: ts.Program,
	MarcoAnnotationMap: Map<ts.Node, MacroAnnotationHandler>
): ts.SourceFile {
	const factory = ts.factory;
	srcFile = ts.transform(srcFile, [function (ctx: ts.TransformationContext) {
		function _visitor(node: ts.Node): ts.Node {
			switch (node.kind) {
				case ts.SyntaxKind.SourceFile:
					return ts.visitEachChild(node, _visitor, ctx);
				case ts.SyntaxKind.ClassDeclaration: {
					let entityNode = node as ts.ClassDeclaration;
					if (entityNode.decorators != null) {
						let deco = _resolveDecorators(entityNode);
						if (deco.modified) {
							node = deco.node;
							node = factory.updateClassDeclaration(
								entityNode, deco.decorators, entityNode.modifiers, entityNode.name,
								entityNode.typeParameters, entityNode.heritageClauses, entityNode.members
							);
						}
					}
					return ts.visitEachChild(node, _visitor, ctx);
				}
				case ts.SyntaxKind.MethodDeclaration: {
					let entityNode = node as ts.MethodDeclaration
					if (entityNode.decorators != null) {
						let deco = _resolveDecorators(entityNode);
						if (deco.modified) {
							node = deco.node;
							node = factory.updateMethodDeclaration(
								entityNode, deco.decorators, entityNode.modifiers, entityNode.asteriskToken,
								entityNode.name, entityNode.questionToken, entityNode.typeParameters,
								entityNode.parameters, entityNode.type, entityNode.body
							);
						}
					}
					break;
				}
				case ts.SyntaxKind.PropertyDeclaration: {
					let entityNode = node as ts.PropertyDeclaration;
					if (entityNode.decorators != null) {
						let deco = _resolveDecorators(entityNode);
						if (deco.modified) {
							node = deco.node;
							node = factory.updatePropertyDeclaration(
								entityNode, deco.decorators, entityNode.modifiers, entityNode.name,
								entityNode.questionToken, entityNode.type, entityNode.initializer
							);
						}
					}
					break;
				}
			}
			return node;
		}
		return _visitor;
	}], compilerOptions).transformed[0] as ts.SourceFile;
	return srcFile;

	/** Resolve Decorators */
	function _resolveDecorators(
		node: MacroAnnotationNode
	): ResolveDecoReturn<MacroAnnotationNode> {
		var decorators: ts.NodeArray<ts.Decorator> | ts.Decorator[] | undefined = node.decorators;
		var decoRmSet: Set<ts.Decorator> = new Set();
		if (decorators != null) {
			for (let i = 0, len = decorators.length; i < len; ++i) {
				let decorator = decorators[i];
				try {
					let decoratorCall = decorator.expression as ts.CallExpression;
					let decoExpr: ts.Node | undefined;
					let decoSymbol: ts.Symbol | undefined;
					let varSymbol: ts.Symbol | undefined;
					let varExpr: ts.Node | undefined;
					if (
						(decoExpr = decoratorCall.expression) &&
						(decoSymbol = typechecker.getSymbolAtLocation(decoExpr)) &&
						(varSymbol = typechecker.getAliasedSymbol(decoSymbol)) &&
						(varExpr = varSymbol.declarations?.[0]) &&
						(ts.isVariableDeclaration(varExpr)) &&
						(varExpr = varExpr.initializer) &&
						(ts.isCallExpression(varExpr))
					) {
						let handler = MarcoAnnotationMap.get(varExpr.expression);
						if (handler == null) {
							if (
								//* Check create by "AnnotationMacro"
								(varSymbol = typechecker.getSymbolAtLocation(varExpr.expression)) &&
								(decoExpr = varSymbol.declarations?.[0]) &&
								ts.isImportSpecifier(decoExpr) &&
								((decoExpr.parent.parent.parent as ts.ImportDeclaration).moduleSpecifier.getText().slice(1, -1) === PACKAGE_NAME) &&
								(handler = _resolveHandler(varExpr, compilerOptions))
							) {
								MarcoAnnotationMap.set(varExpr.expression, handler);
							} else {
								continue; // Continue for loop
							}
						}
						// Get arguments expression
						let args = decoratorCall.arguments.map(a => {
							if (ts.isEnumMember(a) || ts.isPropertyAccessExpression(a) || ts.isElementAccessExpression(a))
								return typechecker.getConstantValue(a);
							else return undefined;
						});
						// Exec handler
						node = handler(
							node,
							new MacroUtils(program, node, decoratorCall.arguments.map(a => a.getText()), args),
							...args
						);
						decoRmSet.add(decorator);
					}
				} catch (err: any) {
					throw new Error(`Error at: ${errorFile(srcFile, decorator)}\n${err?.message ?? err}`);
				}
			}
			decorators = node.decorators;
			// Update decorators
			if (decorators != null && decoRmSet.size > 0) {
				let decoArr: ts.Decorator[] = [];
				for (let i = 0, len = decorators.length; i < len; ++i) {
					let deco = decorators[i];
					if (!decoRmSet.has(deco)) decoArr.push(deco);
				}
				decorators = decoArr;
			}
		}
		return { node, decorators, modified: decoRmSet.size > 0 }
	}
}

interface ResolveDecoReturn<T> {
	node: T
	decorators: ts.Decorator[] | ts.NodeArray<ts.Decorator> | undefined
	/** If node has modifications */
	modified: boolean
}

function _resolveHandler(decoExpr: ts.CallExpression, compilerOptions: ts.CompilerOptions): MacroAnnotationHandler | undefined {
	// Prepare module text
	let code = ts.transpile(`module.fx=${decoExpr.arguments[0].getText()}`, compilerOptions, undefined);
	//* Prepare context
	const ctx: { module: { fx?: MacroAnnotationHandler }, console: any } = { module: {}, console };
	//* Exec
	runInNewContext(code, ctx, { timeout: 1000 });
	return ctx.module.fx;
}
