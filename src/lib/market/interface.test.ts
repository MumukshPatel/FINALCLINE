import { describe, expect, it } from "vitest";
import { comparisonDifference, calculateSellingExpenses, SELLING_CATEGORIES, type SellingExpenseRow } from "../calculator";
import { syntheticFarmerRecords } from "../demo/farmer-fixtures";
import { SYNTHETIC_AS_OF_EPOCH_MS } from "../demo/synthetic-fixtures";
import { directionsUrl, requestLocation } from "../location";
import { changeParentSelection, createMarketForm, demoFarmerForm } from "./form";
import { farmerComparison, formQuantityAndLoads } from "./comparison";
import { matchingRecords, marketAssumptionKey } from "./index";

function demo() {
  const records = syntheticFarmerRecords(), form = demoFarmerForm();
  const assumptions = Object.fromEntries(records.map((record) => [record.observation.id, createMarketForm(record)]));
  return { records, form, assumptions, calculate: (scenario: "reportedModal" | "reportedMinimum" = "reportedModal") => farmerComparison(form, assumptions, records, scenario, "synthetic", Date.now()) };
}
describe("farmer journey calculations", () => {
  it("keeps an unselected transport arrangement incomplete without erasing hidden costs", () => {
    expect(createMarketForm().mode).toBe("unselected");
    const state = demo(), entry = state.assumptions["synthetic-a"];
    entry.mode = "unselected";
    expect(state.calculate().markets[0].estimate.scenarios.reportedModal.estimatedNetSaleProceeds).toBeNull();
    expect(entry.quote).toBe("800");
    entry.mode = "hired-job";
    expect(state.calculate().markets[0].estimate.scenarios.reportedModal.estimatedNetSaleProceeds).toBe(42800);
  });
  it("filters observation dates inclusively without replacing price references", () => {
    const records = syntheticFarmerRecords();
    const filters = { stateId: "", districtId: "", cropId: "", varietyId: "", observationFrom: "2000-01-07", observationTo: "2000-01-07" };
    const selected = matchingRecords(records, filters);
    expect(selected.map((record) => record.observation.id)).toEqual(["synthetic-a", "synthetic-b"]);
    expect(selected[0].observation.modalPricePerQuintal).toBe(2200);
    expect(matchingRecords(records, { ...filters, observationFrom: "", observationTo: "2000-01-01" }).map((record) => record.observation.id)).toEqual(["synthetic-c"]);
  });
  it("calculates loads without any provider records and rejects unconfirmed payload", () => {
    const form = demoFarmerForm();
    expect(formQuantityAndLoads(form)).toMatchObject({ quantity: { totalKg: 2000 }, loads: 2 });
    form.payloadConfirmed = false;
    expect(formQuantityAndLoads(form).loads).toBeNull();
  });
  it("uses the January 2000 fixture and produces all four expected amounts with two loads", () => {
    const state = demo(), result = state.calculate();
    expect(result.markets[0].estimate.loads).toBe(2);
    expect(result.markets[0].estimate.scenarios.reportedModal.estimatedNetSaleProceeds).toBe(42800);
    expect(result.markets[1].estimate.scenarios.reportedModal.estimatedNetSaleProceeds).toBe(41800);
    expect(state.calculate("reportedMinimum").markets[0].estimate.scenarios.reportedMinimum.estimatedNetSaleProceeds).toBe(40800);
    expect(state.calculate("reportedMinimum").markets[1].estimate.scenarios.reportedMinimum.estimatedNetSaleProceeds).toBe(39200);
    expect(result.markets[2].eligibility.ageDays).toBe(7);
    expect(result.markets[2].eligibility.exclusionReasons.map((reason) => reason.code)).toContain("stale_observation");
    expect(result.rankings.reportedModal.entries).toHaveLength(2);
  });
  it("recalculates edits and included labour without using the previous flat expense", () => {
    const state = demo(); state.assumptions["synthetic-a"].expenses.loading.value = "300";
    expect(state.calculate().markets[0].estimate.scenarios.reportedModal.estimatedNetSaleProceeds).toBe(42700);
    state.assumptions["synthetic-a"].expenses.loading.status = "included";
    expect(state.calculate().markets[0].estimate.sellingExpenses).toBe(200);
    expect(state.calculate().markets[0].estimate.scenarios.reportedModal.estimatedNetSaleProceeds).toBe(43000);
  });
  it("keeps unknown expenses incomplete and gives no best badge", () => {
    const state = demo(); state.assumptions["synthetic-a"].expenses.weighing.status = "unknown";
    const result = state.calculate();
    expect(result.markets[0].estimate.scenarios.reportedModal.estimatedNetSaleProceeds).toBeNull();
    expect(result.rankings.reportedModal.bestObservationId).toBeNull();
  });
  it("blocks gross/net comparison for unknown price units", () => {
    const state = demo(); state.records[0].observation.priceUnit = "unknown";
    const result = state.calculate();
    expect(result.markets[0].estimate.scenarios.reportedModal.grossSaleProceeds).toBeNull();
    expect(result.markets[0].estimate.scenarios.reportedModal.estimatedNetSaleProceeds).toBeNull();
    expect(result.markets[0].eligibility.exclusionReasons.map((reason) => reason.code)).toContain("unknown_price_unit");
  });
  it("never substitutes a missing price; the other selected scenario remains usable", () => {
    const state = demo(); state.records[0].observation.minimumPricePerQuintal = null;
    expect(state.calculate("reportedModal").rankings.reportedModal.entries).toHaveLength(2);
    const result = state.calculate("reportedMinimum");
    expect(result.markets[0].estimate.scenarios.reportedMinimum.estimatedNetSaleProceeds).toBeNull();
    expect(result.markets[0].eligibility.exclusionReasons.map((reason) => reason.code)).toContain("missing_selected_price");
    expect(result.rankings.reportedMinimum.bestObservationId).toBeNull();
  });
  it("allows a valid selected minimum when the unselected modal is missing", () => {
    const state = demo(); state.records[0].observation.modalPricePerQuintal = null;
    const result = state.calculate("reportedMinimum");
    expect(result.markets[0].eligibility.eligible).toBe(true);
    expect(result.markets[0].estimate.scenarios.reportedModal.estimatedNetSaleProceeds).toBeNull();
    expect(result.markets[0].estimate.scenarios.reportedMinimum.estimatedNetSaleProceeds).toBe(40800);
    expect(result.rankings.reportedMinimum.entries).toHaveLength(2);
  });
  it("computes explanation differences in the deterministic library", () => {
    expect(comparisonDifference(demo().calculate(), "synthetic-a", "synthetic-b", "reportedModal")).toEqual({ grossDifference: 1000, transportDifference: 2000, netDifference: 1000, winnerId: "synthetic-a" });
  });
  it.each([["fixed-total", 10], ["per-quintal", 200], ["per-kg", 20000], ["per-load", 20]] as const)("supports %s charges", (basis, expected) => {
    const items: SellingExpenseRow[] = SELLING_CATEGORIES.map((category) => category === "loading" ? { category, status: "amount", amount: 10, basis } : { category, status: "zero" });
    expect(calculateSellingExpenses({ status: "itemized", items }, { totalKg: 2000, quantityInQuintals: 20 }, 2, 800).total).toBe(expected);
  });
  it("rejects inclusion cycles and unresolved parents", () => {
    const items: SellingExpenseRow[] = SELLING_CATEGORIES.map((category) => category === "loading" ? { category, status: "included", includedIn: "unloading" }
      : category === "unloading" ? { category, status: "included", includedIn: "loading" } : { category, status: "zero" });
    expect(calculateSellingExpenses({ status: "itemized", items }, null, null, 800).total).toBeNull();
    items[0] = { category: "loading", status: "included", includedIn: "transport" };
    expect(calculateSellingExpenses({ status: "itemized", items }, null, null, null).total).toBeNull();
  });
  it("uses actual current time in production, never the fixed demo clock", () => {
    const state = demo(); for (const record of state.records) record.observation.dataKind = "reported";
    const assumptions = Object.fromEntries(state.records.map(record => [marketAssumptionKey(record), createMarketForm(record)]));
    const result = farmerComparison(state.form, assumptions, state.records, "reportedModal", "reported", Date.parse("2026-10-10T12:00:00+05:30"));
    expect(result.rankings.reportedModal.entries).toHaveLength(0);
    expect(result.markets[0].eligibility.ageDays).toBeGreaterThan(9000);
    expect(SYNTHETIC_AS_OF_EPOCH_MS).toBe(Date.parse("2000-01-08T12:00:00+05:30"));
  });
  it("clears incompatible dependent selections", () => {
    const form = { ...demoFarmerForm(), stateId: "old-state", districtId: "old-district", village: "Village" };
    expect(changeParentSelection(form, "stateId", "new-state")).toMatchObject({ districtId: "", village: "" });
    expect(changeParentSelection(form, "cropId", "new-crop")).toMatchObject({ varietyId: "", grade: "" });
  });
});
describe("location and navigation guards", () => {
  it("handles permission denial, timeout and unsupported browsers", async () => {
    expect(await requestLocation(undefined)).toEqual({ status: "unsupported" });
    for (const [code, status] of [[1, "denied"], [3, "timeout"]] as const) {
      const api = { getCurrentPosition: (_success: PositionCallback, error?: PositionErrorCallback | null) => error?.({ code } as GeolocationPositionError) };
      expect(await requestLocation(api)).toEqual({ status });
    }
  });
  it("never creates navigation links for synthetic or unverified coordinates", () => {
    expect(syntheticFarmerRecords().every((record) => directionsUrl(record.coordinates) === null)).toBe(true);
    expect(directionsUrl({ latitude: 0, longitude: 0, verified: false })).toBeNull();
    expect(directionsUrl({ latitude: 100, longitude: 0, verified: true })).toBeNull();
  });
});
