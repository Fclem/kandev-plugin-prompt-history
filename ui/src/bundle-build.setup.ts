/**
 * Builds the shipped bundle once before the suite runs.
 *
 * `src/bundle.test.ts` mounts the built artifact, and the build cannot happen
 * inside that test: esbuild refuses to start under the jsdom environment the
 * suite uses (its `TextEncoder`/`Uint8Array` invariant does not hold there).
 * Running this repository's own build script here keeps the smoke pointed at
 * the artifact the shipping aliases actually produce.
 *
 * The output (`ui/bundle.js`) is a gitignored build artifact, not source.
 */
export default async function setup(): Promise<void> {
  await import("../build.mjs");
}
