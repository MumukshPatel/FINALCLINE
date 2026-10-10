import { describe, expect, it, vi, afterEach } from "vitest";
import ExcelJS from "exceljs";
import { getMarketRecords, normalizeLastWeekReport, parseWeeklyMatrixWorkbook, weeklyPrice, weeklyReportUrl, FILTER_ENDPOINT, LAST_WEEK_ENDPOINT, REPORT_ENDPOINT, type WeeklyReportContext } from "./agmarknet-server";

// Schema reproduced from the verified live Agmarknet weekly response (checked 2026-10-10);
// the price values below are test-only figures, not government records.
const weeklyPayload = {
  success: true,
  message: "Data fetched successfully.",
  title: "Commodity Prices During Last Week Market: APMC Lasalgaon , State/UT: Maharashtra",
  columns: [
    { key: "variety", title: "Commodity - Variety" },
    { key: "2026-10-08", title: "08-10-2026" },
    { key: "2026-10-07", title: "07-10-2026" },
    { key: "unitOfPrice", title: "Unit of Price" },
  ],
  data: [
    { variety: "Onion - Unhali", "2026-10-08": 3600, "2026-10-07": "NR", unitOfPrice: "Rs./Quintal" },
    { variety: "Potato - Other", "2026-10-08": 900, "2026-10-07": 910, unitOfPrice: "Rs./Quintal" },
  ],
};

const context: WeeklyReportContext = {
  url: weeklyReportUrl("161", "20", "23"),
  market: { value: "161", label: "APMC Lasalgaon ", stateId: "20", districtId: "361" },
  state: { value: "20", label: "Maharashtra" },
  district: { value: "361", label: "Nashik" },
  crop: { value: "23", label: "Onion" },
  variety: { value: "1796", label: "Unhali" },
  retrievedAt: "2026-10-10T10:00:00+05:30",
};

// Verified public filter endpoint response shape (field names from the live filters GET).
const filtersPayload = {
  status: true,
  message: "Filters fetched successfully",
  data: {
    state_data: [{ state_id: 20, state_name: "Maharashtra" }],
    district_data: [{ id: 361, state_id: 20, district_name: "Nashik" }],
    market_data: [{ id: 161, state_id: 20, district_id: 361, mkt_name: "APMC Lasalgaon " }],
    cmdt_data: [{ cmdt_id: 23, cmdt_name: "Onion", cmdt_group_id: 6 }],
    variety_data: [{ id: 1796, cmdt_id: [23], variety_name: "Unhali" }],
    cmdt_group_data: [{ id: 6, group_name: "Vegetables" }],
    note_data: [], type_data: [], grade_data: [], range_data: [],
  },
};

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("verified weekly source adapter", () => {
  it("preserves exact commodity, variety, market, price, unit, source and observation date", () => {
    const records = normalizeLastWeekReport(weeklyPayload, context);
    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record.observation.marketLabel).toBe("APMC Lasalgaon ");
    expect(record.observation.crop).toBe("Onion");
    expect(record.observation.variety).toBe("Unhali");
    expect(record.observation.observationDate).toBe("2026-10-08");
    expect(record.observation.modalPricePerQuintal).toBe(3600);
    expect(record.observation.minimumPricePerQuintal).toBeNull();
    expect(record.observation.priceUnit).toBe("INR/quintal");
    expect(record.observation.dataKind).toBe("reported");
    expect(record.observation.sourceUrl).toBe(context.url);
    expect(record.observation.sourceLabel).toBe("Agmarknet");
    expect(record.location).toMatchObject({ stateLabel: "Maharashtra", districtLabel: "Nashik", verified: true });
    expect(record.provenance).toMatchObject({ acquisitionMode: "live", originalPriceUnit: "Rs./Quintal", rawModal: 3600, rawMinimum: null, maximumPrice: null, sourceRecordId: "lastweek:161:2026-10-08" });
    expect(record.provenance?.unitEvidence).toContain("Unit of Price");
    expect(record.coordinates).toBeNull();
  });

  it("skips NR cells and rows for other crops or varieties without inventing values", () => {
    const records = normalizeLastWeekReport(weeklyPayload, context);
    expect(records.map(x => x.observation.observationDate)).toEqual(["2026-10-08"]);
    const otherVariety = normalizeLastWeekReport(weeklyPayload, { ...context, variety: { value: "1276", label: "Onion" } });
    expect(otherVariety).toEqual([]);
  });

  it("fails loudly on malformed prices, future dates and structurally invalid payloads", () => {
    expect(() => normalizeLastWeekReport({ ...weeklyPayload, data: [{ variety: "Onion - Unhali", "2026-10-08": "36O0", unitOfPrice: "Rs./Quintal" }] }, context)).toThrow("Invalid price value");
    expect(() => normalizeLastWeekReport({ ...weeklyPayload, columns: [...weeklyPayload.columns.slice(0, 3), { key: "2099-01-01", title: "01-01-2099" }, weeklyPayload.columns[3]] }, context)).toThrow("future observation date");
    expect(() => normalizeLastWeekReport({ success: false }, context)).toThrow("success");
    expect(() => normalizeLastWeekReport({ success: true, columns: [], data: [] }, context)).toThrow("date columns");
  });

  it("keeps no-record cells missing and rejects non-positive prices", () => {
    expect(weeklyPrice("NR")).toBeNull();
    expect(weeklyPrice("")).toBeNull();
    expect(weeklyPrice("-")).toBeNull();
    expect(weeklyPrice(3600)).toBe(3600);
    expect(weeklyPrice("3,600")).toBe(3600);
    expect(() => weeklyPrice(0)).toThrow();
    expect(() => weeklyPrice("abc")).toThrow();
  });

  it("loads live records through the permitted weekly endpoint and never calls the CAPTCHA-gated daily report", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      urls.push(url);
      if (url === FILTER_ENDPOINT) return Response.json(filtersPayload);
      if (url.startsWith(LAST_WEEK_ENDPOINT)) return Response.json(weeklyPayload);
      throw new Error(`Unexpected fetch: ${url}`);
    }));
    vi.unstubAllEnvs();
    const result = await getMarketRecords({ stateId: "20", districtId: "361", cropId: "23", varietyId: "1796", pricesAsOn: "2026-10-10" });
    expect(result.status).toBe("ready");
    expect(result.providerId).toBe("agmarknet");
    expect(result.exactDateOnly).toBe(false);
    expect(result.records).toHaveLength(1);
    expect(result.records[0].observation.modalPricePerQuintal).toBe(3600);
    expect(urls.some(url => url.startsWith(LAST_WEEK_ENDPOINT))).toBe(true);
    expect(urls.some(url => url.includes(REPORT_ENDPOINT))).toBe(false);
  });
});

