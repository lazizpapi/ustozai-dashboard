import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  /*
   * Vendored shadcn registry code (smoothui). Two of React's newer hook rules
   * fire on it: a self-recursive useCallback, which is safe because it recurses
   * asynchronously after the binding is assigned, and a setState inside an
   * effect in the microphone-amplitude hook, which nothing here uses.
   *
   * Scoped off rather than patched in place: re-running `shadcn add` rewrites
   * these files wholesale, so a local fix would silently disappear on the next
   * update while this override survives it.
   */
  {
    files: ["src/components/smoothui/**"],
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);

export default eslintConfig;
