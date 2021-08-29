import Gulp from 'gulp';

import {typescriptCompile} from './typescript.js'
// import { compileTest } from './test-files.js';

const {watch, series}= Gulp;

const argv= process.argv;
const doWatch= !argv.includes('--nowatch');

/** Watch modified files */
function watchCb(cb: Function){
	if(doWatch){
		watch('src/**/*.ts', typescriptCompile);
		// watch('src/app/graphql/schema/**/*.gql', graphQlCompile)
	}
	cb();
}

var tasks: any[];
// if(argv.includes('--test')){
// 	tasks=[
// 		compileTest
// 	];
// } else {
tasks= [
	typescriptCompile,
	// parallel([
	// 	typescriptCompile,
	// 	graphQlCompile
	// ]),
	watchCb
]
// }

export default series(tasks);
