import {
  SELLING_CATEGORIES, type ChargingBasis, type QuantityInput, type QuoteInclusion,
  type SellingCategory, type SellingExpenseInput, type SellingExpenseRow, type TransportInput,
} from "../calculator";
import type { MarketRecord } from "./index";

export type ExpenseForm = { status: "amount" | "zero" | "included" | "unknown"; value: string; basis: ChargingBasis; includedIn: "transport" | SellingCategory };
export type MarketForm = {
  mode: "unselected" | "owned" | "hired-job" | "hired-load";
  quote: string;
  inclusions: Record<"fuel" | "driver" | "toll" | "other", QuoteInclusion>;
  extras: Record<"fuel" | "driver" | "toll" | "other", string>;
  outbound: string; returnKm: string; sameReturn: boolean;
  distanceMethod: "manual" | "fetched" | null;
  returnDistanceMethod?: "manual" | "fetched" | null;
  loadedMileage: string; emptyMileage: string; fuelPrice: string; fuelType: "diesel" | "petrol" | "otherFuel";
  driver: string; toll: string; other: string;
  expenses: Record<SellingCategory, ExpenseForm>;
};
export type FarmerForm = {
  stateId: string; districtId: string; village: string; cropId: string; varietyId: string; grade: string;
  quantity: string; unit: QuantityInput["unit"]; kgPerBag: string;
  payload: string; payloadUnit: "kg" | "quintal" | "tonne"; payloadConfirmed: boolean;
  distanceLimit: string; customDistance: string;
};
export const numeric = (value: string): number | null => value.trim() === "" ? null : Number(value);
const confirmed = (value: string) => numeric(value) === null ? { status: "unknown" as const }
  : { status: "confirmed" as const, total: numeric(value)! };
export function emptyFarmerForm(): FarmerForm {
  return { stateId: "", districtId: "", village: "", cropId: "", varietyId: "", grade: "", quantity: "", unit: "quintal", kgPerBag: "",
    payload: "", payloadUnit: "kg", payloadConfirmed: false, distanceLimit: "50", customDistance: "" };
}
export function demoFarmerForm(): FarmerForm {
  return { ...emptyFarmerForm(), cropId: "demo-crop", varietyId: "demo-variety", quantity: "20", payload: "1500", payloadConfirmed: true };
}
export function createMarketForm(record?: MarketRecord): MarketForm {
  const expenses = Object.fromEntries(SELLING_CATEGORIES.map((category) => [category, {
    status: "unknown", value: "", basis: "fixed-total", includedIn: "transport",
  }])) as MarketForm["expenses"];
  const defaults = record?.observation.dataKind === "synthetic" ? record.demoDefaults?.sellingExpenses : undefined;
  if (defaults?.status === "itemized") for (const row of defaults.items) expenses[row.category] = {
    status: row.status, value: row.status === "amount" ? String(row.amount) : "",
    basis: row.status === "amount" ? row.basis : "fixed-total", includedIn: row.status === "included" ? row.includedIn : "transport",
  };
  const quote = record?.observation.dataKind === "synthetic" ? record.demoDefaults?.transport : undefined;
  return {
    mode: quote ? "hired-job" : "unselected", quote: quote?.mode === "hired" && quote.quote.status === "confirmed" ? String(quote.quote.total) : "",
    inclusions: quote?.mode === "hired" ? { ...quote.inclusions } : { fuel: "unknown", driver: "unknown", toll: "unknown", other: "unknown" },
    extras: { fuel: "", driver: "", toll: "", other: "" },
    outbound: record?.roadDistance ? String(record.roadDistance.km) : "", distanceMethod: record?.roadDistance?.method ?? null, returnKm: "", sameReturn: false,
    loadedMileage: "", emptyMileage: "", fuelPrice: "", fuelType: "diesel", driver: "", toll: "", other: "", expenses,
  };
}
export function formTransport(form: MarketForm): TransportInput {
  if (form.mode === "unselected") return { mode: "unknown" };
  return form.mode === "owned" ? {
    mode: "owned", outboundKm: numeric(form.outbound),
    returnDistance: form.sameReturn ? { assumption: "same-as-outbound" } : { assumption: "entered", km: numeric(form.returnKm) },
    loadedKmPerLitre: numeric(form.loadedMileage), emptyKmPerLitre: numeric(form.emptyMileage), fuelPricePerLitre: numeric(form.fuelPrice),
    driver: confirmed(form.driver), toll: confirmed(form.toll), other: confirmed(form.other),
  } : {
    mode: "hired", quoteBasis: form.mode === "hired-job" ? "whole-job" : "per-round-trip-load", quote: confirmed(form.quote),
    inclusions: { ...form.inclusions }, additionalCosts: Object.fromEntries(Object.entries(form.extras).map(([key, value]) => [key, confirmed(value)])),
  };
}
export function formSellingExpenses(form: MarketForm): SellingExpenseInput {
  return { status: "itemized", items: SELLING_CATEGORIES.map((category): SellingExpenseRow => {
    const row = form.expenses[category];
    return row.status === "amount" ? { category, status: "amount", amount: numeric(row.value) ?? NaN, basis: row.basis }
      : row.status === "included" ? { category, status: "included", includedIn: row.includedIn } : { category, status: row.status };
  }) };
}
export function changeParentSelection(form: FarmerForm, field: "stateId" | "districtId" | "cropId", value: string): FarmerForm {
  return field === "stateId" ? { ...form, stateId: value, districtId: "", village: "" }
    : field === "districtId" ? { ...form, districtId: value, village: "" }
    : { ...form, cropId: value, varietyId: "", grade: "" };
}
