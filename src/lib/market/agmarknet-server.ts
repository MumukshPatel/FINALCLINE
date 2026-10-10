import type { FilterChoice, MarketFilters, MarketRecord, ProviderResult, VerifiedFilters } from "./index";
import { calendarDate, kolkataToday, normalizeExport, priceValue } from "./normalization";
import { readFile, stat } from "node:fs/promises";
import ExcelJS from "exceljs";

export const FILTER_ENDPOINT = "https://api.agmarknet.gov.in/v1/daily-price-arrival/filters";
/** CAPTCHA-gated daily report endpoint. Documented for reference only — never called, never bypassed. */
export const REPORT_ENDPOINT = "https://api.agmarknet.gov.in/v1/prices-and-arrivals/market-report/daily";
/** Public "Commodity Prices During Last Week" report, verified against live government records without CAPTCHA. */
export const LAST_WEEK_ENDPOINT = "https://api.agmarknet.gov.in/v1/prices-and-arrivals/commodity-price/lastweek";
const headers = { Accept: "application/json, text/plain, */*", Origin: "https://agmarknet.gov.in", Referer: "https://agmarknet.gov.in/", "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36" };
const cache = new Map<string, { storedAt: number; value: unknown }>();
class UpstreamError extends Error { constructor(message: string, readonly transient = false) { super(message); } }
export async function upstreamJson(url: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetcher(url, { ...init, headers: { ...headers, ...init.headers }, signal: AbortSignal.timeout(8000), cache: "no-store" });
      const body: unknown = await response.json().catch(() => { throw new UpstreamError(`Agmarknet HTTP ${response.status} — non-JSON response`, [429, 502, 503, 504].includes(response.status)); });
      if (!response.ok) {
        const code = body && typeof body === "object" ? (body as Record<string, unknown>).code : null;
        throw new UpstreamError(code === "TOKEN_OR_CAPTCHA_REQUIRED" ? "HTTP 400 — CAPTCHA or authorized token required; no bypass attempted." : `Agmarknet HTTP ${response.status}`, [429, 502, 503, 504].includes(response.status));
      }
      return body;
    } catch (error) {
      const transient = error instanceof UpstreamError ? error.transient : error instanceof Error && ["TimeoutError", "AbortError", "TypeError"].includes(error.name);
      if (!transient || attempt === 1) throw error;
    }
  }
  throw new Error("Upstream unavailable");
}
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid upstream object"); return value as Record<string, unknown>; }
export function normalizeFilters(input: unknown, retrievedAt: string): VerifiedFilters {
  const root = object(input); if (root.status !== true) throw new Error("Filter response did not report success");
  const data = object(root.data);
  const list = (key: string, id: string, label: string): FilterChoice[] => {
    if (!Array.isArray(data[key]) || data[key].length > 10000) throw new Error(`Invalid ${key}`);
    return data[key].map(object).filter(row => typeof row[id] === "number" && Number.isInteger(row[id]) && (row[id] as number) > 0 && (row[id] as number) < 100000 && typeof row[label] === "string").map(row => ({ value: String(row[id]), label: (row[label] as string).trim(), ...(typeof row.state_id === "number" ? { stateId: String(row.state_id) } : {}), ...(typeof row.district_id === "number" ? { districtId: String(row.district_id) } : {}), ...(Array.isArray(row.cmdt_id) ? { cropIds: row.cmdt_id.filter(x => typeof x === "number").map(String) } : {}) }));
  };
  return { states: list("state_data", "state_id", "state_name"), districts: list("district_data", "id", "district_name"), markets: list("market_data", "id", "mkt_name"), crops: list("cmdt_data", "cmdt_id", "cmdt_name"), varieties: list("variety_data", "id", "variety_name"), retrievedAt, sourceEndpoint: FILTER_ENDPOINT };
}
export async function getVerifiedFilters(): Promise<VerifiedFilters> {
  const cached = cache.get(FILTER_ENDPOINT);
  if (cached && Date.now() - cached.storedAt < 300000) return cached.value as VerifiedFilters;
  try { const value = normalizeFilters(await upstreamJson(FILTER_ENDPOINT), new Date().toISOString()); cache.set(FILTER_ENDPOINT, { storedAt: Date.now(), value }); return value; }
  catch (error) { if (cached) return { ...(cached.value as VerifiedFilters), cached: true, error: "Refresh failed — showing cached data." }; throw error; }
}

export function weeklyReportUrl(marketId: string, stateId: string, cropId: string): string {
  return `${LAST_WEEK_ENDPOINT}?marketId=${encodeURIComponent(marketId)}&stateId=${encodeURIComponent(stateId)}&commodityId=${encodeURIComponent(cropId)}&includeExcel=false`;
}

