/** default scalars: int */
export const DEFAULT_SCALARS= [ 'number', 'Int', 'uInt', 'uFloat', 'string', 'boolean' ] as const;

/** Integers */
export type Int= number;
export type uInt= number;

/** Double precesion flotting point */
export type Float= number;

/** Scalar define options */
export type JsonTypes= string|number|boolean // |null|undefined

/** Create new Scalar */
export interface ModelScalar<T>{
	/** Parse value */
	parse?: (value: JsonTypes)=> T
	/** Stringify value */
	serialize?: (value: T)=> JsonTypes|undefined|null
	/** Load from Database */
	fromDB?: (value:any)=> T
	/** Save into database */
	toDB?: (value:T)=> any
}

/** Unions */
export interface UNION<Types>{
	// Return the index of target type
	resolveType: (value: Types, context?: any, info?: any)=> number
}

//* Custom scalars
export const numberScalar: ModelScalar<number>= {
	parse(value){
		if(typeof value === 'number'){
			return value;
		} else {
			var v= Number(value);
			if(isNaN(v)) throw new Error(`Illegal unsigned int: ${value}`);
			return v;
		}
	}
};
/** Unsigned integer */
export const uIntScalar: ModelScalar<uInt>= {
	parse(value){
		if(typeof value === 'number' && Number.isSafeInteger(value) && value>=0)
			return value;
		else
			throw new Error(`Illegal unsigned int: ${value}`);
	}
};

/** Unsigned integer */
export const intScalar: ModelScalar<Int>= {
	parse(value){
		if(typeof value === 'number' && Number.isSafeInteger(value))
			return value;
		else
			throw new Error(`Illegal int: ${value}`);
	}
};

/** Unsinged Float */
export type uFloat= number;
export const uFloatScalar: ModelScalar<uFloat>= {
	parse(value){
		if(typeof value === 'number' && value>=0)
			return value;
		else
			throw new Error(`Illegal unsigned float: ${value}`);
	}
};

/** String */
export const stringScalar: ModelScalar<string>={
	parse(value){
		if(typeof value === 'string')
			return value;
		else
			return String(value);
	}
}

/** Boolean */
export const booleanScalar: ModelScalar<boolean>={
	parse(value){
		if(typeof value === 'boolean')
			return value;
		else
			return !!value;
	}
}