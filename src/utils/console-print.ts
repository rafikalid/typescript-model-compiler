/** Print object and map into console as tree */
export function printTree(root: any, tab: string){
	return JSON.stringify(root, _replacer, tab);
}

function _replacer(k: string, v: any){
	if(typeof v==='string' || typeof v==='number' || typeof v==='boolean') return v;
	else if(typeof v==='symbol') return v.toString();
	else if(typeof v==='function') return `<${v.name}(${', '.repeat(v.length)})>`;
	else if(v instanceof Map){
		let r: Record<any, any>= {};
		v.forEach((mv, mk)=> {
			r[mk]= mv;
		});
		return r;
	} else if(v instanceof Set) return Array.from(v);
	else return v;
}



// function _print(tab: string, obj: any){
// 	var arr: string[]= [];
// 	var size: number, i: number=0;
// 	var rep: string[]= [];
// 	var isLast: boolean;
// 	if(typeof obj==='string' || typeof obj==='number' || typeof obj==='boolean' || typeof obj==='symbol'){
// 		return [obj.toString()];
// 	} else if(typeof obj==='function'){
// 		return [`<${obj.name}(${', '.repeat(obj.length)})>`];
// 	} else if(obj instanceof Map){
// 		size= obj.size;
// 		obj.forEach((v, k)=> {
// 			++i;
// 			isLast= i===size;
// 			arr.push(`${ isLast ? '└─ ' : '├─ '} ${k}`);
// 			rep= _print(tab, v);
// 			let sp= isLast? tab : tab+'│ ';
// 			arr.push(...rep.map(e=> sp+e));
// 		});
// 	} else if(obj instanceof Set){
// 		size= obj.size;
// 		arr.push('[')
// 		obj.forEach((v, k)=> {
// 			arr.push(tab+k);
// 			rep= _print(tab, v);
// 			let sp= isLast? tab : tab+'│ ';
// 			arr.push(...rep.map(e=> sp+e));
// 		});
// 		arr.push(']');
// 	} else if(Array.isArray(obj)){
// 		size= obj.length;
// 		arr.push('[');
// 		for(let j=0; j<size; j++){
// 			rep= _print(tab, obj[j]);
// 			for(let k=0, len= rep.length; k<len; ++k){
// 				arr.push(tab+rep[k], ',');
// 			}
// 		}
// 		arr.push(']');
// 	} else if(typeof obj==='object'){
// 		let keys= Object.keys(obj);
// 		size= keys.length;
// 		for(let j=0; j<size; j++){
// 			isLast= i===size;
// 			let k= keys[j];
// 			arr.push(`${ isLast ? '└─' : '├─'} ${k}`);
// 			rep= _print(tab, obj[k as keyof typeof obj]);
// 			let sp= isLast? tab : tab+'│ ';
// 			arr.push(...rep.map(e=> sp+e));
// 		}
// 	} else {
// 		return ['< UNKNOWN! >']
// 	}
// 	return arr;
// }

// _printKey(obj: any){
	
// }