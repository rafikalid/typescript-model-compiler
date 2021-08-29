/** Resolver signature */
export type Resolver<Tparent, Tresult>= (parent: Tparent, args: any, context?: any, info?: any)=> Tresult extends undefined ? Tresult|void : Tresult;

/** Convert Model to optional resolvers signature */
export type ResolversOf<T>= {
	[P in keyof T]?: Resolver<T, any>
};

/** Add input controller to a model */
export type InputResolversOf<T> = {
    [P in keyof T]?: InputResolver<T, T[P]>;
};

/** Input resolver */
export type InputResolver<T, P> = (parent: T, value: P, context?: any, info?: any) => P|Promise<P>;