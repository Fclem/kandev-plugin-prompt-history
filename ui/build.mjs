import esbuild from "esbuild";

const reactShim = new URL("./src/react-shim.ts", import.meta.url).pathname;

await esbuild.build({
  bundle: true,
  format: "esm",
  target: "es2020",
  logLevel: "warning",
  minify: true,
  outfile: new URL("./bundle.js", import.meta.url).pathname,
  entryPoints: [new URL("./src/index.tsx", import.meta.url).pathname],
  alias: {
    react: reactShim,
    "react/jsx-runtime": reactShim,
    "react/jsx-dev-runtime": reactShim,
  },
  loader: { ".ts": "ts", ".tsx": "tsx" },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
});
