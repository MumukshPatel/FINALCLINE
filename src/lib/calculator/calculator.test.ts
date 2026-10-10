import { describe, expect, it } from "vitest";
import {
  calculateLoads, calculateSaleScenarios, calculateTransport, compareMarkets,
  convertQuantity, evaluateObservation,
} from "./index";
import type { HiredTransport, OwnedTransport, QuantityInput, SaleEstimateInput } from "./index";
import { ALL_INCLUDED, confirmedExpense, createSyntheticComparison, syntheticHire } from "../demo/synthetic-fixtures";

const zero = () => confirmedExpense(0);
const payload = (usablePayloadKg: number) => ({ status: "confirmed" as const, usablePayloadKg });
function owned(overrides: Partial<OwnedTransport> = {}): OwnedTransport {
  return {
    mode: "owned", outboundKm: 40, returnDistance: { assumption: "same-as-outbound" },
    loadedKmPerLitre: 5, emptyKmPerLitre: 8, fuelPricePerLitre: 100,
    driver: zero(), toll: zero(), other: zero(), ...overrides,
  };
}
function sale(overrides: Partial<SaleEstimateInput> = {}): SaleEstimateInput {
  return {
    quantity: { unit: "quintal", value: 20 }, payload: payload(1000),
    transport: syntheticHire(800), sellingExpenses: confirmedExpense(400),
    modalPricePerQuintal: 2200, minimumPricePerQuintal: 2100, ...overrides,
  };
}

describe("quantity and confirmed load capacity", () => {
  it.each([
    [{ unit: "kg", value: 2000 }, 2000, 20],
    [{ unit: "quintal", value: 20 }, 2000, 20],
    [{ unit: "tonne", value: 2 }, 2000, 20],
    [{ unit: "bag", value: 40, kgPerBag: 50 }, 2000, 20],
    [{ unit: "kg", value: 150 }, 150, 1.5],
  ] as [QuantityInput, number, number][]) ("converts %j", (input, totalKg, quantityInQuintals) => {
    expect(convertQuantity(input)).toEqual({ value: { totalKg, quantityInQuintals }, missingAssumptions: [] });
  });

  it.each([0, -1, NaN, Infinity, -Infinity, "20", undefined])("rejects invalid quantity %s", (value) => {
    expect(convertQuantity({ unit: "kg", value } as QuantityInput).value).toBeNull();
  });
  it("rejects unsupported units and conversion overflow", () => {
    expect(convertQuantity({ unit: "acre", value: 20 } as unknown as QuantityInput).value).toBeNull();
    expect(convertQuantity({ unit: "tonne", value: Number.MAX_SAFE_INTEGER }).value).toBeNull();
  });
  it.each([null, 0, -5, NaN])("requires user-entered positive kg per bag: %s", (kgPerBag) => {
    const result = convertQuantity({ unit: "bag", value: 10, kgPerBag });
    expect(result.value).toBeNull();
    expect(result.missingAssumptions[0].field).toBe("kgPerBag");
  });
  it("uses one load at exact payload and two just above it", () => {
    expect(calculateLoads(1000, payload(1000)).value).toBe(1);
    expect(calculateLoads(1000.001, payload(1000)).value).toBe(2);
    expect(calculateLoads(2000, payload(1000)).value).toBe(2);
    expect(calculateLoads(2000.001, payload(1000)).value).toBe(3);
  });
  it("preserves decimal exact-payload boundaries", () => {
    const bags = convertQuantity({ unit: "bag", value: 3, kgPerBag: 0.1 });
    const quintals = convertQuantity({ unit: "quintal", value: 0.14 });
    expect(calculateLoads(bags.value!.totalKg, payload(0.3)).value).toBe(1);
    expect(calculateLoads(quintals.value!.totalKg, payload(14)).value).toBe(1);
  });
  it.each([0, -100, NaN, Infinity])("rejects invalid confirmed payload %s", (kg) => {
    expect(calculateLoads(2000, payload(kg)).value).toBeNull();
  });
  it("requires confirmation even when a hire quote is known", () => {
    const result = calculateSaleScenarios(sale({ payload: { status: "unknown" } }));
    expect(result.loads).toBeNull();
    expect(result.scenarios.reportedModal.estimatedNetSaleProceeds).toBeNull();
    expect(result.missingAssumptions.some((item) => item.field === "usablePayloadKg")).toBe(true);
  });
});

