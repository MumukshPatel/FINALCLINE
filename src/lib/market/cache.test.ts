import { afterEach, expect, it, vi } from "vitest";
import { stat, readFile } from "node:fs/promises";
import { getMarketRecords } from "./agmarknet-server";

vi.mock("node:fs/promises", () => ({ stat: vi.fn(), readFile: vi.fn() }));
afterEach(() => vi.unstubAllEnvs());
it("refresh failure keeps the original cached import dates and does not cross filters", async () => {
  // SYNTHETIC in-memory test export; not an authentic record or a runnable demo source.
  vi.stubEnv("MANDINET_IMPORT_PATH", "/synthetic-test-only/import.json");
  vi.mocked(stat).mockResolvedValue({ size: 1000 } as Awaited<ReturnType<typeof stat>>);
  vi.mocked(readFile).mockResolvedValue(JSON.stringify({ metadata: { sourceUrl: "https://agmarknet.gov.in/home", retrievedAt: "2026-10-10T10:00:00Z" }, records: [{ market_id: "test", market_name: "Synthetic cache test", state_id: "test", state_name: "Test", district_id: "test", district_name: "Test", crop_id: "test", crop_name: "Test", variety_id: "test", variety_name: "Test", observation_date: "2026-10-01", modal_price: "", minimum_price: "" }] }));
  const filters = { stateId: "test", districtId: "test", cropId: "test", varietyId: "test", pricesAsOn: "2026-10-10" };
  const first = await getMarketRecords(filters); expect(first.status).toBe("ready");
  vi.mocked(stat).mockRejectedValue(new Error("Read failed"));
  const cached = await getMarketRecords(filters);
  expect(cached.cached).toBe(true); expect(cached.error).toBe("Refresh failed — showing cached data.");
  expect(cached.records[0].observation.observationDate).toBe("2026-10-01"); expect(cached.retrievedAt).toBe("2026-10-10T10:00:00Z"); expect(cached.records[0].demoDefaults).toBeUndefined();
  const different = await getMarketRecords({ ...filters, pricesAsOn: "2026-10-09" }); expect(different.status).toBe("error"); expect(different.records).toEqual([]);
});
