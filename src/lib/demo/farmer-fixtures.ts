import type { SellingExpenseInput } from "../calculator";
import type { MarketRecord } from "../market";
import { createSyntheticComparison } from "./synthetic-fixtures";

export function syntheticItemizedExpenses(): SellingExpenseInput {
  return { status: "itemized", items: [
    { category: "loading", status: "amount", amount: 200, basis: "fixed-total" },
    { category: "unloading", status: "amount", amount: 150, basis: "fixed-total" },
    { category: "weighing", status: "zero" },
    { category: "packaging", status: "zero" },
    { category: "commission", status: "zero" },
    { category: "otherSelling", status: "amount", amount: 50, basis: "fixed-total" },
  ] };
}
export function syntheticFarmerRecords(): MarketRecord[] {
  return createSyntheticComparison().markets.map((market) => ({
    observation: market.observation, cropId: "demo-crop", varietyId: "demo-variety",
    location: null, coordinates: null, roadDistance: null, retrievedAt: null,
    demoDefaults: { transport: market.transport, sellingExpenses: syntheticItemizedExpenses() },
  }));
}