describe("owned transport", () => {
  it("applies loaded and empty mileage on every trip; fees are TOTAL, not per-load", () => {
    const result = calculateTransport(owned({ driver: confirmedExpense(300), toll: confirmedExpense(100), other: confirmedExpense(50) }), 2);
    expect(result.fuelLitres).toBe(26);
    expect(result.fuelCost).toBe(2600);
    expect(result.total).toBe(3050);
    expect(result.returnDistance).toMatchObject({ assumption: "same-as-outbound", km: 40 });
    expect(result.returnDistance.description).toContain("assumed equal");
  });
  it("accepts separately entered return distance, including explicitly entered zero", () => {
    expect(calculateTransport(owned({ returnDistance: { assumption: "entered", km: 20 } }), 2).fuelLitres).toBe(21);
    expect(calculateTransport(owned({ returnDistance: { assumption: "entered", km: 0 } }), 2).fuelLitres).toBe(16);
  });
  it("requires a visible return-distance assumption", () => {
    const result = calculateTransport(owned({ returnDistance: { assumption: "unknown" } }), 2);
    expect(result.total).toBeNull();
    expect(result.missingAssumptions.some((item) => item.field === "returnDistance")).toBe(true);
  });
  it.each([0, -1, NaN, Infinity, null])("rejects unusable loaded mileage %s", (loadedKmPerLitre) => {
    const result = calculateTransport(owned({ loadedKmPerLitre }), 2);
    expect(result.total).toBeNull();
    expect(result.fuelCost).toBeNull();
    expect(result.missingAssumptions.some((item) => item.field === "loadedKmPerLitre")).toBe(true);
  });
  it("requires empty mileage and positive fuel price", () => {
    expect(calculateTransport(owned({ emptyKmPerLitre: 0 }), 2).total).toBeNull();
    expect(calculateTransport(owned({ fuelPricePerLitre: null }), 2).total).toBeNull();
    expect(calculateTransport(owned({ fuelPricePerLitre: 0 }), 2).total).toBeNull();
  });
  it("does not silently zero missing driver, toll or other fees", () => {
    for (const category of ["driver", "toll", "other"] as const) {
      const result = calculateTransport(owned({ [category]: { status: "unknown" } }), 2);
      expect(result.fuelCost).toBe(2600);
      expect(result.total).toBeNull();
      expect(result.missingAssumptions.some((item) => item.field === category)).toBe(true);
    }
  });
  it("rejects non-integer load counts", () => {
    expect(calculateTransport(owned(), 1.5).total).toBeNull();
  });
});

describe("hired transport and inclusions", () => {
  it("uses a whole-job quote once and multiplies a round-trip load quote by loads", () => {
    const quote = syntheticHire(800);
    expect(calculateTransport(quote, 2).total).toBe(800);
    expect(calculateTransport({ ...quote, quoteBasis: "per-round-trip-load" }, 2).total).toBe(1600);
  });
  it("never double-counts bundled fuel, driver, toll or other fees", () => {
    const result = calculateTransport({
      ...syntheticHire(800), additionalCosts: {
        fuel: confirmedExpense(9000), driver: confirmedExpense(500),
        toll: confirmedExpense(200), other: confirmedExpense(100),
      },
    }, 2);
    expect(result.total).toBe(800);
    expect(result.inclusions).toEqual(ALL_INCLUDED);
    expect(result.additionalCosts).toEqual({ fuel: 0, driver: 0, toll: 0, other: 0 });
    expect(result.fuelCost).toBeNull(); // Bundled fuel isn't separately knowable.
  });
  it("adds explicitly excluded fuel and TOTAL fees only once", () => {
    const input: HiredTransport = {
      ...syntheticHire(800), quoteBasis: "per-round-trip-load",
      inclusions: { ...ALL_INCLUDED, fuel: "excluded", toll: "excluded" },
      additionalCosts: { fuel: confirmedExpense(500), toll: confirmedExpense(100) },
    };
    const result = calculateTransport(input, 2);
    expect(result.quoteCost).toBe(1600);
    expect(result.fuelCost).toBe(500);
    expect(result.total).toBe(2200);
  });
  it("requires excluded category costs and quote inclusions to be confirmed", () => {
    expect(calculateTransport({ ...syntheticHire(800), inclusions: { ...ALL_INCLUDED, fuel: "excluded" } }, 2).total).toBeNull();
    const result = calculateTransport({ ...syntheticHire(800), inclusions: { ...ALL_INCLUDED, fuel: "unknown" } }, 2);
    expect(result.total).toBeNull();
    expect(result.missingAssumptions[0].field).toBe("inclusions.fuel");
  });
  it("accepts confirmed zero but rejects unknown, negative and invalid quotes", () => {
    expect(calculateTransport(syntheticHire(0), 2).total).toBe(0);
    expect(calculateTransport({ ...syntheticHire(800), quote: { status: "unknown" } }, 2).total).toBeNull();
    expect(calculateTransport(syntheticHire(-1), 2).total).toBeNull();
    expect(calculateTransport(syntheticHire(NaN), 2).total).toBeNull();
  });
});

