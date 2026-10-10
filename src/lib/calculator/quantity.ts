import type { CalculationResult, ConfirmedPayload, NormalizedQuantity, QuantityInput } from "./types";
import { finiteNumber, issue } from "./validation";
import { decimal } from "./arithmetic";

export function convertQuantity(input: QuantityInput): CalculationResult<NormalizedQuantity> {
  const missingAssumptions = [] as CalculationResult<NormalizedQuantity>["missingAssumptions"];
  const value = finiteNumber(input.value, "quantity", missingAssumptions, true);
  let multiplier: number | null;
  switch (input.unit) {
    case "kg": multiplier = 1; break;
    case "quintal": multiplier = 100; break;
    case "tonne": multiplier = 1000; break;
    case "bag": multiplier = finiteNumber(input.kgPerBag, "kgPerBag", missingAssumptions, true); break;
    default:
      multiplier = null;
      missingAssumptions.push(issue("quantity.unit", "Choose kg, quintal, tonne or bag."));
  }
  if (value === null || multiplier === null) return { value: null, missingAssumptions };
  const totalKg = decimal(value).mul(multiplier).toNumber();
  if (!Number.isFinite(totalKg) || totalKg > Number.MAX_SAFE_INTEGER || totalKg <= 0) {
    return { value: null, missingAssumptions: [issue("quantity", "Converted quantity exceeds the supported range.")] };
  }
  return { value: { totalKg, quantityInQuintals: decimal(totalKg).div(100).toNumber() }, missingAssumptions };
}

export function calculateLoads(totalKg: number | null, payload: ConfirmedPayload): CalculationResult<number> {
  const missingAssumptions = [] as CalculationResult<number>["missingAssumptions"];
  const kg = finiteNumber(totalKg, "totalKg", missingAssumptions, true);
  let usablePayloadKg: number | null = null;
  if (payload.status === "unknown") {
    missingAssumptions.push(issue("usablePayloadKg", "Confirm the usable payload in kg.", "missing"));
  } else if (payload.status === "confirmed") {
    usablePayloadKg = finiteNumber(payload.usablePayloadKg, "usablePayloadKg", missingAssumptions, true);
  } else {
    missingAssumptions.push(issue("usablePayloadKg", "Payload has an invalid confirmation status."));
  }
  if (kg === null || usablePayloadKg === null) return { value: null, missingAssumptions };
  const loads = decimal(kg).div(usablePayloadKg).ceil().toNumber();
  if (!Number.isSafeInteger(loads) || loads <= 0) {
    missingAssumptions.push(issue("loads", "Load count exceeds the supported range."));
    return { value: null, missingAssumptions };
  }
  return { value: loads, missingAssumptions };
}
