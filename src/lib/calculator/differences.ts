import type { MarketComparison } from "./types";
import { decimal } from "./arithmetic";

/** Financial differences stay in the deterministic library, never UI arithmetic or AI text. */
export function comparisonDifference(comparison: MarketComparison, firstId: string, secondId: string, scenario: "reportedModal" | "reportedMinimum") {
  const first = comparison.markets.find((market) => market.observation.id === firstId);
  const second = comparison.markets.find((market) => market.observation.id === secondId);
  if (!first || !second || !first.eligibility.eligible || !second.eligibility.eligible) return null;
  const a = first.estimate.scenarios[scenario], b = second.estimate.scenarios[scenario];
  if (a.estimatedNetSaleProceeds === null || b.estimatedNetSaleProceeds === null || a.grossSaleProceeds === null || b.grossSaleProceeds === null || a.transportCost === null || b.transportCost === null) return null;
  const net = decimal(b.estimatedNetSaleProceeds).minus(a.estimatedNetSaleProceeds);
  return {
    grossDifference: decimal(b.grossSaleProceeds).minus(a.grossSaleProceeds).toDecimalPlaces(2).toNumber(),
    transportDifference: decimal(b.transportCost).minus(a.transportCost).toDecimalPlaces(2).toNumber(),
    netDifference: net.abs().toDecimalPlaces(2).toNumber(),
    winnerId: net.gt(0) ? secondId : net.lt(0) ? firstId : null,
  };
}
