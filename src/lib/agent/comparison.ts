import type { MarketComparison } from "../calculator";
import type { FarmerForm, MarketForm } from "../market/form";

export type PriceScenario = "reportedModal" | "reportedMinimum";
export function comparisonProjection(comparison: MarketComparison, scenario: PriceScenario) {
  return comparison.markets.map(market => ({
    observationId: market.observation.id, marketId: market.observation.marketId, marketLabel: market.observation.marketLabel,
    sourceLabel: market.observation.sourceLabel, sourceUrl: market.observation.sourceUrl, observationDate: market.observation.observationDate,
    priceUnit: market.observation.priceUnit, dataKind: market.observation.dataKind,
    eligibility: market.eligibility, exclusionReasons: market.exclusionReasons,
    scenario: market.estimate.scenarios[scenario], loads: market.estimate.loads,
    transport: market.estimate.transport, sellingExpenseBreakdown: market.estimate.sellingExpenseBreakdown,
    missingAssumptions: market.estimate.missingAssumptions,
  }));
}
export type ComparisonLines = ReturnType<typeof comparisonProjection>;
export type ExplanationInput = {
  mode: "reported" | "synthetic"; scenario: PriceScenario; language: string;
  observationSnapshotId?: string; recordIds: string[]; form: FarmerForm; assumptions: Record<string, MarketForm>;
  asOfEpochMs: number; pricesAsOn: string; expected: ComparisonLines; suppressBest: boolean;
};
export type Activity = { step: "observations" | "calculation" | "explanation"; status: "running" | "complete" | "failed"; source: "cline-sdk"; detail?: string };
export type ExplanationResult = { status: "complete" | "unavailable"; sdkExecuted: boolean; mode: ExplanationInput["mode"]; scenario: PriceScenario; comparisonId: string; calculationId: string; lines: ComparisonLines; bestObservationId: string | null; reasonCodes?: string[]; reason?: string; toolsRan: string[] };
