import { normalizeExport, parseCsv, parseExcel } from "../../../../lib/market/normalization";
import { parseWeeklyMatrixWorkbook } from "../../../../lib/market/agmarknet-server";
import { observationResponse } from "../../../../lib/agent/snapshots";
export const runtime = "nodejs";
export async function POST(request: Request) {
  // Local/protected import only; never turn this into a public unauthenticated upload API.
  const url = new URL(request.url);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || request.headers.get("origin") !== url.origin) return Response.json({ error: "Manual upload is available only from this local application." }, { status: 403 });
  if (Number(request.headers.get("content-length")) > 2_100_000) return Response.json({ error: "Import exceeds 2 MB." }, { status: 413 });
  try {
    const form = await request.formData(), file = form.get("file");
    if (!(file instanceof File) || file.size > 2_000_000) throw new Error("Choose a CSV, JSON or XLSX file of at most 2 MB");
    let records: unknown, metadata: Record<string, unknown>;
    if (file.name.toLowerCase().endsWith(".json")) { const data = JSON.parse(await file.text()); records = data.records; metadata = data.metadata; if (!metadata || typeof metadata !== "object") throw new Error("JSON metadata is required"); }
    else if (file.name.toLowerCase().endsWith(".csv")) { records = parseCsv(await file.text()); metadata = { sourceUrl: form.get("sourceUrl"), retrievedAt: form.get("retrievedAt"), priceUnit: form.get("priceUnit"), unitEvidence: form.get("unitEvidence") }; }
    else if (file.name.toLowerCase().endsWith(".xlsx")) {
      const buffer = await file.arrayBuffer();
      // Authentic Agmarknet weekly Excel matrix first (auto-detected); otherwise the documented flat schema.
      const weekly = await parseWeeklyMatrixWorkbook(buffer);
      const formMetadata = { sourceUrl: form.get("sourceUrl"), retrievedAt: form.get("retrievedAt"), priceUnit: form.get("priceUnit"), unitEvidence: form.get("unitEvidence") };
      if (weekly) { records = weekly.rows; metadata = { ...formMetadata, priceUnit: weekly.priceUnit ?? form.get("priceUnit"), unitEvidence: String(form.get("unitEvidence") ?? "").trim() || weekly.evidence }; }
      else { records = await parseExcel(buffer); metadata = formMetadata; }
    } else throw new Error("Choose a CSV, JSON or XLSX export");
    const normalized = normalizeExport(records, { sourceUrl: String(metadata.sourceUrl ?? ""), retrievedAt: String(metadata.retrievedAt ?? ""), priceUnit: typeof metadata.priceUnit === "string" ? metadata.priceUnit : undefined, unitEvidence: typeof metadata.unitEvidence === "string" ? metadata.unitEvidence : undefined, acquisitionMode: "manual-import" });
    return observationResponse(request, { status: "ready", records: normalized, providerId: "official-manual-import", retrievedAt: normalized[0]?.retrievedAt ?? null, exactDateOnly: false });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid export" }, { status: 400 }); }
}
