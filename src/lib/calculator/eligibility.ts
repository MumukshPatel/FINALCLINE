import type { ExclusionReason, FreshnessPolicy, MarketObservation, ObservationEligibility } from "./types";
import { MAX_MONEY } from "./validation";

const DAY_MS = 86_400_000;
const kolkataDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata", calendar: "gregory", year: "numeric", month: "2-digit", day: "2-digit",
});
export const DEMO_MAX_AGE_DAYS = 2;

function dateOrdinal(date: string): number | null {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [year, month, day] = date.split("-").map(Number);
  if (year < 100) return null;
  const time = Date.UTC(year, month - 1, day);
  const parsed = new Date(time);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
  return time / DAY_MS;
}

function referenceOrdinal(asOfEpochMs: number): number | null {
  if (typeof asOfEpochMs !== "number" || !Number.isFinite(asOfEpochMs) ||
      Math.abs(asOfEpochMs) > 8.64e15) return null;
  const parts = kolkataDate.formatToParts(new Date(asOfEpochMs));
  const part = (key: string) => parts.find((entry) => entry.type === key)?.value;
  return dateOrdinal(`${part("year")}-${part("month")}-${part("day")}`);
}

function normalized(value: string): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function evaluateObservation(
  observation: MarketObservation,
  expected: { crop: string; variety: string; grade?: string; scenario?: "reportedModal" | "reportedMinimum"; dataset?: MarketObservation["dataKind"] },
  freshness: FreshnessPolicy,
): ObservationEligibility {
  const exclusionReasons: ExclusionReason[] = [];
  const add = (code: ExclusionReason["code"], message: string) => exclusionReasons.push({ code, message });
  if (![observation.id, observation.marketId, observation.marketLabel, observation.sourceLabel,
        observation.crop, observation.variety, expected.crop, expected.variety].every((value) => normalized(value)) ||
      observation.priceUnit !== "INR/quintal" ||
      !["reported", "synthetic"].includes(observation.dataKind) ||
      (expected.dataset !== undefined && !["reported", "synthetic"].includes(expected.dataset))) {
    add("invalid_record", "Record identifiers, crop, variety, provenance and INR/quintal unit must be valid.");
  }
  if (observation.sourceUrl !== null) {
    try {
      const url = new URL(observation.sourceUrl);
      if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Invalid protocol");
    } catch {
      add("invalid_record", "The provided source URL must be an absolute HTTP(S) URL.");
    }
  }
  if (normalized(observation.crop) !== normalized(expected.crop)) add("crop_mismatch", "Crop does not match the selected crop.");
  if (normalized(observation.variety) !== normalized(expected.variety)) add("variety_mismatch", "Variety does not match the selected variety.");
  if (observation.grade && normalized(observation.grade) !== normalized(expected.grade ?? "")) add("grade_mismatch", "Reported grade does not match the selected grade.");
  if (observation.priceUnit !== "INR/quintal") add("unknown_price_unit", "Price unit is unavailable or unsupported; no financial comparison can be calculated.");
  if (observation.dataKind !== (expected.dataset ?? "reported")) add("dataset_mismatch", "Synthetic and reported observations are ranked separately.");
  const prices = [observation.modalPricePerQuintal, observation.minimumPricePerQuintal];
  const selectedPrice = expected.scenario === "reportedModal" ? observation.modalPricePerQuintal : observation.minimumPricePerQuintal;
  if (expected.scenario && selectedPrice === null) add("missing_selected_price", "The selected reported price is unavailable.");
  if (!(expected.scenario ? prices.filter((price) => price !== null) : prices).every((price) => typeof price === "number" && Number.isFinite(price) && price > 0 && price <= MAX_MONEY) ||
      (observation.minimumPricePerQuintal !== null && observation.modalPricePerQuintal !== null && observation.minimumPricePerQuintal > observation.modalPricePerQuintal)) {
    add("invalid_prices", "Require valid positive reported modal and minimum prices, with minimum no greater than modal.");
  }
  const observedOrdinal = dateOrdinal(observation.observationDate);
  if (observedOrdinal === null) add("invalid_date", "Observation date must be a real YYYY-MM-DD date in Asia/Kolkata.");
  const asOfOrdinal = referenceOrdinal(freshness.asOfEpochMs);
  if (asOfOrdinal === null || !Number.isSafeInteger(freshness.maxAgeDays) || freshness.maxAgeDays < 0) {
    add("invalid_freshness_policy", "Freshness requires a valid explicit clock and a non-negative whole-day maximum age.");
  }
  const ageDays = observedOrdinal !== null && asOfOrdinal !== null ? asOfOrdinal - observedOrdinal : null;
  if (ageDays !== null && ageDays < 0) add("future_observation", "Observation is dated after the comparison date in Asia/Kolkata.");
  if (ageDays !== null && ageDays > freshness.maxAgeDays) add("stale_observation", `Observation is ${ageDays} Kolkata calendar days old; policy allows ${freshness.maxAgeDays}.`);
  return { eligible: exclusionReasons.length === 0, ageDays, exclusionReasons };
}
