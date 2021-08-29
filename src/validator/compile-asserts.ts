import type { AssertOptions, FieldType } from "@src/parser/model";
import ts from "typescript";

/**
 * Compile asserts
 * @param name 
 * @param asserts 
 * @param type 
 * @param factory 
 * @param PRETTY 
 */
export function compileAsserts(name: string | undefined, asserts: AssertOptions, type: FieldType, factory: ts.NodeFactory, PRETTY: boolean): ts.MethodDeclaration|undefined {
	// Arr
	const numberChecks: ts.Statement[]= [];
	const elseChecks: ts.Statement[]= [
		// create var "len"
		factory.createVariableStatement( undefined, factory.createVariableDeclarationList(
			[factory.createVariableDeclaration(
			factory.createIdentifier("len"),
			undefined,
			undefined,
			factory.createPropertyAccessExpression(
				factory.createIdentifier("value"),
				factory.createIdentifier("length")
			)
			)],
			ts.NodeFlags.None
		) )
	];
	// Min value
	var v:string|number|undefined= asserts.min ?? asserts.gte;
	if(v!=null){
		numberChecks.push( _ifThrow(factory, 'value', ts.SyntaxKind.LessThanToken, v, `${name} >= ${v}`) );
		elseChecks.push( _ifThrow(factory, 'len', ts.SyntaxKind.LessThanToken, v, `${name}.length >= ${v}`) );
	}
	// Max value
	v= asserts.max ?? asserts.lte;
	if(v!=null){
		numberChecks.push( _ifThrow(factory, 'value', ts.SyntaxKind.GreaterThanToken, v, `${name} <= ${v}`) );
		elseChecks.push( _ifThrow(factory, 'len', ts.SyntaxKind.GreaterThanToken, v, `${name}.length <= ${v}`) );
	}
	//lt
	v= asserts.lt;
	if(v!=null){
		numberChecks.push( _ifThrow(factory, 'value', ts.SyntaxKind.GreaterThanEqualsToken, v, `Expected ${name} < ${v}`) );
		elseChecks.push( _ifThrow(factory, 'len', ts.SyntaxKind.GreaterThanEqualsToken, v, `Expected ${name}.length < ${v}`) );
	}
	//gt
	v= asserts.gt;
	if(v!=null){
		numberChecks.push( _ifThrow(factory, 'value', ts.SyntaxKind.LessThanEqualsToken, v, `Expected ${name} > ${v}`) );
		elseChecks.push( _ifThrow(factory, 'len', ts.SyntaxKind.LessThanEqualsToken, v, `Expected ${name}.length > ${v}`) );
	}
	//eq
	v= asserts.eq;
	if(v!=null){
		numberChecks.push( _ifThrow(factory, 'value', ts.SyntaxKind.ExclamationEqualsEqualsToken, v, `Expected ${name} === ${v}`) );
		elseChecks.push( _ifThrow(factory, 'value', ts.SyntaxKind.ExclamationEqualsEqualsToken, v, `Expected ${name} === ${v}`) );
	}
	//ne
	v= asserts.ne;
	if(v!=null){
		numberChecks.push( _ifThrow(factory, 'value', ts.SyntaxKind.EqualsEqualsEqualsToken, v, `Expected ${name} !== ${v}`) );
		elseChecks.push( _ifThrow(factory, 'value', ts.SyntaxKind.EqualsEqualsEqualsToken, v, `Expected ${name} !== ${v}`) );
	}
	// length
	v= asserts.length
	if(v!=null){
		elseChecks.push( _ifThrow(factory, 'len', ts.SyntaxKind.ExclamationEqualsEqualsToken, v, `Expected ${name}.length === ${v}`) );
	}
	// regex
	if(asserts.regex!=null){
		elseChecks.push(
			factory.createIfStatement(
				factory.createCallExpression(
					factory.createPropertyAccessExpression( factory.createIdentifier("value"), factory.createIdentifier("match")),
					undefined,
					[factory.createIdentifier(asserts.regex.toString())]
				),
				factory.createThrowStatement(factory.createNewExpression(
					factory.createIdentifier("Error"),
					undefined,
					[factory.createBinaryExpression(
						factory.createStringLiteral(`Expected "${name}" to match ${asserts.regex.toString()}. Got: `),
						factory.createToken(ts.SyntaxKind.PlusToken),
						factory.createIdentifier("value")
					)]
				)),
				undefined
			)
		)
	}

	// return
	if(numberChecks.length===0 && elseChecks.length===1)
		return undefined;
	else
		return factory.createMethodDeclaration( undefined, undefined, undefined,
			factory.createIdentifier("assert"), undefined, undefined,
			// Argument
			[factory.createParameterDeclaration(
				undefined, undefined, undefined, factory.createIdentifier("value"),
				undefined, factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword), undefined
			)], undefined,
			factory.createBlock([
				factory.createIfStatement(
					// If is Number
					factory.createBinaryExpression(
						factory.createTypeOfExpression(factory.createIdentifier("value")),
						factory.createToken(ts.SyntaxKind.EqualsEqualsEqualsToken),
						factory.createStringLiteral("number")
					),
					// If true
					factory.createBlock(numberChecks, PRETTY ),
					// Else
					factory.createBlock(elseChecks, PRETTY)
				)
			], PRETTY)
		);
}

/** Generate lines */
type Tkind= ts.SyntaxKind.LessThanToken | ts.SyntaxKind.GreaterThanToken | ts.SyntaxKind.GreaterThanEqualsToken
	| ts.SyntaxKind.LessThanEqualsToken | ts.SyntaxKind.EqualsEqualsEqualsToken | ts.SyntaxKind.ExclamationEqualsEqualsToken
	| ts.SyntaxKind.EqualsEqualsEqualsToken;
function _ifThrow(factory: ts.NodeFactory, identifier: string, cmpToken: Tkind, cmpValue: string|number, errMsg: string){
	return factory.createIfStatement(
		factory.createBinaryExpression(
			factory.createIdentifier(identifier),
			factory.createToken(cmpToken),
			typeof cmpValue === 'number' ? factory.createNumericLiteral(cmpValue) : factory.createStringLiteral(cmpValue)
		),
		factory.createThrowStatement(factory.createNewExpression(
			factory.createIdentifier("Error"),
			undefined,
			[factory.createBinaryExpression(
				factory.createStringLiteral(`${errMsg}. Got: `),
				factory.createToken(ts.SyntaxKind.PlusToken),
				factory.createIdentifier(identifier)
			)]
		)),
		undefined
	)
}
