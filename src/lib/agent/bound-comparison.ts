import { randomUUID } from "node:crypto";
import { SELLING_CATEGORIES } from "../calculator";
import { syntheticFarmerRecords } from "../demo/farmer-fixtures";
import { SYNTHETIC_AS_OF_EPOCH_MS } from "../demo/synthetic-fixtures";
import { locales } from "../i18n";
import { farmerComparison } from "../market/comparison";
import { emptyFarmerForm, createMarketForm, type FarmerForm, type MarketForm } from "../market/form";
import { marketAssumptionKey, type MarketRecord } from "../market";
import { calendarDate, kolkataToday } from "../market/normalization";
import { readObservationSnapshot } from "./snapshots";
import { comparisonProjection, type ExplanationInput } from "./comparison";

function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_COMPARISON"); return value as Record<string, unknown>; }
function keys(row: Record<string, unknown>, allowed: string[]) { if (Object.keys(row).some(key => !allowed.includes(key))) throw new Error("INVALID_COMPARISON"); }
function choice(value: unknown, allowed: (string | null)[]): void { if (!allowed.includes(value as string)) throw new Error("INVALID_COMPARISON"); }
function text(value: unknown, max = 256): void { if (typeof value !== "string" || value.length > max) throw new Error("INVALID_COMPARISON"); }
function numericText(value: unknown): void { text(value, 64); if ((value as string).trim() && !Number.isFinite(Number(value))) throw new Error("INVALID_COMPARISON"); }
function validateForm(value: unknown) {
  const form = object(value); keys(form, Object.keys(emptyFarmerForm()));
  for (const key of ["stateId", "districtId", "village", "cropId", "varietyId", "grade"]) text(form[key]);
  // Precise/personal origin content is not needed by this agent.
  if (form.village !== "") throw new Error("INVALID_COMPARISON");
  for (const key of ["quantity", "kgPerBag", "payload", "customDistance"]) numericText(form[key]);
  choice(form.unit, ["kg", "quintal", "tonne", "bag"]); choice(form.payloadUnit, ["kg", "quintal", "tonne"]);
  choice(form.distanceLimit, ["25", "50", "100", "custom"]); if (typeof form.payloadConfirmed !== "boolean") throw new Error("INVALID_COMPARISON");
}
function validateMarket(value: unknown) {
  const form = object(value); keys(form, [...Object.keys(createMarketForm()), "returnDistanceMethod"]);
  choice(form.mode, ["unselected", "owned", "hired-job", "hired-load"]); choice(form.fuelType, ["diesel", "petrol", "otherFuel"]);
  choice(form.distanceMethod, ["manual", "fetched", null]); if (form.returnDistanceMethod !== undefined) choice(form.returnDistanceMethod, ["manual", "fetched", null]);
  if (typeof form.sameReturn !== "boolean") throw new Error("INVALID_COMPARISON");
  for (const key of ["quote", "outbound", "returnKm", "loadedMileage", "emptyMileage", "fuelPrice", "driver", "toll", "other"]) numericText(form[key]);
  const inclusions = object(form.inclusions), extras = object(form.extras); keys(inclusions, ["fuel", "driver", "toll", "other"]); keys(extras, ["fuel", "driver", "toll", "other"]);
  for (const category of ["fuel", "driver", "toll", "other"]) { choice(inclusions[category], ["included", "excluded", "unknown"]); numericText(extras[category]); }
  const expenses = object(form.expenses); keys(expenses, SELLING_CATEGORIES);
  for (const category of SELLING_CATEGORIES) { const row = object(expenses[category]); keys(row, ["status", "value", "basis", "includedIn"]); choice(row.status, ["amount", "zero", "included", "unknown"]); numericText(row.value); choice(row.basis, ["fixed-total", "per-kg", "per-quintal", "per-load"]); choice(row.includedIn, ["transport", ...SELLING_CATEGORIES]); }
}
export function bindComparison(raw: unknown, owner: string | null, now = Date.now()) {
  const body = object(raw); keys(body, ["mode", "scenario", "language", "observationSnapshotId", "recordIds", "form", "assumptions", "asOfEpochMs", "pricesAsOn", "expected", "suppressBest"]);
  choice(body.mode, ["reported", "synthetic"]); choice(body.scenario, ["reportedModal", "reportedMinimum"]);
  if (!locales.some(x => x.id === body.language) || typeof body.suppressBest !== "boolean") throw new Error("INVALID_COMPARISON");
  validateForm(body.form); const assumptions = object(body.assumptions);
  if (!Array.isArray(body.recordIds) || !body.recordIds.length || body.recordIds.length > 20 || new Set(body.recordIds).size !== body.recordIds.length) throw new Error("INVALID_COMPARISON");
  body.recordIds.forEach(id => text(id));
  const source = body.mode === "synthetic" ? { records: syntheticFarmerRecords(), providerId: "labelled-synthetic-demo" } : readObservationSnapshot(body.observationSnapshotId, owner);
  const records = (body.recordIds as string[]).map(id => { const record = source.records.find(x => x.observation.id === id); if (!record || record.observation.dataKind !== body.mode) throw new Error("INVALID_COMPARISON"); return record; });
  keys(assumptions, records.map(marketAssumptionKey));
  for (const record of records) validateMarket(assumptions[marketAssumptionKey(record)]);
  const input = structuredClone(body) as unknown as ExplanationInput;
  let asOf = SYNTHETIC_AS_OF_EPOCH_MS;
  if (input.mode === "reported") {
    const date = calendarDate(input.pricesAsOn), today = kolkataToday(now);
    if (!date || date > today) throw new Error("INVALID_COMPARISON");
    asOf = date < today ? Date.parse(`${date}T12:00:00+05:30`) : input.asOfEpochMs;
    if (!Number.isFinite(asOf) || (date === today ? Math.abs(asOf - now) > 120_000 : input.asOfEpochMs !== asOf)) throw new Error("INVALID_COMPARISON");
  }
  const calculate = () => farmerComparison(input.form as FarmerForm, input.assumptions as Record<string, MarketForm>, records, input.scenario, input.mode, asOf);
  const baseline = calculate(), lines = comparisonProjection(baseline, input.scenario);
  // Client values are parity checks, not authoritative prices or calculated money.
  if (JSON.stringify(lines) !== JSON.stringify(body.expected)) throw new Error("COMPARISON_CHANGED");
  const comparisonId = randomUUID(), calculationId = randomUUID();
  const bestObservationId = input.suppressBest ? null : baseline.rankings[input.scenario].bestObservationId;
  let read = false, calls = 0;
  function emptyArgs(args: unknown) { if (args !== undefined && Object.keys(object(args)).length) throw new Error("TOOLS_ACCEPT_NO_INPUTS"); if (++calls > 4) throw new Error("TOOL_LIMIT"); }
  return { input, comparisonId, calculationId, lines, bestObservationId,
    get_market_observations(args: unknown = {}) {
      emptyArgs(args); read = true;
      return { comparisonId, dataMode: input.mode, providerId: source.providerId, observations: records.map((record: MarketRecord, index) => ({ ...record.observation, sourceRecordId: record.provenance?.sourceRecordId ?? record.observation.id, acquisitionMode: record.provenance?.acquisitionMode ?? (record.observation.dataKind === "synthetic" ? "synthetic" : "reported-provider"), retrievedAt: record.retrievedAt, eligibility: lines[index].eligibility })) };
    },
    calculate_sale_scenarios(args: unknown = {}) {
      emptyArgs(args); if (!read) throw new Error("READ_OBSERVATIONS_FIRST");
      return { comparisonId, calculationId, dataMode: input.mode, selectedScenario: input.scenario, bestObservationId, lines: comparisonProjection(calculate(), input.scenario) };
    },
  };
}
