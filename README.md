# tt-Model Compiler
This package is used to compile code for [tt-Model](https://www.npmjs.com/package/tt-model).\
**tt-Model** is a fast and easy to use GraphQL and REST Schema extractor from typescript code.
You don't need to learn new languages or anything else to use this API, you only need typescript that you already use.

You can use this package with "Gulp" or standalone or with any other task runner or bundler.

# Use with GulpJS
Just add `compiler.gulp()` to your Gulp pipeline to enable the Magic!

## Extract only schema from typescript files:

```javascript
const Gulp= require('gulp');
const { Compiler } = require('tt-model-compiler');

//* Create a compiler with path to your "tsconfig" file
const compiler = new Compiler('tsconfig.json');

//* Define your Gulp task and use it
function compileCode() {
	return Gulp.src('src/to/your/files/**/*.ts')
		//* Add this line to your pipeline before compiling typescript
		.pipe(compiler.gulp())
		.pipe(dest('dist'));
}
```

This line will enable the magic of **tt-model**.

## Options
 
### Compiler
```typescript
const { Compiler } = require('tt-model-compiler');

//* Create compiler using "tsconfig" file path
const compiler = new Compiler('tsconfig.json');

//* Or creating the compiler by giving directly the "compiler options"
const compiler = new Compiler(options: ts.CompilerOptions);
```

### compiler.gulp()
```typescript
compiler.gulp(
	/** If extract pretty code */
	pretty?: boolean,
	/**
	 * This options enables you to transpile typescript
	 * directly to Javascript without need for an other
	 * pipeline step.
	 * 
	 * This will increase compiling performance and resolve
	 * known issues with named typescript imports.
	 * 
	 * To enable transpilation to Javascript,
	 * set this to '.js', '.mjs' or '.cjs'
	 * 
	 * "undefined" means keep it as Typescript ( no transpilation )
	 */
	targetExtension?: '.js' | '.mjs' | '.cjs' | undefined
);
```

# Compile direct files or Content

This is useful for:
- Creating your own task runner pipeline logic.
- Use with bundlers.
- Any other use case thinks to full control.

```typescript
//* Load the compiler factory
import { Compiler } from 'tt-model-compiler';

//* Create a compiler using "tsconfig" file path or ts.CompilerOptions
const compiler = new Compiler('tsconfig.json');

// Call the compiler as follow
Compiler.compile(
	/**
	 * List of source file paths
	 * OR Map: string_file_path => string_file_content
	 * 
	 * You can use GLOB library to load files
	 * for you using patterns
	 */
	files: string[] | Map<string, string>,
	/**
	 * Print pretty code
	 */
	pretty?: boolean,
	/**
	 * If transpile the content from TypeScript to JavaScript.
	 * "undefined" means keep the code as TypeScript
	 */
	targetExtension?: '.js' | '.mjs' | '.cjs' | undefined
): CompileResult[]

/** The result will be as follow : */
interface CompileResult {
    path: string;
    content: string;
}
```

# Authors
- Khalid RAFIK <khalid.rfk@gmail.com>
	- Software Architect
	- Senior FullStack and DATA Engineer
- Wijdane EL HORRE <wijdane.elhorre19@gmail.com>
	- Senior Backend and DATA Engineer
- Abdelhakim RAFIK <ra.abdelhakim@gmail.com>
	- Fullstack and Security Engineer
# License
MIT License