const NO_RECORD_VALUES = new Set(["", "-", "–", "—", "nr", "n.a.", "na", "n/a", "no record", "not reported"]);
/** One cell of the weekly price matrix. "NR"/empty cells stay missing; malformed values fail loudly, never guessed. */
export function weeklyPrice(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && NO_RECORD_VALUES.has(value.trim().toLowerCase())) return null;
  const text = typeof value === "number" ? String(value) : String(value).trim();
  return priceValue(/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(text) ? text.replace(/,/g, "") : text);
}

export type WeeklyReportContext = { url: string; market: FilterChoice; state: FilterChoice; district: FilterChoice; crop: FilterChoice; variety: FilterChoice; retrievedAt: string };

export function weeklyUnitEvidence(context: WeeklyReportContext, unit: string): string {
  return `Unit of Price column of the Agmarknet "Commodity Prices During Last Week" report for ${context.market.label.trim()} (reported: ${unit || "not stated"}); the report publishes one price per day, recorded here as that day's modal price.`;
}

/**
 * Best verified source adapter: permitted public weekly report, tested live against government records.
 * Preserves exact commodity, variety, market, price, unit, source endpoint and observation date.
 * Structural problems throw; absent cells stay absent; the CAPTCHA-gated daily report is never called.
 */
export function normalizeLastWeekReport(payload: unknown, context: WeeklyReportContext): MarketRecord[] {
  const root = object(payload);
  if (root.success !== true) throw new Error("Agmarknet weekly report did not report success");
  const columns = root.columns;
  if (!Array.isArray(columns) || columns.length < 3 || columns.length > 40) throw new Error("Agmarknet weekly report has no usable date columns");
  const dates = columns.map(entry => object(entry).key).filter((key): key is string => typeof key === "string" && calendarDate(key) === key);
  if (!dates.length) throw new Error("Agmarknet weekly report has no valid observation dates");
  if (dates.some(date => date > kolkataToday())) throw new Error("Agmarknet weekly report contains a future observation date");
  const rows = root.data;
  if (!Array.isArray(rows) || rows.length > 5000) throw new Error("Agmarknet weekly report rows are missing or implausible");
  const cropLabel = context.crop.label.trim(), varietyLabel = context.variety.label.trim();
  const cells: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  rows.forEach(value => {
    const row = object(value);
    const label = typeof row.variety === "string" ? row.variety.trim() : "";
    const split = label.indexOf(" - ");
    if (split < 0 || label.slice(0, split).trim() !== cropLabel || label.slice(split + 3).trim() !== varietyLabel) return;
    const unit = typeof row.unitOfPrice === "string" ? row.unitOfPrice.trim() : "";
    for (const date of dates) {
      const price = weeklyPrice(row[date]);
      if (price === null || seen.has(date)) continue;
      seen.add(date);
      cells.push({ market_id: context.market.value, market_name: context.market.label, state_id: context.state.value, state_name: context.state.label, district_id: context.district.value, district_name: context.district.label, crop_id: context.crop.value, crop_name: context.crop.label, variety_id: context.variety.value, variety_name: context.variety.label, observation_date: date, minimum_price: null, modal_price: price, maximum_price: null, price_unit: unit, source_record_id: `lastweek:${context.market.value}:${date}` });
    }
  });
  const byUnit = new Map<string, Record<string, unknown>[]>();
  for (const cell of cells) { const unit = String(cell.price_unit ?? ""); const group = byUnit.get(unit) ?? []; group.push(cell); byUnit.set(unit, group); }
  const records: MarketRecord[] = [];
  for (const [unit, group] of byUnit) records.push(...normalizeExport(group, { sourceUrl: context.url, retrievedAt: context.retrievedAt, priceUnit: unit || undefined, unitEvidence: weeklyUnitEvidence(context, unit), acquisitionMode: "live" }));
  return records;
}
export type WeeklyWorkbook = { rows: Record<string, unknown>[]; priceUnit: string | null; evidence: string };

/**
 * Authentic Agmarknet weekly Excel matrix (title rows, "Commodity - Variety", DD-MM-YYYY dates, "Unit of Price").
 * Returns null when the workbook is not that report so callers can fall back to the documented flat schema.
 * IDs are resolved against the verified live filter list; unmatched labels fail the import instead of being guessed.
 */
