import type { TransportBreakdown, TransportCategory, TransportInput } from "./types";
import { expense, finiteNumber, issue, money } from "./validation";
import { decimal } from "./arithmetic";

const categories: TransportCategory[] = ["fuel", "driver", "toll", "other"];

export function calculateTransport(input: TransportInput, loads: number | null): TransportBreakdown {
  const result: TransportBreakdown = {
    mode: input.mode, loads, outboundKm: null,
    returnDistance: { assumption: "unknown", km: null, description: "Return distance is unconfirmed." },
    fuelLitres: null, fuelCost: null, quoteBasis: null, quoteCost: null,
    inclusions: null, additionalCosts: { fuel: null, driver: null, toll: null, other: null },
    total: null, missingAssumptions: [],
  };
  const issues = result.missingAssumptions;
  const validLoads = finiteNumber(loads, "loads", issues, true);
  if (validLoads !== null && !Number.isSafeInteger(validLoads)) {
    issues.push(issue("loads", "Loads must be a positive safe integer."));
  }

  if (input.mode === "owned") {
    const outbound = finiteNumber(input.outboundKm, "outboundKm", issues, false);
    result.outboundKm = outbound;
    let returnKm: number | null = null;
    if (input.returnDistance.assumption === "same-as-outbound") {
      returnKm = outbound;
      result.returnDistance = {
        assumption: "same-as-outbound", km: returnKm,
        description: "For every load/trip, empty return distance is assumed equal to outbound distance.",
      };
    } else if (input.returnDistance.assumption === "entered") {
      returnKm = finiteNumber(input.returnDistance.km, "returnKm", issues, false);
      result.returnDistance = {
        assumption: "entered", km: returnKm,
        description: "For every load/trip, empty return uses the separately entered return distance.",
      };
    } else {
      issues.push(issue("returnDistance", "Enter return distance or explicitly confirm equal outbound and return distances.",
        input.returnDistance.assumption === "unknown" ? "missing" : "invalid"));
    }
    const loadedMileage = finiteNumber(input.loadedKmPerLitre, "loadedKmPerLitre", issues, true);
    const emptyMileage = finiteNumber(input.emptyKmPerLitre, "emptyKmPerLitre", issues, true);
    const fuelPrice = finiteNumber(input.fuelPricePerLitre, "fuelPricePerLitre", issues, true);
    if (validLoads !== null && Number.isSafeInteger(validLoads) && outbound !== null &&
        returnKm !== null && loadedMileage !== null && emptyMileage !== null) {
      const fuel = decimal(validLoads).mul(decimal(outbound).div(loadedMileage).plus(decimal(returnKm).div(emptyMileage)));
      const litres = fuel.toNumber();
      if (!Number.isFinite(litres) || litres > Number.MAX_SAFE_INTEGER) {
        issues.push(issue("fuelLitres", "Fuel calculation exceeds the supported range."));
      } else {
        result.fuelLitres = litres;
        if (fuelPrice !== null) result.fuelCost = money(fuel.mul(fuelPrice).toNumber(), "fuelCost", issues);
      }
    }
    result.additionalCosts.fuel = 0; // Not applicable: owned fuel is already itemized above.
    result.additionalCosts.driver = expense(input.driver, "driver", issues);
    result.additionalCosts.toll = expense(input.toll, "toll", issues);
    result.additionalCosts.other = expense(input.other, "other", issues);
    if (!issues.length && result.fuelCost !== null) {
      result.total = money(decimal(result.fuelCost).plus(result.additionalCosts.driver!).plus(
        result.additionalCosts.toll!).plus(result.additionalCosts.other!).toNumber(), "transportTotal", issues);
    }
  } else if (input.mode === "hired") {
    result.quoteBasis = input.quoteBasis;
    result.inclusions = { ...input.inclusions };
    result.returnDistance.description = "A per-load quote covers one round-trip load; a whole-job quote applies once to the agreed job.";
    const quote = expense(input.quote, "hireQuote", issues);
    if (input.quoteBasis === "whole-job") {
      result.quoteCost = quote;
    } else if (input.quoteBasis === "per-round-trip-load") {
      if (quote !== null && validLoads !== null && Number.isSafeInteger(validLoads)) {
        result.quoteCost = money(decimal(quote).mul(validLoads).toNumber(), "hireQuoteTotal", issues);
      }
    } else {
      issues.push(issue("quoteBasis", "Choose a whole-job or per-round-trip-load quote."));
    }
    for (const category of categories) {
      const inclusion = input.inclusions[category];
      if (inclusion === "included") {
        // The category is bundled into the quote. Never add supplemental fuel or fees again.
        result.additionalCosts[category] = 0;
      } else if (inclusion === "excluded") {
        result.additionalCosts[category] = expense(input.additionalCosts[category], `additional.${category}`, issues);
      } else {
        issues.push(issue(`inclusions.${category}`, `Confirm whether the hire quote includes ${category}.`,
          inclusion === "unknown" || inclusion === undefined ? "missing" : "invalid"));
      }
    }
    if (input.inclusions.fuel === "excluded") result.fuelCost = result.additionalCosts.fuel;
    if (!issues.length && result.quoteCost !== null) {
      result.total = money(categories.reduce((sum, category) =>
        sum.plus(result.additionalCosts[category]!), decimal(result.quoteCost)).toNumber(), "transportTotal", issues);
    }
  } else {
    issues.push(issue("transport", "Confirm an owned or hired transport arrangement.",
      input.mode === "unknown" ? "missing" : "invalid"));
  }
  return result;
}
