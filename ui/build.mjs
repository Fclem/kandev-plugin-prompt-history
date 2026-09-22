import esbuild from "esbuild";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const reactShim = fileURLToPath(new URL("./src/react-shim.ts", import.meta.url));

/**
 * The release version from manifest.yaml, inlined so the bundle can pin its
 * own stylesheet URL to the version that shipped with it. The host injects
 * `ui.styles` as a bare `/api/plugins/{id}/ui/ui/plugin.css` link with no
 * cache key (unlike the bundle's `?v=`), so without this an install/update
 * kept rendering the previous release's CSS against the new markup — the
 * reported "grey bubble, giant icons". Parsed with a regex rather than a YAML
 * dependency: the build already owns this file's shape, and failing loudly
 * beats shipping a bundle that silently cannot cache-bust.
 */
const manifestVersion = readFileSync(
  new URL("../manifest.yaml", import.meta.url),
  "utf8",
).match(/^version: "([^"]+)"$/m)?.[1];
if (!manifestVersion) {
  throw new Error("manifest.yaml has no `version: \"X.Y.Z\"` line");
}

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
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    __PLUGIN_VERSION__: JSON.stringify(manifestVersion),
  },
});