export async function parseWeeklyMatrixWorkbook(input: ArrayBuffer): Promise<WeeklyWorkbook | null> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(input);
  const sheet = workbook.worksheets[0];
  if (!sheet) return null;
  const text = (row: number, column: number): string => {
    const value = sheet.getRow(row).getCell(column).value;
    if (value == null) return "";
    if (typeof value === "object" && "result" in value) return String((value as { result: unknown }).result ?? "").trim();
    return String(value).trim();
  };
  let headerRow = 0;
  for (let row = 1; row <= Math.min(sheet.rowCount, 12); row++) if (text(row, 1) === "Commodity - Variety") { headerRow = row; break; }
  if (!headerRow) return null;
  const dates = new Map<number, string>();
  let unitColumn = 0;
  for (let column = 2; column <= sheet.getRow(headerRow).cellCount; column++) {
    const label = text(headerRow, column);
    const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(label);
    if (match) {
      const iso = `${match[3]}-${match[2]}-${match[1]}`;
      if (!calendarDate(iso) || iso > kolkataToday()) throw new Error(`Weekly Excel contains an invalid or future date column "${label}"`);
      dates.set(column, iso);
    } else if (/^unit of price$/i.test(label)) unitColumn = column;
  }
  if (!dates.size || !unitColumn) throw new Error("Weekly Excel must contain date columns and a Unit of Price column");
  let context = "";
  for (let row = 1; row < headerRow; row++) { const value = text(row, 1); if (/Market\s*:/.test(value)) { context = value; break; } }
  const parsed = /Market\s*:\s*(.+?)\s*,\s*State\/UT\s*:\s*(.+)$/.exec(context);
  if (!parsed) throw new Error("Weekly Excel does not name its market and state");
  const filters = await getVerifiedFilters();
  const state = filters.states.find(x => x.label.trim() === parsed[2].trim());
  if (!state) throw new Error(`State "${parsed[2].trim()}" from the workbook is not in the current Agmarknet filter list.`);
  const markets = filters.markets.filter(x => x.stateId === state.value && x.label.trim() === parsed[1].trim());
  if (!markets.length) throw new Error(`Market "${parsed[1].trim()}" from the workbook is not in the current Agmarknet filter list.`);
  if (markets.length > 1) throw new Error(`Market "${parsed[1].trim()}" matches more than one market in ${state.label.trim()}; the workbook alone is ambiguous.`);
  const market = markets[0], district = filters.districts.find(x => x.value === market.districtId && x.stateId === state.value);
  if (!district) throw new Error("The workbook market has no verified district.");
  const rows: Record<string, unknown>[] = [];
  const units = new Set<string>(), seen = new Set<string>();
  for (let row = headerRow + 1; row <= sheet.rowCount && rows.length < 5000; row++) {
    const label = text(row, 1);
    if (!label) continue;
    const split = label.indexOf(" - ");
    const cropPart = split < 0 ? "" : label.slice(0, split).trim(), varietyPart = split < 0 ? "" : label.slice(split + 3).trim();
    const crop = filters.crops.find(x => x.label.trim() === cropPart);
    const variety = crop && filters.varieties.find(x => x.cropIds?.includes(crop.value) && x.label.trim() === varietyPart);
    if (!crop || !variety) throw new Error(`Weekly Excel row ${row} ("${label}") does not match a current Agmarknet commodity and variety.`);
    const unit = text(row, unitColumn);
    units.add(unit);
    for (const [column, date] of dates) {
      const value = sheet.getRow(row).getCell(column).value;
      const price = weeklyPrice(value != null && typeof value === "object" && "result" in value ? (value as { result: unknown }).result : value);
      const cellId = JSON.stringify([crop.value, variety.value, date]);
      if (price === null || seen.has(cellId)) continue;
      seen.add(cellId);
      rows.push({ market_id: market.value, market_name: market.label, state_id: state.value, state_name: state.label, district_id: district.value, district_name: district.label, crop_id: crop.value, crop_name: crop.label, variety_id: variety.value, variety_name: variety.label, observation_date: date, minimum_price: null, modal_price: price, maximum_price: null, price_unit: unit, source_record_id: `lastweek:${market.value}:${date}` });
    }
  }
  if (!rows.length) throw new Error("Weekly Excel contains no published prices for its data rows.");
  const title = text(1, 1) || "Commodity Prices during last week";
  return { rows, priceUnit: units.size === 1 ? [...units][0]! : null, evidence: `Unit of Price column of the supplied Agmarknet weekly Excel export ("${title}", ${market.label.trim()}, ${state.label.trim()}); the report publishes one price per day, recorded here as that day's modal price.` };
}

