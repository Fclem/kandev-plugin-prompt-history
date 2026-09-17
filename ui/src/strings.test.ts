import { describe, expect, it } from "vitest";
import { CATALOGS } from "./strings";

/** The exact supported locale set: `en` is the only catalog the host requires;
 * AC-002.10 requires all six. */
const SUPPORTED_LOCALES = ["en", "pt-pt", "zh-cn", "zh-hk", "zh-tw", "pseudo"] as const;

/** Flat key shape: `^[a-z][a-zA-Z0-9_-]*$` (no dots or nesting). */
const KEY_SHAPE = /^[a-z][a-zA-Z0-9_-]*$/;

describe("CATALOGS", () => {
  it("covers exactly the supported locale set", () => {
    expect(Object.keys(CATALOGS).sort()).toEqual([...SUPPORTED_LOCALES].sort());
  });

  it("uses flat keys matching the pinned shape in every locale", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const catalog = CATALOGS[locale];
      expect(catalog, locale).toBeDefined();
      for (const key of Object.keys(catalog)) {
        expect(key, `${locale}:${key}`).toMatch(KEY_SHAPE);
      }
    }
  });

  it("carries the same key set in every locale", () => {
    const enKeys = Object.keys(CATALOGS.en).sort();
    for (const locale of SUPPORTED_LOCALES) {
      expect(Object.keys(CATALOGS[locale]).sort(), locale).toEqual(enKeys);
    }
  });

  it("stays within the per-locale message count and length limits", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const catalog = CATALOGS[locale];
      expect(Object.keys(catalog).length, locale).toBeLessThanOrEqual(1000);
      for (const [key, value] of Object.entries(catalog)) {
        expect(value.length, `${locale}:${key}`).toBeLessThanOrEqual(4096);
      }
    }
  });
});
