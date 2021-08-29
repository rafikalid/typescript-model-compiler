import Chalk from 'chalk';
export function warn(...data: any[]){
	var o= Chalk.keyword('orange');
	console.warn(...data.map(t=> typeof t==='string' ? o(t): t));
}

export function info(...data:any[]){
	var o= Chalk.bold.blue;
	console.warn(...data.map(t=> typeof t==='string' ? o(t): t));
}