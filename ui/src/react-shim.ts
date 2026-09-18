/**
 * Every `react` and `react/jsx-runtime` import in this bundle — ours and any
 * host-delegated module's — resolves here (see the esbuild alias in build.mjs).
 * kandev owns the React instance; a second copy would break hooks, context
 * and portals.
 *
 * Everything is looked up lazily through `hostReact()`. This module is
 * evaluated when kandev imports the bundle, which is before `initialize` runs
 * and hands us the host, so nothing may be read at module scope.
 */
import { hostReact } from "./host";

type AnyFn = (...args: unknown[]) => unknown;

function react(name: string): AnyFn {
  return (hostReact() as unknown as Record<string, AnyFn>)[name] as AnyFn;
}

// ── Automatic JSX runtime ───────────────────────────────────────────────

/**
 * The automatic runtime keeps children inside props and passes `key`
 * separately; `createElement` takes `key` in props instead. Everything else
 * matches, so one adapter serves jsx, jsxs and jsxDEV.
 */
export function jsx(type: unknown, props: Record<string, unknown>, key?: unknown): unknown {
  return react("createElement")(type, key === undefined ? props : { ...props, key });
}

export const jsxs = jsx;
export const jsxDEV = jsx;

/**
 * A component rather than the raw `React.Fragment` symbol, for the
 * module-scope reason above.
 */
export function Fragment(props: { children?: unknown }): unknown {
  const React = hostReact();
  return (React.createElement as AnyFn)(React.Fragment, null, props?.children);
}

// ── Hooks and helpers our own modules import ──────────────────────────────

export const createElement = (...args: unknown[]) => react("createElement")(...args);
export const useState = (...args: unknown[]) => react("useState")(...args);
export const useEffect = (...args: unknown[]) => react("useEffect")(...args);
export const useLayoutEffect = (...args: unknown[]) => react("useLayoutEffect")(...args);
export const useMemo = (...args: unknown[]) => react("useMemo")(...args);
export const useCallback = (...args: unknown[]) => react("useCallback")(...args);
export const useRef = (...args: unknown[]) => react("useRef")(...args);
export const useSyncExternalStore = (...args: unknown[]) => react("useSyncExternalStore")(...args);

export default new Proxy(
  {},
  {
    get(_target, property: string) {
      return (hostReact() as unknown as Record<string, unknown>)[property];
    },
  },
);
