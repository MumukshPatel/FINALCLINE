import { randomUUID } from "node:crypto";
import { bindComparison } from "../../../../lib/agent/bound-comparison";
import { comparisonOwner, ownerHeaders } from "../../../../lib/agent/snapshots";
import { runClineComparison, CLINE_TIMEOUT_MS, clineConfiguration } from "../../../../lib/agent/cline";
export const runtime = "nodejs";
export const maxDuration = 35;
const limits = globalThis as typeof globalThis & { mandinetAgentLimits?: Map<string, { calls: number; reset: number; active: boolean }>; mandinetAgentActive?: number };
const owners = limits.mandinetAgentLimits ??= new Map();
export async function GET() { return Response.json({ configuration: clineConfiguration() }, { headers: { "Cache-Control": "no-store" } }); }
export async function POST(request: Request) {
  const url = new URL(request.url), applicationOrigin = `${url.protocol}//${request.headers.get("host") ?? url.host}`;
  if (request.headers.get("origin") !== applicationOrigin) return Response.json({ error: "Same-Origin application request required." }, { status: 403 });
  if (Number(request.headers.get("content-length")) > 150_000) return Response.json({ error: "Comparison request too large." }, { status: 413 });
  const owner = comparisonOwner(request) ?? randomUUID(), now = Date.now();
  for (const [id, value] of owners) if (!value.active && value.reset <= now) owners.delete(id);
  const rate = owners.get(owner) ?? { calls: 0, reset: now + 60_000, active: false };
  if (rate.active || rate.calls >= 2 || (limits.mandinetAgentActive ?? 0) >= 2 || owners.size >= 200) return Response.json({ error: "Explanation request limit reached. Try again shortly." }, { status: 429 });
  let bound: ReturnType<typeof bindComparison>;
  try { const text = await request.text(); if (text.length > 150_000) throw new Error("INVALID_COMPARISON"); bound = bindComparison(JSON.parse(text), comparisonOwner(request)); }
  catch (error) { const code = error instanceof Error ? error.message : "INVALID_COMPARISON"; return Response.json({ error: ["OBSERVATIONS_EXPIRED", "COMPARISON_CHANGED"].includes(code) ? code : "INVALID_COMPARISON" }, { status: 400 }); }
  rate.calls++; rate.active = true; owners.set(owner, rate); limits.mandinetAgentActive = (limits.mandinetAgentActive ?? 0) + 1;
  const controller = new AbortController(), encoder = new TextEncoder();
  const abort = () => controller.abort(); request.signal.addEventListener("abort", abort, { once: true });
  let closed = false;
  const stream = new ReadableStream({ async start(streamController) {
    const send = (data: unknown) => { if (!closed) streamController.enqueue(encoder.encode(`${JSON.stringify(data)}\n`)); };
    const timer = setTimeout(() => controller.abort(), CLINE_TIMEOUT_MS);
    try { const result = await runClineComparison(bound, activity => send({ activity }), controller.signal); send({ result }); }
    catch { send({ result: { status: "unavailable", sdkExecuted: false, mode: bound.input.mode, scenario: bound.input.scenario, comparisonId: bound.comparisonId, calculationId: bound.calculationId, lines: bound.lines, bestObservationId: bound.bestObservationId, toolsRan: [], reason: "CLINE_INITIALIZATION_FAILED" } }); }
    finally { clearTimeout(timer); request.signal.removeEventListener("abort", abort); rate.active = false; limits.mandinetAgentActive!--; if (!closed) { closed = true; streamController.close(); } }
  }, cancel() { closed = true; controller.abort(); } });
  return new Response(stream, { headers: { ...ownerHeaders(owner), "Content-Type": "application/x-ndjson; charset=utf-8", "X-Accel-Buffering": "no" } });
}