export async function getMarketRecords(filters: MarketFilters): Promise<ProviderResult> {
  const base: ProviderResult = { status: "unavailable", providerId: "agmarknet", records: [], retrievedAt: null, exactDateOnly: true };
  if (process.env.MANDINET_IMPORT_PATH) {
    const importKey = JSON.stringify(["local-import", process.env.MANDINET_IMPORT_PATH, filters]);
    const previous = cache.get(importKey);
    try {
      const path = process.env.MANDINET_IMPORT_PATH;
      if ((await stat(path)).size > 2_000_000) throw new Error("Import exceeds 2 MB");
      const input = object(JSON.parse(await readFile(path, "utf8")));
      const metadata = object(input.metadata);
      const records = normalizeExport(input.records, { sourceUrl: String(metadata.sourceUrl ?? ""), retrievedAt: String(metadata.retrievedAt ?? ""), priceUnit: typeof metadata.priceUnit === "string" ? metadata.priceUnit : undefined, unitEvidence: typeof metadata.unitEvidence === "string" ? metadata.unitEvidence : undefined, acquisitionMode: "manual-import" });
      const result = { ...base, status: "ready" as const, providerId: "official-local-import", records, retrievedAt: records[0]?.retrievedAt ?? null, exactDateOnly: false };
      cache.set(importKey, { storedAt: Date.now(), value: result }); return result;
    } catch {
      if (previous) return { ...(previous.value as ProviderResult), cached: true, error: "Refresh failed — showing cached data." };
      return { ...base, status: "error", providerId: "official-local-import", error: "Configured official import is unreadable or invalid. Check the documented export schema." };
    }
  }
  if (!filters.stateId || !filters.districtId || !filters.cropId || !filters.varietyId || !filters.pricesAsOn) return { ...base, error: "Choose a state, district, crop, variety and report date, then refresh." };
  const key = JSON.stringify([LAST_WEEK_ENDPOINT, filters]); const cached = cache.get(key);
  if (cached && Date.now() - cached.storedAt < 60000) return cached.value as ProviderResult;
  try {
    const metadata = await getVerifiedFilters();
    const date = calendarDate(filters.pricesAsOn);
    if (!date || date > kolkataToday() || date < "2025-11-07") throw new Error("Report date must be between Agmarknet 2.0 launch (2025-11-07) and today in Kolkata.");
    if (!metadata.states.some(x => x.value === filters.stateId) || !metadata.districts.some(x => x.value === filters.districtId && x.stateId === filters.stateId) || !metadata.crops.some(x => x.value === filters.cropId) || !metadata.varieties.some(x => x.value === filters.varietyId && x.cropIds?.includes(filters.cropId))) throw new Error("Choose matching verified filter IDs.");
    const state = metadata.states.find(x => x.value === filters.stateId)!, district = metadata.districts.find(x => x.value === filters.districtId)!, crop = metadata.crops.find(x => x.value === filters.cropId)!, variety = metadata.varieties.find(x => x.value === filters.varietyId)!;
    const markets = metadata.markets.filter(x => x.stateId === filters.stateId && x.districtId === filters.districtId && (!filters.marketId || x.value === filters.marketId));
    if (!markets.length) throw new Error("No matching verified markets.");
    if (markets.length > 20) throw new Error("This district has more than 20 markets. Choose one market to keep the query bounded.");
    // Permitted public weekly report — tested live. The CAPTCHA-gated daily report (REPORT_ENDPOINT) is never called or bypassed.
    const retrievedAt = new Date().toISOString();
    const records: MarketRecord[] = [], failures: string[] = [];
    for (let index = 0; index < markets.length; index += 5) {
      const batch = markets.slice(index, index + 5);
      const settled = await Promise.allSettled(batch.map(async market => {
        const url = weeklyReportUrl(market.value, filters.stateId!, filters.cropId!);
        return normalizeLastWeekReport(await upstreamJson(url), { url, market, state, district, crop, variety, retrievedAt });
      }));
      settled.forEach((outcome, offset) => {
        if (outcome.status === "fulfilled") records.push(...outcome.value);
        else failures.push(`${batch[offset].label.trim()}: ${outcome.reason instanceof Error ? outcome.reason.message : "Agmarknet request failed"}`);
      });
    }
    if (failures.length === markets.length) throw new Error(failures[0]);
    // Records keep their original observation dates; the report window ends when upstream publishes it.
    const result: ProviderResult = { ...base, status: "ready", records, retrievedAt, exactDateOnly: false, ...(failures.length ? { error: `Some market reports failed — ${failures.join("; ")}` } : {}) };
    cache.set(key, { storedAt: Date.now(), value: result }); return result;
  } catch (error) {
    if (cached) return { ...(cached.value as ProviderResult), cached: true, error: "Refresh failed — showing cached data." };
    return { ...base, status: "error", error: error instanceof Error ? error.message : "Agmarknet request failed" };
  }
}
