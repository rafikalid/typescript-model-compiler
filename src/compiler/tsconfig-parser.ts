import { readFileSync } from 'fs';
import ts from "typescript";

/** Parse tsConfig */
export function parseTsConfig(tsConfigPath: string) {
	//* Parse tsConfig
	var tsP = ts.parseConfigFileTextToJson(
		tsConfigPath,
		readFileSync(tsConfigPath, 'utf-8')
	);
	if (tsP.error)
		throw new Error(
			'Config file parse fails:' + tsP.error.messageText.toString()
		);
	var tsP2 = ts.convertCompilerOptionsFromJson(
		tsP.config.compilerOptions,
		process.cwd(),
		tsConfigPath
	);
	if (tsP2.errors?.length)
		throw new Error(
			'Config file parse fails:' +
			tsP2.errors.map(e => e.messageText.toString())
		);
	return tsP2.options;
}