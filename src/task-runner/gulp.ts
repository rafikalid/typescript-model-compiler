import { generateModel } from '@src/parser/compile';
import Through from 'through2';
import Vinyl from "vinyl";
import {readFileSync} from 'fs';
import ts from "typescript";

/** Gulp options */
export interface GulpOptions{
	tsConfig: string|ts.CompilerOptions
	pretty:boolean
}
/** Adapter for gulp */
export function createGulpPipe({tsConfig, pretty=true}:GulpOptions){
	if(typeof tsConfig==='string') tsConfig= parseTsConfig(tsConfig);

	return Through.obj(function(file: Vinyl, _:any, cb: Through.TransformCallback){
		if(file.extname===".ts"){
			// generate model
			var content= generateModel(
				file.path,
				file.isBuffer() ? file.contents.toString('utf-8'): readFileSync(file.path, 'utf-8'),
				tsConfig as ts.CompilerOptions,
				pretty
			);
			if(typeof content === 'string'){
				file.contents= Buffer.from(content);
			}
		}
		cb(null, file);
	});
}

/** Parse tsConfig */
export function parseTsConfig(tsConfigPath: string){
	//* Parse tsConfig
	var tsP= ts.parseConfigFileTextToJson(tsConfigPath, readFileSync(tsConfigPath, 'utf-8'));
	if(tsP.error) throw new Error("Config file parse fails:" + tsP.error.messageText.toString());
	var tsP2= ts.convertCompilerOptionsFromJson(tsP.config.compilerOptions, process.cwd(), tsConfigPath);
	if(tsP2.errors?.length) throw new Error("Config file parse fails:" + tsP2.errors.map(e=> e.messageText.toString()));
	return tsP2.options;
}