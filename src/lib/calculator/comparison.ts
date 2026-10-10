import type { ComparisonInput, MarketComparison, RankedEstimate, ScenarioRanking } from "./types";
import { evaluateObservation } from "./eligibility";
import { calculateSaleScenarios } from "./sale";

export function compareMarkets(input: ComparisonInput): MarketComparison {
  const markets: MarketComparison["markets"] = input.markets.map((market) => {
    const eligibility = evaluateObservation(market.observation, input, input.freshness);
    const estimate = calculateSaleScenarios({
      quantity: input.quantity, payload: input.payload, transport: market.transport,
      sellingExpenses: market.sellingExpenses,
      modalPricePerQuintal: market.observation.priceUnit === "INR/quintal" ? market.observation.modalPricePerQuintal : null,
      minimumPricePerQuintal: market.observation.priceUnit === "INR/quintal" ? market.observation.minimumPricePerQuintal : null,
    });
    const exclusionReasons = [...eligibility.exclusionReasons];
    if ((input.scenario ? estimate.scenarios[input.scenario].status : estimate.status) !== "complete") {
      exclusionReasons.push({
        code: "incomplete_estimate",
        message: estimate.missingAssumptions.map((item) => item.message).join(" "),
      });
    }
    return { observation: market.observation, eligibility, estimate, exclusionReasons };
  });

  function ranking(scenario: "reportedModal" | "reportedMinimum"): ScenarioRanking {
    const eligible = markets.filter((market) => market.eligibility.eligible);
    const allEligibleComplete = eligible.every((market) => market.estimate.scenarios[scenario].status === "complete");
    const entries: RankedEstimate[] = eligible
      .filter((market) => market.estimate.scenarios[scenario].status === "complete" &&
        market.estimate.scenarios[scenario].estimatedNetSaleProceeds !== null)
      .map((market) => ({
        rank: 0, observationId: market.observation.id, marketId: market.observation.marketId,
        estimatedNetSaleProceeds: market.estimate.scenarios[scenario].estimatedNetSaleProceeds!,
      }))
      .sort((a, b) => b.estimatedNetSaleProceeds - a.estimatedNetSaleProceeds ||
        (a.observationId < b.observationId ? -1 : a.observationId > b.observationId ? 1 : 0))
      .map((entry, index) => ({ ...entry, rank: index + 1 }));
    return {
      entries,
      bestObservationId: allEligibleComplete && entries.length > 1 &&
        entries[0].estimatedNetSaleProceeds > entries[1].estimatedNetSaleProceeds
        ? entries[0].observationId : null,
    };
  }
  return { markets, rankings: { reportedModal: ranking("reportedModal"), reportedMinimum: ranking("reportedMinimum") } };
}
