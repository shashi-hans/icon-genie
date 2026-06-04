import { defineConfig } from "tsup";

// Single-file ESM + CJS bundles. Each icon compiles to a pure top-level
// function with /* @__PURE__ */-annotated jsx() calls, and package.json sets
// "sideEffects": false, so a production bundler (rollup/webpack/vite) drops
// unused icons from the single index. This keeps the published layout simple
// (dist/index.js, dist/index.cjs) and Node-resolvable while staying
// tree-shakeable. (esbuild's standalone CLI DCE is weaker and not the target.)
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  // No source maps: they are excluded from the npm tarball anyway, and they
  // would only map to generated code. Skipping them shrinks dist/ (~16MB) and
  // speeds the build.
  sourcemap: false,
  clean: true,
  treeshake: true,
  splitting: false,
  minify: false,
  external: ["react", "react-dom", "react/jsx-runtime"],
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".js" };
  },
});
