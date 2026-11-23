declare const __BOFF_RELEASE_TARGET__: {name:'development'|'production';projectRef:string;origin:string;publishableKey:string};
export const environment=__BOFF_RELEASE_TARGET__;
export const isDevelopment=environment.name==='development';
