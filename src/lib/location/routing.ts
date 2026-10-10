import { validCoordinates, type Coordinates } from "./index";
import type { MarketForm } from "../market/form";

export const SAVED_VILLAGE_KEY = "mandinet-village-place-id-v1";
export type GoogleAttribution = { provider: string; uri?: string };
export type GooglePlace = { placeId: string; name: string; address: string; coordinates: Coordinates; state: string; district: string; countryCode: string; types: string[]; attributions: GoogleAttribution[] };
export type ConfirmedOrigin = { key: string; confirmed: true; source: "google-places" | "browser-gps"; coordinates: Coordinates; placeId?: string; name: string; address?: string; state?: string; district?: string; accuracyMetres?: number | null; attributions?: GoogleAttribution[] };
export type MarketDestination = { marketId: string; marketName: string; coordinates: Coordinates; placeId?: string; name: string; address?: string; verified: true; verification: "existing-verified" | "farmer-confirmed-google-yard"; attributions?: GoogleAttribution[] };
export type RouteLeg = { status: "ready"; km: number; durationSeconds: number } | { status: "unavailable"; reason: string };
export type MarketRoute = { marketId: string; originKey: string; destinationKey: string; outbound: RouteLeg; returnLeg: RouteLeg; source: "Google Routes API"; fetchedAt: string };
export const destinationKey = (destination: MarketDestination) => JSON.stringify([destination.marketId, destination.placeId ?? null, destination.coordinates.latitude, destination.coordinates.longitude]);
export const originKey = (coordinates: Coordinates, placeId?: string) => JSON.stringify([placeId ?? "gps", coordinates.latitude, coordinates.longitude]);
export function metresToKilometres(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value / 1000 : null;
}
const unavailable = (reason: string): RouteLeg => ({ status: "unavailable", reason });

/** Elements can arrive in any order. Missing, duplicate or failed cells never become zero. */
export function mapRouteMatrix(input: unknown, markets: string[], direction: "outbound" | "return"): Record<string, RouteLeg> {
  const result: Record<string, RouteLeg> = Object.fromEntries(markets.map(id => [id, unavailable("Route element missing")]));
  if (!Array.isArray(input)) return result;
  const seen = new Set<string>();
  for (const value of input) {
    if (!value || typeof value !== "object") continue;
    const row = value as Record<string, unknown>;
    const o = row.originIndex, d = row.destinationIndex;
    if (!Number.isInteger(o) || !Number.isInteger(d)) continue;
    const index = direction === "outbound" ? d as number : o as number;
    if ((direction === "outbound" ? o : d) !== 0 || index < 0 || index >= markets.length) continue;
    const marketId = markets[index];
    if (seen.has(marketId)) { result[marketId] = unavailable("Duplicate route element"); continue; }
    seen.add(marketId);
    const status = row.status;
    const code = status && typeof status === "object" ? (status as Record<string, unknown>).code ?? 0 : null;
    const km = metresToKilometres(row.distanceMeters);
    const duration = typeof row.duration === "string" && /^\d+(?:\.\d{1,9})?s$/.test(row.duration) ? Number(row.duration.slice(0, -1)) : NaN;
    result[marketId] = code === 0 && row.condition === "ROUTE_EXISTS" && km !== null && Number.isFinite(duration)
      ? { status: "ready", km, durationSeconds: duration } : unavailable("Google could not return a usable driving route");
  }
  return result;
}
export function currentRoute(route: MarketRoute | undefined, origin: ConfirmedOrigin | null, destination: MarketDestination | undefined): MarketRoute | null {
  return route && origin?.confirmed && destination?.verified && route.originKey === origin.key && route.destinationKey === destinationKey(destination) ? route : null;
}
export function invalidateFetchedDistances(form: MarketForm): MarketForm {
  return { ...form, ...(form.distanceMethod === "fetched" ? { outbound: "", distanceMethod: null } : {}), ...(form.returnDistanceMethod === "fetched" ? { returnKm: "", returnDistanceMethod: null } : {}) };
}
export function applyRoadRoute(form: MarketForm, route: MarketRoute): MarketForm {
  const cleaned = invalidateFetchedDistances(form);
  // Preserve explicit manual distances and every monetary assumption.
  return { ...cleaned,
    ...(form.distanceMethod !== "manual" && route.outbound.status === "ready" ? { outbound: String(route.outbound.km), distanceMethod: "fetched" as const } : {}),
    ...(form.returnDistanceMethod !== "manual" && route.returnLeg.status === "ready" ? { returnKm: String(route.returnLeg.km), returnDistanceMethod: "fetched" as const } : {}),
  };
}
export function roadLimitStatus(form: MarketForm | undefined, limitKm: number | null): "inside" | "outside" | "unknown" {
  if (!form || limitKm === null || !Number.isFinite(limitKm) || limitKm <= 0 || !form.outbound.trim()) return "unknown";
  const km = Number(form.outbound);
  return Number.isFinite(km) && km >= 0 ? km > limitKm ? "outside" : "inside" : "unknown";
}
export function googleDirectionsUrl(origin: ConfirmedOrigin | null, destination: MarketDestination | null | undefined): string | null {
  if (!origin?.confirmed || !destination?.verified || /^synthetic-|^demo-/i.test(destination.marketId) || !validCoordinates(origin.coordinates) || !validCoordinates(destination.coordinates)) return null;
  const query = new URLSearchParams({ api: "1", origin: `${origin.coordinates.latitude},${origin.coordinates.longitude}`, destination: `${destination.coordinates.latitude},${destination.coordinates.longitude}`, travelmode: "driving" });
  if (origin.placeId) query.set("origin_place_id", origin.placeId);
  if (destination.placeId) query.set("destination_place_id", destination.placeId);
  return `https://www.google.com/maps/dir/?${query}`;
}
export function placeRegionMismatch(place: Pick<GooglePlace, "state" | "district">, state: string, district: string): string[] {
  const same = (a: string, b: string) => a.trim().toLocaleLowerCase("en-IN") === b.trim().toLocaleLowerCase("en-IN");
  return [state && place.state && !same(state, place.state) ? `State: selected ${state}; Google returned ${place.state}` : "", district && place.district && !same(district, place.district) ? `District: selected ${district}; Google returned ${place.district}` : ""].filter(Boolean);
}
export function isYardCandidate(place: GooglePlace): boolean {
  return place.countryCode === "IN" && validCoordinates(place.coordinates) && !place.types.includes("political") && /apmc|mandi|market\s*yard|agricultur(?:al|e).*market|marketing\s*yard/i.test(place.name);
}
