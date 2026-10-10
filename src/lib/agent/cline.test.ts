import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentModel, AgentModelEvent } from "@cline/shared";
import { syntheticFarmerRecords } from "../demo/farmer-fixtures";
import { SYNTHETIC_AS_OF_EPOCH_MS } from "../demo/synthetic-fixtures";
import { createMarketForm, demoFarmerForm } from "../market/form";
import { farmerComparison } from "../market/comparison";
import { marketAssumptionKey, type MarketRecord } from "../market";
import { bindComparison } from "./bound-comparison";
import { comparisonProjection, type Activity, type ExplanationInput } from "./comparison";
import { clineConfiguration, runClineComparison, validateExplanation } from "./cline";
import { observationResponse, readObservationSnapshot } from "./snapshots";

function fixture(scenario: ExplanationInput["scenario"] = "reportedModal", records: MarketRecord[] = syntheticFarmerRecords()): ExplanationInput {
  const form = demoFarmerForm(), assumptions = Object.fromEntries(records.map(record => [marketAssumptionKey(record), createMarketForm(record)]));
  return { mode: "synthetic", scenario, language: "en", recordIds: records.map(x => x.observation.id), form, assumptions, asOfEpochMs: SYNTHETIC_AS_OF_EPOCH_MS, pricesAsOn: "2000-01-08", suppressBest: false, expected: comparisonProjection(farmerComparison(form, assumptions, records, scenario, "synthetic", SYNTHETIC_AS_OF_EPOCH_MS), scenario) };
}
// ACTUAL installed SDK runtime, MOCK model stream. No live provider/key success.
function syntheticModel(fail = false): AgentModel {
  let turn = 0;
  return { async *stream(request): AsyncGenerator<AgentModelEvent> {
    expect(request.tools.map(x => x.name)).toEqual(["get_market_observations", "calculate_sale_scenarios"]);
    expect(request.modelTools ?? []).toEqual([]);
    if (fail) { yield { type: "finish", reason: "error", error: "Synthetic test provider failure", errorRetryable: false }; return; }
    turn++;
    if (turn <= 2) { yield { type: "tool-call-delta", index: 0, toolCallId: `synthetic-call-${turn}`, toolName: turn === 1 ? "get_market_observations" : "calculate_sale_scenarios", input: {} }; yield { type: "finish", reason: "tool-calls" }; }
    else { yield { type: "text-delta", text: JSON.stringify({ winnerObservationId: "synthetic-a", reasonCodes: ["overall_net", "transport_advantage", "excluded", "stale_excluded"] }) }; yield { type: "finish", reason: "stop" }; }
  } };
}
afterEach(() => vi.unstubAllEnvs());
describe("bound Cline comparison — labelled synthetic fixtures", () => {
  it.each([["reportedModal", 42800, 41800], ["reportedMinimum", 40800, 39200]] as const)("runs both real SDK tools with a mock model for %s", async (scenario, a, b) => {
    const bound = bindComparison(fixture(scenario), null), events: Activity[] = [];
    const result = await runClineComparison(bound, event => events.push(event), new AbortController().signal, syntheticModel());
    expect(result.status).toBe("complete"); expect(result.sdkExecuted).toBe(true);
    expect(result.toolsRan).toEqual(["get_market_observations", "calculate_sale_scenarios"]);
    expect(result.mode).toBe("synthetic"); expect(result.scenario).toBe(scenario);
    expect(result.lines[0].scenario.estimatedNetSaleProceeds).toBe(a); expect(result.lines[1].scenario.estimatedNetSaleProceeds).toBe(b);
    expect(result.lines[2].eligibility.exclusionReasons.some(x => x.code === "stale_observation")).toBe(true);
    expect(events.filter(x => x.status === "complete").map(x => x.step)).toEqual(["observations", "calculation", "explanation"]);
  });
  it("missing credentials makes zero SDK calls and no fabricated activity", async () => {
    for (const key of ["CLINE_PROVIDER_ID", "CLINE_MODEL_ID", "CLINE_PROVIDER_API_KEY"]) vi.stubEnv(key, "");
    const events: Activity[] = [], result = await runClineComparison(bindComparison(fixture(), null), event => events.push(event), new AbortController().signal);
    expect(Object.values(clineConfiguration())).toEqual([false, false, false]);
    expect(result.sdkExecuted).toBe(false); expect(result.toolsRan).toEqual([]); expect(events).toEqual([]);
    expect(result.lines[0].scenario.estimatedNetSaleProceeds).toBe(42800);
  });
  it("actual SDK mock-provider failure leaves the deterministic result usable", async () => {
    const result = await runClineComparison(bindComparison(fixture(), null), () => {}, new AbortController().signal, syntheticModel(true));
    expect(result.status).toBe("unavailable"); expect(result.toolsRan).toEqual([]);
    expect(result.lines[1].scenario.estimatedNetSaleProceeds).toBe(41800);
  });
  it("tools reject model-invented parameters and enforce observation-first order", () => {
    const bound = bindComparison(fixture(), null);
    expect(() => bound.calculate_sale_scenarios()).toThrow("READ_OBSERVATIONS_FIRST");
    expect(() => bound.get_market_observations({ prices: 999 })).toThrow("TOOLS_ACCEPT_NO_INPUTS");
    expect(bound.get_market_observations().dataMode).toBe("synthetic");
    expect(() => bound.calculate_sale_scenarios({ costs: 0 })).toThrow("TOOLS_ACCEPT_NO_INPUTS");
  });
  it("rejects client-invented money, mismatched scenario and arithmetic-bearing explanations", () => {
    const body = fixture(); body.expected[0].scenario.estimatedNetSaleProceeds = 999;
    expect(() => bindComparison(body, null)).toThrow("COMPARISON_CHANGED");
    expect(() => bindComparison({ ...fixture(), scenario: "reportedMinimum" }, null)).toThrow("COMPARISON_CHANGED");
    const bound = bindComparison(fixture(), null);
    expect(() => validateExplanation('{"winnerObservationId":"synthetic-a","reasonCodes":["overall_net"],"net":999}', bound)).toThrow();
    expect(() => validateExplanation('{"winnerObservationId":"synthetic-b","reasonCodes":["overall_net"]}', bound)).toThrow();
  });
  it("missing fees keep net incomplete and forbid unconditional winner", () => {
    const body = fixture(), records = syntheticFarmerRecords(); body.assumptions["synthetic-a"].expenses.loading.status = "unknown";
    body.expected = comparisonProjection(farmerComparison(body.form, body.assumptions, records, body.scenario, body.mode, body.asOfEpochMs), body.scenario);
    const bound = bindComparison(body, null); bound.get_market_observations(); const output = bound.calculate_sale_scenarios();
    expect(output.bestObservationId).toBeNull(); expect(output.lines[0].scenario.estimatedNetSaleProceeds).toBeNull();
  });
  it("real snapshots require the owning cookie; unknown units remain excluded", async () => {
    // SYNTHETIC test-only reported-mode fixture, not a government observation.
    const records = syntheticFarmerRecords().map(x => ({ ...x, observation: { ...x.observation, dataKind: "reported" as const, sourceLabel: "SYNTHETIC test-only import", priceUnit: "unknown" as const } }));
    const owner = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", response = observationResponse(new Request("http://localhost/api/markets", { headers: { cookie: `mandinet_comparison_owner=${owner}` } }), { status: "ready", providerId: "SYNTHETIC-test-only-import", records, retrievedAt: null });
    const snapshot = await response.json();
    expect(() => readObservationSnapshot(snapshot.observationSnapshotId, "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")).toThrow("OBSERVATIONS_EXPIRED");
    expect(() => readObservationSnapshot(snapshot.observationSnapshotId, null)).toThrow("OBSERVATIONS_EXPIRED");
    const body = fixture("reportedModal", records); body.mode = "reported"; body.observationSnapshotId = snapshot.observationSnapshotId;
    body.expected = comparisonProjection(farmerComparison(body.form, body.assumptions, records, body.scenario, "reported", body.asOfEpochMs), body.scenario);
    const bound = bindComparison(body, owner);
    expect(bound.lines[0].eligibility.eligible).toBe(false); expect(bound.lines[0].scenario.estimatedNetSaleProceeds).toBeNull();
    expect(bound.lines[0].eligibility.exclusionReasons.some(x => x.code === "unknown_price_unit")).toBe(true);
    expect(bound.input.mode).toBe("reported");
  });
});
