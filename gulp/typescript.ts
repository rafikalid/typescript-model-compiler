/**
 * Compile Typescript files
 */
import Gulp from 'gulp';
import GulpTypescript from 'gulp-typescript';
import SrcMap from 'gulp-sourcemaps';
import { Converter } from 'typescript-path-fix';

const { src, dest, lastRun } = Gulp;
// import {transform} from 'ts-transform-import-path-rewrite'

const isProd = process.argv.includes('--prod');

const tsPathFix = new Converter('tsconfig.json');

const TsProject = GulpTypescript.createProject('tsconfig.json', {
	removeComments: isProd,
	pretty: !isProd
});

// import babel from 'gulp-babel';

export function typescriptCompile() {
	return src('src/**/*.ts', {
		nodir: true,
		since: lastRun(typescriptCompile)
	})
		.pipe(SrcMap.init())
		.pipe(tsPathFix.gulp())
		.pipe(TsProject())
		.pipe(SrcMap.write('.'))
		.pipe(dest('dist'));
}
