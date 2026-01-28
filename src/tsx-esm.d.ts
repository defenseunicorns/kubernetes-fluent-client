// This is an ambient module shim for TypeScript.
//
// We dynamically import `tsx/esm` at runtime (in src/generate.ts) to enable importing
// user-provided `.ts` files when running the built CLI (clusterless CRD export).
//
// The `tsx` package does not provide TypeScript typings for the `tsx/esm` subpath, so
// without this declaration `tsc` fails with TS7016.
declare module "tsx/esm" {
  const register: unknown;
  export default register;
}
