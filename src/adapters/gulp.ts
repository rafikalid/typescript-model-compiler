import { Compiler } from "@compiler/compile";
import { TargetExtension } from "@compiler/interface";
import Through from 'through2';
import Vinyl from 'vinyl';
import type Stream from 'stream';

const TS_REGEX = /\.ts$/i

/**
 * Gulp adapter
 */
export class GulpAdapter extends Compiler {
	/** File info */
	#filesInfo!: Map<string, { cwd: string, base: string }>;
	/**
	 * Gulp adapter
	 */
	run(
		pretty = true,
		targetExtension: TargetExtension = '.js',
		encoding: BufferEncoding = 'utf8'
	) {
		const files: Map<string, string | undefined> = new Map();
		const self = this;
		const filesInfo = this.#filesInfo ??= new Map();

		return Through.obj(collector, compileAll);
		/** Collect files */
		function collector(file: Vinyl, _: unknown, cb: Through.TransformCallback) {
			//* Collect files
			try {
				if (
					file.isDirectory() ||
					file.isStream() ||
					file.isSymbolic() ||
					file.extname.toLowerCase() !== '.ts'
				) {
					// Ignore file
					cb(null, file);
				}
				else {
					const path = file.path;
					files.set(path, file.isBuffer() ? file.contents!.toString('utf-8') : undefined);
					filesInfo.set(path, { cwd: file.cwd, base: file.base });
					cb(null);
				}
			} catch (error) {
				cb(error ?? 'ERROR', file);
			}
		}
		/** Compile and flush files */
		function compileAll(this: Stream.Transform, cb: Through.TransformCallback) {
			try {
				//* Compile files
				const result = self.compile(files, pretty, true, encoding);
				const errors: string[] = [];
				for (let i = 0, len = result.length; i < len;) {
					const path = result[i++];
					const content = result[i++];
					let info = filesInfo.get(path);
					if (info == null)
						errors.push(`Unexpected missing file info: ${path}`);
					else
						this.push(new Vinyl({
							path: targetExtension ? path.replace(TS_REGEX, targetExtension) : path,
							base: info.base,
							cwd: info.cwd,
							contents: Buffer.from(content, 'utf-8')
						}));
				}
				cb(errors.length ? new Error(errors.join("\n")) : null);
			} catch (error) {
				cb(error ?? 'ERROR');
			}
		}
	}
}