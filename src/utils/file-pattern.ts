import { resolve, relative, dirname } from 'path';
import Glob from 'glob';

/**
 * Resolve files via pattern
 */
export function resolveFilePattern(filePath: string, pattern: string): string[] {
	// Compile pattern
	const relativeDirname = relative(process.cwd(), dirname(filePath));
	const patterns = pattern.split(',')
		.map(e => resolve(relativeDirname, e.trim())) // Get absolute paths
		.filter((a, i, arr) => arr.indexOf(a) === i); // Remove duplicates
	// Resolve files
	const files: string[] = [];
	for (let i = 0, len = patterns.length; i < len; ++i) {
		let f = Glob.sync(patterns[i]);
		for (let j = 0, jLen = f.length; j < jLen; ++j) {
			let file = f[j];
			if (!files.includes(file))
				files.push(file);
		}
	}
	return files;
}