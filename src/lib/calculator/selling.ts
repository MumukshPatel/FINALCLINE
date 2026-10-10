import type { AssumptionIssue, NormalizedQuantity, SellingCategory, SellingExpenseInput, SellingExpenseLine } from "./types";
import { decimal } from "./arithmetic";
import { expense, finiteNumber, issue, money } from "./validation";

export const SELLING_CATEGORIES: SellingCategory[] = ["loading", "unloading", "weighing", "packaging", "commission", "otherSelling"];

/** Converts user-entered charging bases and resolves included rows without double deduction. */
export function calculateSellingExpenses(
  input: SellingExpenseInput, quantity: NormalizedQuantity | null, loads: number | null, transportTotal: number | null,
): { total: number | null; knownTotal: number; lines: SellingExpenseLine[]; missingAssumptions: AssumptionIssue[] } {
  const missingAssumptions: AssumptionIssue[] = [];
  if (input.status !== "itemized") {
    const total = expense(input, "sellingExpenses", missingAssumptions);
    return { total, knownTotal: total ?? 0, lines: [], missingAssumptions };
  }
  const lines: SellingExpenseLine[] = [];
  const byCategory = new Map(input.items.map((row) => [row.category, row]));
  if (byCategory.size !== input.items.length || input.items.some((row) => !SELLING_CATEGORIES.includes(row.category))) {
    missingAssumptions.push(issue("sellingExpenses", "Selling expense categories must be unique and valid."));
  }
  const resolving = new Set<SellingCategory>();
  const values = new Map<SellingCategory, number | null>();
  function resolve(category: SellingCategory): number | null {
    if (values.has(category)) return values.get(category)!;
    const row = byCategory.get(category);
    const field = `selling.${category}`;
    let value: number | null = null;
    if (!row || row.status === "unknown") {
      missingAssumptions.push(issue(field, `Confirm the ${category} expense, including an explicit zero where applicable.`, "missing"));
    } else if (row.status === "zero") value = 0;
    else if (row.status === "included") {
      if (resolving.has(category) || row.includedIn === category) {
        missingAssumptions.push(issue(field, "Included expenses cannot form a cycle or include themselves."));
      } else {
        resolving.add(category);
        const parent = row.includedIn === "transport" ? transportTotal
          : SELLING_CATEGORIES.includes(row.includedIn) ? resolve(row.includedIn) : null;
        resolving.delete(category);
        if (parent === null) missingAssumptions.push(issue(field, "Confirm the parent expense before including this charge in it.", "missing"));
        else value = 0;
      }
    } else if (row.status === "amount") {
      const amount = finiteNumber(row.amount, field, missingAssumptions, false);
      const multiplier = row.basis === "fixed-total" ? 1 : row.basis === "per-quintal" ? quantity?.quantityInQuintals
        : row.basis === "per-kg" ? quantity?.totalKg : row.basis === "per-load" ? loads : undefined;
      if (multiplier === null || multiplier === undefined) {
        missingAssumptions.push(issue(field, "Confirm a valid charging basis, quantity and loads before applying this expense.",
          ["fixed-total", "per-quintal", "per-kg", "per-load"].includes(row.basis) ? "missing" : "invalid"));
      } else if (amount !== null) value = money(decimal(amount).mul(multiplier).toNumber(), field, missingAssumptions);
    } else missingAssumptions.push(issue(field, "Choose a valid expense confirmation."));
    values.set(category, value);
    return value;
  }
  for (const category of SELLING_CATEGORIES) {
    const row = byCategory.get(category);
    lines.push({ category, total: resolve(category), status: row?.status ?? "unknown",
      ...(row?.status === "included" ? { includedIn: row.includedIn } : {}) });
  }
  const knownTotal = money(lines.reduce((sum, line) => sum.plus(line.total ?? 0), decimal(0)).toNumber(), "sellingExpenses", missingAssumptions) ?? 0;
  return { total: missingAssumptions.length ? null : knownTotal, knownTotal, lines, missingAssumptions };
}
