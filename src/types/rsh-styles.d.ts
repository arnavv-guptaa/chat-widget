// Ambient declarations for the per-file react-syntax-highlighter Prism themes.
//
// We import the themes from their explicit leaf files
// (`react-syntax-highlighter/dist/esm/styles/prism/one-dark` and `/one-light`)
// instead of the `styles/prism` directory barrel, because a bare directory
// import is invalid under strict native-ESM resolution and crashes consumers
// (see src/components/code-block.tsx). `@types/react-syntax-highlighter` types
// the barrel module but not these individual leaf modules, so we declare them
// here to keep the build type-safe.
//
// NOTE: if a future `@types/react-syntax-highlighter` starts declaring these
// exact per-file module specifiers, TypeScript will report a duplicate
// declaration — at that point simply delete this file.
declare module "react-syntax-highlighter/dist/esm/styles/prism/one-dark" {
  import type { CSSProperties } from "react";
  const style: { [key: string]: CSSProperties };
  export default style;
}

declare module "react-syntax-highlighter/dist/esm/styles/prism/one-light" {
  import type { CSSProperties } from "react";
  const style: { [key: string]: CSSProperties };
  export default style;
}