describe("sale scenarios and synthetic fixture regression", () => {
  it("returns the four specified net proceeds with 20 quintals and two loads", () => {
    const result = compareMarkets(createSyntheticComparison());
    const [a, b] = result.markets.map((market) => market.estimate);
    expect([a.loads, b.loads]).toEqual([2, 2]);
    expect(a.scenarios.reportedModal).toMatchObject({ grossSaleProceeds: 44000, transportCost: 800, sellingExpenses: 400, estimatedNetSaleProceeds: 42800 });
    expect(b.scenarios.reportedModal.estimatedNetSaleProceeds).toBe(41800);
    expect(a.scenarios.reportedMinimum.estimatedNetSaleProceeds).toBe(40800);
    expect(b.scenarios.reportedMinimum.estimatedNetSaleProceeds).toBe(39200);
    expect(result.rankings.reportedModal.entries.map((market) => market.marketId)).toEqual(["demo-a", "demo-b"]);
    expect(result.rankings.reportedMinimum.bestObservationId).toBe("synthetic-a");
  });
  it("keeps an unknown farmer-borne selling expense distinct from zero", () => {
    const unknown = calculateSaleScenarios(sale({ sellingExpenses: { status: "unknown" } }));
    const free = calculateSaleScenarios(sale({ sellingExpenses: zero() }));
    expect(unknown.sellingExpenses).toBeNull();
    expect(unknown.scenarios.reportedModal.grossSaleProceeds).toBe(44000);
    expect(unknown.scenarios.reportedModal.estimatedNetSaleProceeds).toBeNull();
    expect(unknown.status).toBe("incomplete");
    expect(free.scenarios.reportedModal.estimatedNetSaleProceeds).toBe(43200);
    expect(free.status).toBe("complete");
  });
  it("reports invalid expenses and never produces an authoritative net from them", () => {
    const result = calculateSaleScenarios(sale({ sellingExpenses: confirmedExpense(NaN) }));
    expect(result.status).toBe("invalid");
    expect(result.scenarios.reportedModal.estimatedNetSaleProceeds).toBeNull();
  });
  it("allows negative estimated net sale proceeds rather than clamping to zero", () => {
    const result = calculateSaleScenarios(sale({ modalPricePerQuintal: 20, minimumPricePerQuintal: 10 }));
    expect(result.scenarios.reportedModal.estimatedNetSaleProceeds).toBe(-800);
    expect(result.scenarios.reportedMinimum.estimatedNetSaleProceeds).toBe(-1000);
  });
  it("rounds monetary lines to paise, half away from zero", () => {
    const result = calculateSaleScenarios(sale({
      quantity: { unit: "kg", value: 100 }, modalPricePerQuintal: 10.075, minimumPricePerQuintal: 10.075,
      transport: syntheticHire(1.005), sellingExpenses: zero(),
    }));
    expect(result.transport.total).toBe(1.01);
    expect(result.scenarios.reportedModal.grossSaleProceeds).toBe(10.08);
    expect(result.scenarios.reportedModal.estimatedNetSaleProceeds).toBe(9.07);
  });
  it("rejects a minimum above modal and monetary overflow", () => {
    expect(calculateSaleScenarios(sale({ minimumPricePerQuintal: 2300 })).status).toBe("invalid");
    expect(calculateSaleScenarios(sale({ modalPricePerQuintal: Number.MAX_SAFE_INTEGER })).scenarios.reportedModal.estimatedNetSaleProceeds).toBeNull();
  });
});

