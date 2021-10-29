import { format } from '@src/parser/format';
import ts from 'typescript';


/** To data return value  */
export interface ToDataReturn {
	imports: ts.ImportDeclaration[];
	node: ts.CallExpression;
}

/** Generate data nodes */
export function toDataModel(
	nodeFactory: ts.NodeFactory,
	data: ReturnType<typeof format>,
	pretty: boolean
): ToDataReturn {
	//TODO generate data Model
	throw "Function '::toDataModel' is not implemented.";
}