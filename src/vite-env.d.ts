declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}

interface ImportMetaEnv {
  readonly VITE_USE_LOCAL_FALLBACK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
