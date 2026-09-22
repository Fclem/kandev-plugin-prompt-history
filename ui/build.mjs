import esbuild from "esbuild";
import { fileURLToPath } from "node:url";

const reactShim = fileURLToPath(new URL("./src/react-shim.ts", import.meta.url));

await esbuild.build({
  bundle: true,
  format: "esm",
  target: "es2020",
  logLevel: "warning",
  minify: true,
  outfile: fileURLToPath(new URL("./bundle.js", import.meta.url)),
  entryPoints: [fileURLToPath(new URL("./src/index.tsx", import.meta.url))],
  alias: {
    react: reactShim,
    "react/jsx-runtime": reactShim,
    "react/jsx-dev-runtime": reactShim,
  },
  loader: { ".ts": "ts", ".tsx": "tsx" },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
});
