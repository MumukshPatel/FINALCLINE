import type { AssumptionIssue, CalculationStatus, ExpenseInput } from "./types";
import { decimal } from "./arithmetic";

export const MAX_MONEY = Number.MAX_SAFE_INTEGER / 100;

const fieldLabels: Record<string, string> = {
  quantity: "Quantity", kgPerBag: "Weight per bag (kg)", totalKg: "Total quantity (kg)",
  usablePayloadKg: "Usable payload (kg)", loads: "Load count",
  outboundKm: "Outbound distance (km)", returnKm: "Return distance (km)",
  loadedKmPerLitre: "Loaded mileage (km/litre)", emptyKmPerLitre: "Empty-return mileage (km/litre)",
  fuelPricePerLitre: "Fuel price (₹/litre)", driver: "Driver costs", toll: "Toll costs",
  other: "Other transport costs", hireQuote: "Hire quote", sellingExpenses: "Farmer-borne selling expenses",
  "additional.fuel": "Additional fuel costs", "additional.driver": "Additional driver costs",
  "additional.toll": "Additional toll costs", "additional.other": "Additional other transport costs",
  "reported-modal.pricePerQuintal": "Reported modal price (₹/quintal)",
  "reported-minimum.pricePerQuintal": "Reported minimum price (₹/quintal)",
};
function label(field: string): string {
  return fieldLabels[field] ?? field.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[.-]/g, " ");
}

export function issue(
  field: string, message: string, kind: AssumptionIssue["kind"] = "invalid",
): AssumptionIssue {
  return { kind, field, message };
}

export function finiteNumber(
  value: number | null, field: string, issues: AssumptionIssue[],
  positive: boolean, maximum = Number.MAX_SAFE_INTEGER,
): number | null {
  if (value === null || value === undefined) {
    issues.push(issue(field, `${label(field)} must be entered.`, "missing"));
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value) ||
      (positive ? value <= 0 : value < 0) || value > maximum) {
    issues.push(issue(field, `${label(field)} must be a finite ${positive ? "positive" : "non-negative"} number within the supported range.`));
    return null;
  }
  return value;
}

/** Round to nearest paise, half away from zero, at reported monetary lines only. */
export function money(value: number, field: string, issues: AssumptionIssue[]): number | null {
  if (!Number.isFinite(value) || Math.abs(value) > MAX_MONEY) {
    issues.push(issue(field, `${label(field)} exceeds the supported monetary range.`));
    return null;
  }
  return decimal(value).toDecimalPlaces(2).toNumber();
}

export function expense(
  input: ExpenseInput | undefined, field: string, issues: AssumptionIssue[],
): number | null {
  if (!input || input.status === "unknown") {
    issues.push(issue(field, `Confirm total ${label(field).toLowerCase()}, including an explicit zero when applicable.`, "missing"));
    return null;
  }
  if (input.status !== "confirmed") {
    issues.push(issue(field, `${label(field)} has an invalid confirmation status.`));
    return null;
  }
  const value = finiteNumber(input.total, field, issues, false, MAX_MONEY);
  return value === null ? null : money(value, field, issues);
}

export function status(issues: AssumptionIssue[]): CalculationStatus {
  return issues.some((item) => item.kind === "invalid") ? "invalid"
    : issues.length ? "incomplete" : "complete";
}
