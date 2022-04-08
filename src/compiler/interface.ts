export type TargetExtension = '.ts' | '.js' | '.mjs' | '.cjs';

/**
 * Scans: Recompile all related files if one of them is changed
 */
export interface ScanFile {
	/** File that contains the scan */
	filePath: string
	/** Select by glob */
	glob: string
}