describe("observation eligibility and rankings", () => {
  const fixture = createSyntheticComparison();
  const observation = fixture.markets[0].observation;
  const check = (change: Partial<typeof observation>) => evaluateObservation({ ...observation, ...change }, fixture, fixture.freshness);
  it("compares exact crop/variety apart from surrounding whitespace and case", () => {
    expect(check({ crop: " DEMO CROP ", variety: "demo VARIETY" }).eligible).toBe(true);
    expect(check({ crop: "Another crop" }).exclusionReasons.map((r) => r.code)).toContain("crop_mismatch");
    expect(check({ variety: "Another variety" }).exclusionReasons.map((r) => r.code)).toContain("variety_mismatch");
  });
  it("admits exactly two days old and excludes three days old", () => {
    expect(check({ observationDate: "2000-01-06" })).toMatchObject({ eligible: true, ageDays: 2 });
    expect(check({ observationDate: "2000-01-05" }).exclusionReasons.map((r) => r.code)).toContain("stale_observation");
  });
  it("changes freshness at midnight Asia/Kolkata, not midnight UTC", () => {
    const record = { ...observation, observationDate: "2026-10-07" };
    const before = evaluateObservation(record, fixture, { asOfEpochMs: Date.parse("2026-10-09T18:29:59Z"), maxAgeDays: 2 });
    const after = evaluateObservation(record, fixture, { asOfEpochMs: Date.parse("2026-10-09T18:30:00Z"), maxAgeDays: 2 });
    expect(before).toMatchObject({ eligible: true, ageDays: 2 });
    expect(after).toMatchObject({ eligible: false, ageDays: 3 });
  });
  it("supports a configurable freshness window", () => {
    expect(evaluateObservation({ ...observation, observationDate: "2000-01-05" }, fixture, { ...fixture.freshness, maxAgeDays: 3 }).eligible).toBe(true);
    expect(evaluateObservation({ ...observation, observationDate: "2000-01-07" }, fixture, { ...fixture.freshness, maxAgeDays: 0 }).eligible).toBe(false);
  });
  it.each(["2026-02-30", "2026-13-01", "10/10/2026", "2026-10-10T00:00:00Z", ""]) ("rejects invalid or ambiguous date %s", (observationDate) => {
    expect(check({ observationDate }).exclusionReasons.map((r) => r.code)).toContain("invalid_date");
  });
  it("accepts leap day and rejects future observations", () => {
    expect(evaluateObservation({ ...observation, observationDate: "2024-02-29" }, fixture, { asOfEpochMs: Date.parse("2024-03-01T00:00:00+05:30"), maxAgeDays: 2 }).eligible).toBe(true);
    expect(check({ observationDate: "2026-10-11" }).exclusionReasons.map((r) => r.code)).toContain("future_observation");
  });
  it("rejects invalid clocks and negative or fractional freshness windows", () => {
    for (const policy of [{ asOfEpochMs: NaN, maxAgeDays: 2 }, { ...fixture.freshness, maxAgeDays: -1 }, { ...fixture.freshness, maxAgeDays: 1.5 }]) {
      expect(evaluateObservation(observation, fixture, policy).exclusionReasons.map((r) => r.code)).toContain("invalid_freshness_policy");
    }
  });
  it.each([null, 0, -1, NaN, Infinity])("excludes invalid prices %s", (modalPricePerQuintal) => {
    expect(check({ modalPricePerQuintal }).exclusionReasons.map((r) => r.code)).toContain("invalid_prices");
  });
  it("does not mix synthetic fixtures into the default reported ranking", () => {
    const { dataset: _dataset, ...defaultInput } = createSyntheticComparison();
    const result = compareMarkets(defaultInput);
    expect(result.rankings.reportedModal.entries).toEqual([]);
    expect(result.markets[0].exclusionReasons.map((r) => r.code)).toContain("dataset_mismatch");
  });
  it("excludes stale and invalid records from both default rankings", () => {
    const input = createSyntheticComparison();
    input.markets[0].observation.observationDate = "2000-01-05";
    input.markets[1].observation.minimumPricePerQuintal = NaN;
    const result = compareMarkets(input);
    expect(result.rankings.reportedModal.entries).toHaveLength(0);
    expect(result.rankings.reportedMinimum.entries).toHaveLength(0);
    expect(result.markets[0].exclusionReasons.map((r) => r.code)).toContain("stale_observation");
    expect(result.markets[1].exclusionReasons.map((r) => r.code)).toContain("invalid_prices");
  });
  it("gives no unconditional best badge if any eligible comparison is incomplete", () => {
    const input = createSyntheticComparison();
    input.markets[1].sellingExpenses = { status: "unknown" };
    const result = compareMarkets(input);
    expect(result.rankings.reportedModal.entries.map((r) => r.observationId)).toEqual(["synthetic-a"]);
    expect(result.rankings.reportedModal.bestObservationId).toBeNull();
    expect(result.rankings.reportedMinimum.bestObservationId).toBeNull();
    expect(result.markets[1].exclusionReasons.map((r) => r.code)).toContain("incomplete_estimate");
  });
  it("suppresses a best badge for ties and sorts them deterministically", () => {
    const input = createSyntheticComparison();
    input.markets[1] = { ...input.markets[0], observation: { ...input.markets[0].observation, id: "synthetic-b", marketId: "demo-b" } };
    expect(compareMarkets(input).rankings.reportedModal).toMatchObject({ bestObservationId: null });
    expect(compareMarkets(input).rankings.reportedModal.entries.map((r) => r.observationId)).toEqual(["synthetic-a", "synthetic-b"]);
  });
  it("does not mutate requests; repeated calls produce identical results", () => {
    const input = createSyntheticComparison();
    function deepFreeze(value: object): void {
      Object.freeze(value);
      for (const child of Object.values(value)) if (child !== null && typeof child === "object") deepFreeze(child);
    }
    const original = structuredClone(input);
    deepFreeze(input);
    const first = compareMarkets(input);
    expect(compareMarkets(input)).toEqual(first);
    expect(input).toEqual(original);
  });
});
