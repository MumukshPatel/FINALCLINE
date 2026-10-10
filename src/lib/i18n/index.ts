import baseEn from "./en.json";
import { simplifiedLabels } from "./simplified";
import as from "./locales/as.json"; import bn from "./locales/bn.json"; import brx from "./locales/brx.json";
import doi from "./locales/doi.json"; import gu from "./locales/gu.json"; import hi from "./locales/hi.json";
import kn from "./locales/kn.json"; import ks from "./locales/ks.json"; import gom from "./locales/gom.json";
import mai from "./locales/mai.json"; import ml from "./locales/ml.json"; import mni from "./locales/mni.json";
import mr from "./locales/mr.json"; import ne from "./locales/ne.json"; import or from "./locales/or.json";
import pa from "./locales/pa.json"; import sa from "./locales/sa.json"; import sat from "./locales/sat.json";
import sd from "./locales/sd.json"; import ta from "./locales/ta.json"; import te from "./locales/te.json"; import ur from "./locales/ur.json";
import type { AssumptionIssue, ExclusionReason } from "../calculator";

const en = { ...baseEn, ...simplifiedLabels.en };
export type TranslationKey = keyof typeof en;
export const dictionaries: Record<string, Partial<Record<TranslationKey, string>>> = Object.fromEntries(Object.entries({ en, as, bn, brx, doi, gu, hi, kn, ks, gom, mai, ml, mni, mr, ne, or, pa, sa, sat, sd, ta, te, ur }).map(([id, dictionary]) => [id, { ...dictionary, ...simplifiedLabels[id] }]));
export const ESSENTIAL_KEYS = Object.keys(en) as TranslationKey[];
export const LANGUAGE_STORAGE_KEY = "mandinet.language";
export type Locale = { id: string; name: string; englishName: string; script: string; dir: "ltr" | "rtl"; tag: string };
export const locales: Locale[] = [
  { id: "en", name: "English", englishName: "English", script: "Latn", dir: "ltr", tag: "en-IN" },
  { id: "as", name: "অসমীয়া", englishName: "Assamese", script: "Beng", dir: "ltr", tag: "as-IN" },
  { id: "bn", name: "বাংলা", englishName: "Bengali", script: "Beng", dir: "ltr", tag: "bn-IN" },
  { id: "brx", name: "बड़ो", englishName: "Bodo", script: "Deva", dir: "ltr", tag: "brx-Deva-IN" },
  { id: "doi", name: "डोगरी", englishName: "Dogri", script: "Deva", dir: "ltr", tag: "doi-Deva-IN" },
  { id: "gu", name: "ગુજરાતી", englishName: "Gujarati", script: "Gujr", dir: "ltr", tag: "gu-IN" },
  { id: "hi", name: "हिन्दी", englishName: "Hindi", script: "Deva", dir: "ltr", tag: "hi-IN" },
  { id: "kn", name: "ಕನ್ನಡ", englishName: "Kannada", script: "Knda", dir: "ltr", tag: "kn-IN" },
  { id: "ks", name: "کٲشُر", englishName: "Kashmiri", script: "Arab", dir: "rtl", tag: "ks-Arab-IN" },
  { id: "gom", name: "कोंकणी", englishName: "Konkani", script: "Deva", dir: "ltr", tag: "gom-Deva-IN" },
  { id: "mai", name: "मैथिली", englishName: "Maithili", script: "Deva", dir: "ltr", tag: "mai-Deva-IN" },
  { id: "ml", name: "മലയാളം", englishName: "Malayalam", script: "Mlym", dir: "ltr", tag: "ml-IN" },
  { id: "mni", name: "ꯃꯤꯇꯩꯂꯣꯟ", englishName: "Manipuri / Meitei", script: "Mtei", dir: "ltr", tag: "mni-Mtei-IN" },
  { id: "mr", name: "मराठी", englishName: "Marathi", script: "Deva", dir: "ltr", tag: "mr-IN" },
  { id: "ne", name: "नेपाली", englishName: "Nepali", script: "Deva", dir: "ltr", tag: "ne-IN" },
  { id: "or", name: "ଓଡ଼ିଆ", englishName: "Odia", script: "Orya", dir: "ltr", tag: "or-IN" },
  { id: "pa", name: "ਪੰਜਾਬੀ", englishName: "Punjabi", script: "Guru", dir: "ltr", tag: "pa-Guru-IN" },
  { id: "sa", name: "संस्कृतम्", englishName: "Sanskrit", script: "Deva", dir: "ltr", tag: "sa-IN" },
  { id: "sat", name: "ᱥᱟᱱᱛᱟᱲᱤ", englishName: "Santali", script: "Olck", dir: "ltr", tag: "sat-Olck-IN" },
  { id: "sd", name: "سنڌي", englishName: "Sindhi", script: "Arab", dir: "rtl", tag: "sd-Arab-IN" },
  { id: "ta", name: "தமிழ்", englishName: "Tamil", script: "Taml", dir: "ltr", tag: "ta-IN" },
  { id: "te", name: "తెలుగు", englishName: "Telugu", script: "Telu", dir: "ltr", tag: "te-IN" },
  { id: "ur", name: "اردو", englishName: "Urdu", script: "Arab", dir: "rtl", tag: "ur-IN" },
];

