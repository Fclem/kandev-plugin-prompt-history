/**
 * The production bundle's only React boundary (the esbuild alias in
 * `build.mjs` routes every `react` / `react/jsx-runtime` import here). Vitest
 * resolves the real `react` package, so nothing else in this suite exercises
 * the shim: a dropped key would reconcile rows positionally in the shipped
 * bundle while the source-level suite stayed green.
 */
import { describe, expect, it } from "vitest";
import * as React from "react";
import { Fragment, jsx, jsxDEV, jsxs } from "./react-shim";
import { setHost } from "./host";
import type { PluginHost } from "./host";

function withHost(): void {
  setHost({ React } as unknown as PluginHost);
}

describe("react shim", () => {
  it("forwards the automatic runtime's separate key into props", () => {
    withHost();

    const element = jsx("div", { className: "x" }, "row-id") as {
      key: string | null;
      props: { className: string };
    };

    expect(element.key).toBe("row-id");
    expect(element.props.className).toBe("x");
  });

  it("passes props through untouched when there is no key", () => {
    withHost();

    const element = jsx("div", { className: "x" }) as { key: string | null };

    expect(element.key).toBeNull();
  });

  it("renders a fragment's children", () => {
    withHost();

    expect(jsxs).toBe(jsx);
    expect(jsxDEV).toBe(jsx);
    const element = Fragment({ children: ["a", "b"] }) as {
      props: { children: unknown };
    };

    expect(element.props.children).toEqual(["a", "b"]);
  });
});
