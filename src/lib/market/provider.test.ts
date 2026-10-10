import { describe, expect, it, vi, afterEach } from "vitest";
import { normalizeExport, calendarDate, kolkataToday, parseCsv, parseExcel, priceValue } from "./normalization";
import ExcelJS from "exceljs";
import { normalizeFilters, upstreamJson, getMarketRecords } from "./agmarknet-server";
import { latestRecords, marketAssumptionKey } from "./index";
import { createMarketForm, demoFarmerForm } from "./form";
import { farmerComparison } from "./comparison";
import { syntheticFarmerRecords } from "../demo/farmer-fixtures";

// SYNTHETIC adapter test input. Not an authentic price response and never served by the app.
const row = { source_record_id: "test-row", market_id: "test-market", market_name: "Synthetic adapter test", state_id: "test-state", state_name: "Test state", district_id: "test-district", district_name: "Test district", crop_id: "test-crop", crop_name: "Test crop", variety_id: "test-variety", variety_name: "Test variety", grade: "FAQ", observation_date: "2026-10-09", minimum_price: "2100", modal_price: "2200", maximum_price: "2300", price_unit: "INR/quintal" };
const metadata = { sourceUrl: "https://agmarknet.gov.in/home", retrievedAt: "2026-10-10T10:00:00Z", unitEvidence: "SYNTHETIC TEST ONLY: explicitly labelled INR/quintal", acquisitionMode: "manual-import" as const };
const filters = { stateId: "", districtId: "", cropId: "", varietyId: "", pricesAsOn: "2026-10-09" };
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe("official export normalization and provenance", () => {
  it("preserves all declared fields without injecting transport defaults or coordinates", () => {
    const record = normalizeExport([row], metadata)[0];
    expect(record.observation.minimumPricePerQuintal).toBe(2100);
    expect(record.observation.modalPricePerQuintal).toBe(2200);
    expect(record.observation.grade).toBe("FAQ");
    expect(record.provenance).toMatchObject({ sourceRecordId: "test-row", maximumPrice: 2300, originalPriceUnit: "INR/quintal", acquisitionMode: "manual-import" });
    expect(record.retrievedAt).toBe(metadata.retrievedAt);
    expect(record.coordinates).toBeNull(); expect(record.demoDefaults).toBeUndefined();
  });
  it.each([undefined, "", "INR/kg", "unknown"])("never infers unit %s", unit => {
    const record = normalizeExport([{ ...row, price_unit: unit }], metadata)[0];
    expect(record.observation.priceUnit).toBe("unknown"); expect(record.observation.modalPricePerQuintal).toBeNull(); expect(record.provenance?.rawModal).toBe(2200);
  });
  it("requires explicit source evidence even for a recognized unit", () => {
    expect(normalizeExport([row], { ...metadata, unitEvidence: undefined })[0].observation.priceUnit).toBe("unknown");
  });
  it("keeps missing minimum/modal prices missing, not zero", () => {
    const record = normalizeExport([{ ...row, modal_price: "", minimum_price: null }], metadata)[0];
    expect(record.observation.modalPricePerQuintal).toBeNull(); expect(record.observation.minimumPricePerQuintal).toBeNull(); expect(priceValue(undefined)).toBeNull();
  });
  it.each([0, -1, "NaN", {}, "1,000"])("rejects invalid price %s", price => expect(() => priceValue(price)).toThrow());
  it("rejects inconsistent prices, invalid dates and untrusted source URLs", () => {
    expect(() => normalizeExport([{ ...row, minimum_price: "2400" }], metadata)).toThrow();
    expect(() => normalizeExport([{ ...row, observation_date: "2026-02-30" }], metadata)).toThrow();
    expect(() => normalizeExport([row], { ...metadata, sourceUrl: "https://example.com" })).toThrow();
    expect(() => normalizeExport([row], { ...metadata, sourceUrl: "https://api.data.gov.in/?api-key=secret" })).toThrow();
  });
  it("strictly parses dates and respects Kolkata calendar rollover", () => {
    expect(calendarDate("09/10/2026")).toBe("2026-10-09"); expect(calendarDate("2026-02-30")).toBeNull();
    expect(kolkataToday(Date.parse("2026-10-09T18:30:00Z"))).toBe("2026-10-10");
  });
  it("requires retrieval timezone and rejects future observation dates", () => {
    expect(() => normalizeExport([row], { ...metadata, retrievedAt: "2026-10-10T10:00:00" })).toThrow("timezone");
    expect(() => normalizeExport([{ ...row, observation_date: "2099-01-01" }], metadata)).toThrow("future");
  });
  it("absent market assumptions remain incomplete instead of crashing or inheriting demo", () => {
    const record = normalizeExport([row], metadata)[0]; const form = { ...demoFarmerForm(), cropId: record.cropId, varietyId: record.varietyId, grade: "FAQ" };
    const result = farmerComparison(form, {}, [record], "reportedModal", "reported", Date.parse("2026-10-10T12:00:00+05:30"));
    expect(result.markets[0].estimate.scenarios.reportedModal.estimatedNetSaleProceeds).toBeNull(); expect(result.rankings.reportedModal.bestObservationId).toBeNull();
  });
  it("CSV retains blank prices and quoted fields, rejects malformed input", () => {
    expect(parseCsv('market_name,modal_price\r\n"A, B",\r\n')).toEqual([{ market_name: "A, B", modal_price: "" }]);
    expect(() => parseCsv('x,y\n"unclosed')).toThrow(); expect(() => parseCsv("x,x\n1,2")).toThrow();
  });
  it("reads an Excel worksheet while preserving official row values and dates", async () => {
    const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet("Report");
    sheet.addRow(Object.keys(row)); sheet.addRow(Object.values(row));
    const bytes = await workbook.xlsx.writeBuffer();
    expect(await parseExcel(new Uint8Array(bytes as unknown as ArrayLike<number>).buffer)).toMatchObject([{ market_id: "test-market", market_name: "Synthetic adapter test", observation_date: "2026-10-09", modal_price: "2200" }]);
  });
  it("as-of deduplicates by market/variety/grade and never selects a later record", () => {
    const records = normalizeExport([{ ...row, observation_date: "2026-10-08" }, row, { ...row, observation_date: "2026-10-10" }], metadata);
    const selected = latestRecords(records, filters); expect(selected).toHaveLength(1); expect(selected[0].observation.observationDate).toBe("2026-10-09");
    expect(latestRecords(records, { ...filters, pricesAsOn: "2026-10-07" })).toEqual([]);
  });
  it("stable market costs survive different record dates", () => {
    const records = normalizeExport([row, { ...row, observation_date: "2026-10-08" }], metadata);
    expect(records[0].observation.id).not.toBe(records[1].observation.id); expect(marketAssumptionKey(records[0])).toBe(marketAssumptionKey(records[1]));
  });
  it("real records do not inherit even accidentally attached demo defaults", () => {
    const record = normalizeExport([row], metadata)[0]; record.demoDefaults = syntheticFarmerRecords()[0].demoDefaults;
    const form = createMarketForm(record); expect(form.quote).toBe(""); expect(form.expenses.loading.status).toBe("unknown"); expect(form.fuelPrice).toBe("");
  });
  it("unknown units block money and stale dates block ranking relative to selected day", () => {
    const records = normalizeExport([row], { ...metadata, unitEvidence: undefined }); const record = records[0];
    const form = { ...demoFarmerForm(), cropId: record.cropId, varietyId: record.varietyId, grade: "FAQ" };
    const assumptions = { [marketAssumptionKey(record)]: createMarketForm(record) };
    const result = farmerComparison(form, assumptions, records, "reportedModal", "reported", Date.parse("2026-10-12T12:00:00+05:30"));
    expect(result.markets[0].estimate.scenarios.reportedModal.grossSaleProceeds).toBeNull();
    expect(result.markets[0].eligibility.exclusionReasons.map(x => x.code)).toContain("stale_observation"); expect(result.rankings.reportedModal.bestObservationId).toBeNull();
  });
});
describe("verified contract and honest upstream failure", () => {
  it("normalizes authentic filter field names and removes All sentinels", () => {
    // Actual field names / IDs from the successful public GET, not price fixtures.
    const result = normalizeFilters({ status: true, data: { state_data: [{ state_id: 11, state_name: "Gujarat" }, { state_id: 100000, state_name: "All States/UTs" }], district_data: [{ id: 157, state_id: 11, district_name: "Rajkot" }], market_data: [{ id: 60, state_id: 11, district_id: 157, mkt_name: "Rajkot APMC" }], cmdt_data: [{ cmdt_id: 1, cmdt_name: "Wheat" }], variety_data: [{ id: 8, cmdt_id: [1], variety_name: "147 Average" }] } }, metadata.retrievedAt);
    expect(result.states).toEqual([{ value: "11", label: "Gujarat", stateId: "11" }]); expect(result.markets[0]).toMatchObject({ value: "60", districtId: "157" }); expect(result.varieties[0].cropIds).toEqual(["1"]);
    expect(() => normalizeFilters({ status: true, data: {} }, metadata.retrievedAt)).toThrow();
  });
  it("does not retry CAPTCHA or substitute demo records", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ code: "TOKEN_OR_CAPTCHA_REQUIRED" }), { status: 400 }));
    await expect(upstreamJson("https://api.agmarknet.gov.in/v1/test", {}, fetcher)).rejects.toThrow("CAPTCHA"); expect(fetcher).toHaveBeenCalledTimes(1);
    vi.stubEnv("MANDINET_IMPORT_PATH", ""); const result = await getMarketRecords(filters); expect(result.status).toBe("unavailable"); expect(result.records).toEqual([]); expect(result.providerId).toBe("agmarknet");
  });
  it("retries a transient response only once", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response("{}", { status: 503 }));
    await expect(upstreamJson("https://api.agmarknet.gov.in/v1/test", {}, fetcher)).rejects.toThrow("503"); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("invalid configured import reports error, never demo", async () => {
    vi.stubEnv("MANDINET_IMPORT_PATH", "/nonexistent/mandinet-import.json"); const result = await getMarketRecords(filters);
    expect(result.status).toBe("error"); expect(result.records).toEqual([]); expect(result.providerId).toBe("official-local-import");
  });
});
