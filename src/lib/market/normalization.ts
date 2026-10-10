import type { MarketRecord } from "./index";
import ExcelJS from "exceljs";

export async function parseExcel(input: ArrayBuffer): Promise<Row[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(input);
  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount < 1) throw new Error("Excel workbook has no worksheet or header row");
  const headerRow = sheet.getRow(1);
  const headers = Array.from({ length: headerRow.cellCount }, (_, index) => headerRow.getCell(index + 1).text.trim());
  if (!headers.length || headers.some(x => !x) || new Set(headers).size !== headers.length) throw new Error("Excel worksheet requires unique non-empty column headers");
  const rows: Row[] = [];
  sheet.eachRow((source, rowNumber) => {
    if (rowNumber === 1 || rows.length >= 5001) return;
    const record: Row = {};
    headers.forEach((header, index) => {
      const value = source.getCell(index + 1).value;
      const scalar = value && typeof value === "object" && "result" in value ? value.result : value;
      record[header] = header === "observation_date" && scalar instanceof Date ? scalar.toISOString().slice(0, 10) : scalar == null ? "" : typeof scalar === "object" ? source.getCell(index + 1).text : scalar;
    });
    if (Object.values(record).some(value => String(value).trim())) rows.push(record);
  });
  if (rows.length > 5000) throw new Error("Export must contain at most 5,000 rows");
  return rows;
}

export function calendarDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let date = value.trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(date)) date = date.split("/").reverse().join("-");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date ? date : null;
}
export function kolkataToday(epoch = Date.now()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(epoch);
  return ["year", "month", "day"].map(type => parts.find(part => part.type === type)!.value).join("-");
}
export function priceValue(value: unknown): number | null {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return null;
  if (typeof value !== "string" && typeof value !== "number") throw new Error("Invalid price value");
  const text = String(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) throw new Error("Invalid price value");
  const result = Number(text);
  if (!Number.isFinite(result) || result <= 0) throw new Error("Prices must be positive or missing");
  return result;
}
export function officialUrl(value: unknown): string {
  if (typeof value !== "string") throw new Error("Official source URL required");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || !["agmarknet.gov.in", "api.agmarknet.gov.in", "data.gov.in", "www.data.gov.in", "api.data.gov.in"].includes(url.hostname) || /api.?key|token|secret/i.test(url.search)) throw new Error("Use an official HTTPS source URL without credentials");
  return url.href;
}
type Row = Record<string, unknown>;
function required(row: Row, key: string): string {
  const value = row[key];
  if ((typeof value !== "string" && typeof value !== "number") || !String(value).trim()) throw new Error(`Missing ${key}`);
  return String(value).trim();
}
export type SourceMetadata = { sourceUrl: string; retrievedAt: string; priceUnit?: string; unitEvidence?: string; acquisitionMode: "live" | "manual-import" };

/** Our documented export schema, not an invented Agmarknet report response shape. */
export function normalizeExport(rows: unknown, metadata: SourceMetadata): MarketRecord[] {
  const sourceUrl = officialUrl(metadata.sourceUrl);
  if (!Number.isFinite(Date.parse(metadata.retrievedAt)) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(metadata.retrievedAt) || !calendarDate(metadata.retrievedAt.slice(0, 10))) throw new Error("A retrieval timestamp with timezone is required");
  if (Date.parse(metadata.retrievedAt) > Date.now() + 60000) throw new Error("Retrieval timestamp is in the future");
  if (!Array.isArray(rows) || rows.length > 5000) throw new Error("Export must contain at most 5,000 rows");
  const evidence = metadata.unitEvidence?.trim() || null;
  return rows.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid row ${index + 1}`);
    const row = value as Row;
    const date = calendarDate(row.observation_date);
    if (!date || date > kolkataToday()) throw new Error(`Invalid/future observation date in row ${index + 1}`);
    const marketId = required(row, "market_id"), cropId = required(row, "crop_id"), varietyId = required(row, "variety_id");
    const rawMinimum = priceValue(row.minimum_price), rawModal = priceValue(row.modal_price), maximum = priceValue(row.maximum_price);
    if ((rawMinimum !== null && rawModal !== null && rawMinimum > rawModal) || (maximum !== null && rawModal !== null && maximum < rawModal) || (maximum !== null && rawMinimum !== null && maximum < rawMinimum)) throw new Error(`Inconsistent prices in row ${index + 1}`);
    const unit = typeof row.price_unit === "string" && row.price_unit.trim() ? row.price_unit.trim() : metadata.priceUnit?.trim() || null;
    // Explicit declaration plus source evidence required; no inferred unit/conversion.
    const known = !!evidence && !!unit && /^(INR\/quintal|Rs\.?\s*\/\s*quintal|₹\s*\/\s*quintal)$/i.test(unit);
    const sourceRecordId = row.source_record_id == null || String(row.source_record_id).trim() === "" ? null : String(row.source_record_id);
    const grade = typeof row.grade === "string" && row.grade.trim() ? row.grade.trim() : undefined;
    return {
      observation: { id: JSON.stringify([marketId, cropId, varietyId, grade ?? "", date, sourceRecordId]), marketId, marketLabel: required(row, "market_name"), crop: required(row, "crop_name"), variety: required(row, "variety_name"), grade, observationDate: date, priceUnit: known ? "INR/quintal" : "unknown", minimumPricePerQuintal: known ? rawMinimum : null, modalPricePerQuintal: known ? rawModal : null, dataKind: "reported", sourceLabel: metadata.acquisitionMode === "manual-import" ? "Official export — user-supplied provenance" : "Agmarknet", sourceUrl },
      cropId, varietyId, location: { stateId: required(row, "state_id"), stateLabel: required(row, "state_name"), districtId: required(row, "district_id"), districtLabel: required(row, "district_name"), label: `${required(row, "district_name")}, ${required(row, "state_name")}`, verified: true }, coordinates: null, roadDistance: null, retrievedAt: metadata.retrievedAt,
      provenance: { sourceRecordId, sourceEndpoint: sourceUrl, acquisitionMode: metadata.acquisitionMode, originalPriceUnit: unit, unitEvidence: evidence, maximumPrice: maximum, rawMinimum, rawModal },
    } satisfies MarketRecord;
  });
}

/** RFC-style quoted CSV including commas/newlines and escaped quotes. */
export function parseCsv(input: string): Row[] {
  const rows: string[][] = []; let row: string[] = [], cell = "", quoted = false;
  const text = input.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else if (!quoted && cell) throw new Error("Malformed CSV quoting"); else quoted = !quoted; }
    else if (char === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) { if (char === "\r" && text[i + 1] === "\n") i++; row.push(cell); if (row.some(x => x.trim())) rows.push(row); row = []; cell = ""; }
    else cell += char;
  }
  if (quoted) throw new Error("Unclosed CSV quote");
  row.push(cell); if (row.some(x => x.trim())) rows.push(row);
  const headers = rows.shift()?.map(x => x.trim());
  if (!headers?.length || new Set(headers).size !== headers.length) throw new Error("Unique CSV column headers required");
  return rows.map((values, i) => { if (values.length !== headers.length) throw new Error(`CSV column mismatch at row ${i + 2}`); return Object.fromEntries(headers.map((key, j) => [key, values[j]])); });
}
