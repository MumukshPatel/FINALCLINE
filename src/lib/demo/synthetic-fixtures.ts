import type { ComparisonInput, ExpenseInput, HiredTransport, QuoteInclusions } from "../calculator";

/** Entirely synthetic test/demo data. A and B are NOT verified real mandis. */
export const SYNTHETIC_LABEL = "Synthetic demonstration — not current government prices";
export const SYNTHETIC_DATE = "2000-01-07";
export const SYNTHETIC_AS_OF_EPOCH_MS = Date.parse("2000-01-08T12:00:00+05:30");
export const ALL_INCLUDED: QuoteInclusions = { fuel: "included", driver: "included", toll: "included", other: "included" };
export const confirmedExpense = (total: number): ExpenseInput => ({ status: "confirmed", total });
export const syntheticHire = (total: number): HiredTransport => ({
  mode: "hired", quoteBasis: "whole-job", quote: confirmedExpense(total),
  inclusions: { ...ALL_INCLUDED }, additionalCosts: {},
});

export function createSyntheticComparison(): ComparisonInput {
  return {
    quantity: { unit: "quintal", value: 20 },
    payload: { status: "confirmed", usablePayloadKg: 1500 },
    crop: "Demo crop", variety: "Demo variety", dataset: "synthetic",
    freshness: { asOfEpochMs: SYNTHETIC_AS_OF_EPOCH_MS, maxAgeDays: 2 },
    markets: [
      { id: "synthetic-a", marketId: "demo-a", marketLabel: "Demo A", modal: 2200, minimum: 2100, transport: 800 },
      { id: "synthetic-b", marketId: "demo-b", marketLabel: "Demo B", modal: 2250, minimum: 2120, transport: 2800 },
      { id: "synthetic-c", marketId: "demo-c", marketLabel: "Demo C", modal: 2200, minimum: 2100, transport: 800 },
    ].map((market) => ({
      observation: {
        id: market.id, marketId: market.marketId, marketLabel: market.marketLabel,
        crop: "Demo crop", variety: "Demo variety", observationDate: market.id === "synthetic-c" ? "2000-01-01" : SYNTHETIC_DATE,
        priceUnit: "INR/quintal", modalPricePerQuintal: market.modal,
        minimumPricePerQuintal: market.minimum, dataKind: "synthetic",
        sourceLabel: SYNTHETIC_LABEL, sourceUrl: null,
      },
      transport: syntheticHire(market.transport), sellingExpenses: confirmedExpense(400),
    })),
  };
}
