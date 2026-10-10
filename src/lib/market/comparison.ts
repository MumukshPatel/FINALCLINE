import { calculateLoads, compareMarkets, convertQuantity, type ConfirmedPayload, type QuantityInput } from "../calculator";
import { SYNTHETIC_AS_OF_EPOCH_MS } from "../demo/synthetic-fixtures";
import { marketAssumptionKey, type MarketRecord } from "./index";
import { createMarketForm, formSellingExpenses, formTransport, numeric, type FarmerForm, type MarketForm } from "./form";

export function formQuantityAndLoads(form: FarmerForm) {
  const quantity: QuantityInput = form.unit === "bag"
    ? { unit: "bag", value: numeric(form.quantity) ?? NaN, kgPerBag: numeric(form.kgPerBag) }
    : { unit: form.unit, value: numeric(form.quantity) ?? NaN };
  const payload = convertQuantity({ unit: form.payloadUnit, value: numeric(form.payload) ?? NaN });
  const confirmedPayload: ConfirmedPayload = form.payloadConfirmed ? { status: "confirmed", usablePayloadKg: payload.value?.totalKg ?? NaN } : { status: "unknown" };
  const normalized = convertQuantity(quantity);
  const loads = calculateLoads(normalized.value?.totalKg ?? null, confirmedPayload);
  return { input: quantity, payload: confirmedPayload, quantity: normalized.value, loads: loads.value, missingAssumptions: [...normalized.missingAssumptions, ...loads.missingAssumptions] };
}

export function farmerComparison(
  form: FarmerForm, assumptions: Record<string, MarketForm>, records: MarketRecord[],
  scenario: "reportedModal" | "reportedMinimum", mode: "reported" | "synthetic", actualEpochMs: number,
) {
  const quantityAndLoads = formQuantityAndLoads(form);
  const crop = records.find((record) => record.cropId === form.cropId)?.observation.crop ?? form.cropId;
  const variety = records.find((record) => record.varietyId === form.varietyId)?.observation.variety ?? form.varietyId;
  return compareMarkets({
    scenario, quantity: quantityAndLoads.input, payload: quantityAndLoads.payload,
    crop, variety, grade: form.grade, dataset: mode,
    freshness: { asOfEpochMs: mode === "synthetic" ? SYNTHETIC_AS_OF_EPOCH_MS : actualEpochMs, maxAgeDays: 2 },
    markets: records.map((record) => {
      const entry = assumptions[marketAssumptionKey(record)] ?? createMarketForm(record);
      return { observation: record.observation, transport: formTransport(entry), sellingExpenses: formSellingExpenses(entry) };
    }),
  });
}