export function localeMetadata(id: string): Locale { return locales.find((locale) => locale.id === id) ?? locales[0]; }
const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort().join(",");
export function dictionaryIssues(id: string): { missing: TranslationKey[]; placeholderMismatch: TranslationKey[] } {
  const dictionary = dictionaries[id] ?? {};
  return {
    missing: ESSENTIAL_KEYS.filter((key) => !dictionary[key]?.trim()),
    placeholderMismatch: ESSENTIAL_KEYS.filter((key) => !!dictionary[key] && placeholders(dictionary[key]!) !== placeholders(en[key])),
  };
}
export function isPartial(id: string): boolean {
  const report = dictionaryIssues(id); return !!(report.missing.length || report.placeholderMismatch.length);
}
export function translate(id: string, key: TranslationKey, values: Record<string, string | number> = {}): string {
  const candidate = dictionaries[id]?.[key];
  const text = candidate && placeholders(candidate) === placeholders(en[key]) ? candidate : en[key];
  return text.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? `{${name}}`));
}
export function formatMoney(id: string, value: number | null): string {
  if (value === null || !Number.isFinite(value)) return translate(id, "unavailable");
  return new Intl.NumberFormat(localeMetadata(id).tag, { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value);
}
export function formatDate(id: string, value: string | null, includeTime = false): string {
  if (!value) return translate(id, "unavailable");
  const date = new Date(value.length === 10 ? `${value}T12:00:00+05:30` : value);
  if (!Number.isFinite(date.valueOf())) return translate(id, "unavailable");
  return new Intl.DateTimeFormat(localeMetadata(id).tag, {
    timeZone: "Asia/Kolkata", year: "numeric", month: "long", day: "numeric",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit" } as const : {}),
  }).format(date);
}
export function assumptionText(id: string, item: AssumptionIssue): string {
  const fieldKeys: Record<string, TranslationKey> = {
    quantity: "quantity", totalKg: "quantity", kgPerBag: "kgPerBag", usablePayloadKg: "payload", loads: "loads",
    outboundKm: "outbound", returnKm: "returnDistance", returnDistance: "returnDistance", loadedKmPerLitre: "loadedMileage",
    emptyKmPerLitre: "emptyMileage", fuelPricePerLitre: "fuelPrice", driver: "driver", toll: "toll", other: "other",
    hireQuote: "quote", quoteBasis: "transportMode", sellingExpenses: "selling", transport: "transportMode",
    "reported-modal.pricePerQuintal": "modalPrice", "reported-minimum.pricePerQuintal": "minimumPrice",
  };
  const last = item.field.split(".").at(-1)!;
  const key = fieldKeys[item.field] ?? (ESSENTIAL_KEYS.includes(last as TranslationKey) ? last as TranslationKey : "input");
  return translate(id, item.kind === "missing" ? "missingInput" : "invalidInput", { field: translate(id, key) });
}
export function exclusionText(id: string, reason: ExclusionReason, ageDays: number | null): string {
  const keys: Record<ExclusionReason["code"], TranslationKey> = {
    stale_observation: "reasonStale", unknown_price_unit: "reasonUnit", crop_mismatch: "reasonCrop", variety_mismatch: "reasonVariety",
    grade_mismatch: "reasonGrade", invalid_record: "reasonInvalid", invalid_prices: "reasonInvalid", invalid_date: "reasonDate",
    future_observation: "reasonDate", invalid_freshness_policy: "reasonFreshness", dataset_mismatch: "reasonDataset",
    incomplete_estimate: "reasonIncomplete", outside_road_limit: "routingNotice", missing_selected_price: "reasonMissingPrice",
  };
  return translate(id, keys[reason.code], { days: ageDays ?? "?" });
}
