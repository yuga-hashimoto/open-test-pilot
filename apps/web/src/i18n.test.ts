import { describe, expect, it } from "vitest";
import { detectBrowserLocale, translate } from "./i18n.js";

describe("locale detection", () => {
  it("uses Japanese for Japanese browser locales", () => {
    expect(detectBrowserLocale("ja-JP")).toBe("ja");
    expect(detectBrowserLocale("JA")).toBe("ja");
  });

  it("falls back to English for other or missing browser locales", () => {
    expect(detectBrowserLocale("en-US")).toBe("en");
    expect(detectBrowserLocale(undefined)).toBe("en");
  });
});

describe("translation", () => {
  it("interpolates translated values", () => {
    expect(translate("ja", "time.minutesAgo", { n: 5 })).toBe("5分前");
    expect(translate("en", "time.minutesAgo", { n: 5 })).toBe("5m ago");
  });
});
