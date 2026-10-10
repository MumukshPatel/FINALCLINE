import { randomUUID } from "node:crypto";
import type { ProviderResult, MarketRecord } from "../market";

const COOKIE = "mandinet_comparison_owner";
const TTL = 15 * 60_000;
type Snapshot = { owner: string; expires: number; records: MarketRecord[]; providerId: string };
// Server-only, bounded, ephemeral. Never expose a lookup by market/user ID.
const state = globalThis as typeof globalThis & { mandinetSnapshots?: Map<string, Snapshot> };
const snapshots = state.mandinetSnapshots ??= new Map();
export function comparisonOwner(request: Request): string | null {
  const value = request.headers.get("cookie")?.split(";").map(x => x.trim()).find(x => x.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  return value && /^[a-f0-9-]{36}$/i.test(value) ? value : null;
}
export function ownerHeaders(owner: string): Record<string, string> {
  return { "Cache-Control": "no-store", "Set-Cookie": `${COOKIE}=${owner}; HttpOnly; SameSite=Strict; Path=/; Max-Age=900${process.env.NODE_ENV === "production" ? "; Secure" : ""}` };
}
export function observationResponse(request: Request, result: ProviderResult): Response {
  const now = Date.now(), owner = comparisonOwner(request) ?? randomUUID(), id = randomUUID();
  for (const [key, value] of snapshots) if (value.expires <= now) snapshots.delete(key);
  if (snapshots.size >= 200) snapshots.delete(snapshots.keys().next().value!);
  snapshots.set(id, { owner, expires: now + TTL, records: structuredClone(result.records), providerId: result.providerId });
  return Response.json({ ...result, observationSnapshotId: id }, { headers: ownerHeaders(owner) });
}
export function readObservationSnapshot(id: unknown, owner: string | null): Snapshot {
  const found = typeof id === "string" ? snapshots.get(id) : undefined;
  if (!found || !owner || found.owner !== owner || found.expires <= Date.now()) throw new Error("OBSERVATIONS_EXPIRED");
  return structuredClone(found);
}
