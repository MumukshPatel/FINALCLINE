import { describe, expect, it } from "vitest";
import { dictionaries, dictionaryIssues, ESSENTIAL_KEYS, isPartial, localeMetadata, locales, translate } from "./index";

describe("shipped dictionary coverage and script metadata", () => {
  it("registers English and all 22 requested Indian languages with unique IDs", () => {
    expect(locales).toHaveLength(23);
    expect(new Set(locales.map((locale) => locale.id)).size).toBe(23);
    expect(locales.every((locale) => !!locale.name && !!locale.script && !!locale.tag)).toBe(true);
  });
  for (const locale of locales) it(`${locale.englishName}: validates essential keys and matching interpolation placeholders`, () => {
    const report = dictionaryIssues(locale.id);
    expect(report.placeholderMismatch).toEqual([]);
    // These two locales are explicitly partial: the translation service did not support them.
    if (["brx", "ks"].includes(locale.id)) {
      expect(isPartial(locale.id)).toBe(true);
      expect(translate(locale.id, "fallbackNotice")).toBe(translate("en", "fallbackNotice"));
      console.info(`${locale.englishName}: PARTIAL, ${ESSENTIAL_KEYS.length - report.missing.length}/${ESSENTIAL_KEYS.length} translated keys; visible English fallback required.`);
    } else {
      expect(report.missing).toEqual([]);
      expect(isPartial(locale.id)).toBe(false);
    }
    expect(Object.keys(dictionaries[locale.id]).every((key) => ESSENTIAL_KEYS.includes(key as typeof ESSENTIAL_KEYS[number]))).toBe(true);
  });
  it("defaults Kashmir/Sindhi to Arabic, Meitei to Mayek, Santali to Ol Chiki", () => {
    expect(localeMetadata("ks")).toMatchObject({ script: "Arab", dir: "rtl" });
    expect(localeMetadata("sd")).toMatchObject({ script: "Arab", dir: "rtl" });
    expect(localeMetadata("ur").dir).toBe("rtl");
    expect(localeMetadata("mni")).toMatchObject({ script: "Mtei", dir: "ltr" });
    expect(localeMetadata("sat")).toMatchObject({ script: "Olck", dir: "ltr" });
  });
  it("interpolates a whole sentence and falls back safely for unknown locales", () => {
    expect(translate("en", "loadSummary", { loads: 2, kg: 2000 })).toBe("2 loads/trips for 2000 kg in total.");
    expect(translate("unknown", "quantity")).toBe("Quantity");
  });
});
