import { validCoordinates } from "./index";
import { mapRouteMatrix, isYardCandidate, type GooglePlace, type MarketDestination, type ConfirmedOrigin, type MarketRoute, destinationKey } from "./routing";
import { getVerifiedFilters } from "../market/agmarknet-server";

export const PLACES_URL = "https://places.googleapis.com/v1/places";
export const MATRIX_URL = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";
export const MATRIX_FIELDS = "originIndex,destinationIndex,status,condition,distanceMeters,duration";
export const PLACE_FIELDS = "id,displayName,formattedAddress,location,addressComponents,types,attributions";
export class GoogleFailure extends Error { constructor(readonly code: string, message: string, readonly status = 502) { super(message); } }
export const googleConfigured = () => !!process.env.GOOGLE_MAPS_API_KEY?.trim();
export function googleKey(): string { const key = process.env.GOOGLE_MAPS_API_KEY?.trim(); if (!key) throw new GoogleFailure("GOOGLE_NOT_CONFIGURED", "GOOGLE_MAPS_API_KEY is missing. Configure Places API (New) and Routes API server-side.", 503); return key; }
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new GoogleFailure("INVALID_RESPONSE", "Google returned an invalid response."); return value as Record<string, unknown>; }
export function inputString(value: unknown, name: string, maximum = 256): string { if (typeof value !== "string" || !value.trim() || value.length > maximum) throw new GoogleFailure("INVALID_INPUT", `Invalid ${name}.`, 400); return value.trim(); }
export const validPlaceId = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_-]{1,256}$/.test(value);
function token(value: unknown): string { const result = inputString(value, "session token", 36); if (!/^[A-Za-z0-9_-]+$/.test(result)) throw new GoogleFailure("INVALID_INPUT", "Invalid session token.", 400); return result; }
async function googleJson(url: string, fieldMask: string, body?: unknown, fetcher: typeof fetch = fetch): Promise<unknown> {
  const key = googleKey();
  try {
    const response = await fetcher(url, { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": fieldMask }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(8000), cache: "no-store" });
    if (!response.ok) throw new GoogleFailure("GOOGLE_REQUEST_FAILED", `Google request failed (HTTP ${response.status}). Check enabled APIs, billing, key restrictions and quotas.`);
    return await response.json();
  } catch (error) { if (error instanceof GoogleFailure) throw error; throw new GoogleFailure("GOOGLE_UNAVAILABLE", "Google request timed out or returned unusable data. Manual road distances remain available."); }
}
export function normalizeGooglePlace(value: unknown): GooglePlace {
  const row = object(value), location = object(row.location), displayName = object(row.displayName);
  const coordinates = { latitude: location.latitude as number, longitude: location.longitude as number, verified: true };
  if (!validCoordinates(coordinates) || !validPlaceId(row.id)) throw new GoogleFailure("INVALID_RESPONSE", "Place details have no valid ID/coordinates.");
  const components = Array.isArray(row.addressComponents) ? row.addressComponents.map(object) : [];
  const component = (type: string, short = false) => { const part = components.find(x => Array.isArray(x.types) && x.types.includes(type)); return typeof part?.[short ? "shortText" : "longText"] === "string" ? part[short ? "shortText" : "longText"] as string : ""; };
  const attributions = Array.isArray(row.attributions) ? row.attributions.map(object).filter(x => typeof x.provider === "string").map(x => ({ provider: String(x.provider), ...(typeof x.providerUri === "string" && x.providerUri.startsWith("https://") ? { uri: x.providerUri } : {}) })) : [];
  return { placeId: row.id as string, name: inputString(displayName.text, "place name"), address: inputString(row.formattedAddress, "place address", 1000), coordinates, state: component("administrative_area_level_1"), district: component("administrative_area_level_2"), countryCode: component("country", true), types: Array.isArray(row.types) ? row.types.filter(x => typeof x === "string") as string[] : [], attributions };
}
export async function getPlaceDetails(placeId: unknown, sessionToken?: unknown): Promise<GooglePlace> {
  if (!validPlaceId(placeId)) throw new GoogleFailure("INVALID_INPUT", "Invalid Place ID.", 400);
  const query = new URLSearchParams({ languageCode: "en", regionCode: "in" }); if (sessionToken) query.set("sessionToken", token(sessionToken));
  const place = normalizeGooglePlace(await googleJson(`${PLACES_URL}/${encodeURIComponent(placeId as string)}?${query}`, PLACE_FIELDS));
  if (place.countryCode !== "IN") throw new GoogleFailure("OUTSIDE_INDIA", "Select a location in India.", 400); return place;
}
export async function regionBias(state: unknown, district: unknown): Promise<unknown> {
  const stateName = inputString(state, "state", 100), districtName = typeof district === "string" ? district.slice(0, 100) : "";
  const data = object(await googleJson(`${PLACES_URL}:searchText`, "places.viewport,places.addressComponents,places.types", { textQuery: `${districtName ? `${districtName}, ` : ""}${stateName}, India`, pageSize: 1, regionCode: "in", languageCode: "en" }));
  const row = Array.isArray(data.places) ? object(data.places[0] ?? {}) : {};
  if (!row.viewport || !Array.isArray(row.types) || !row.types.some(x => ["administrative_area_level_1", "administrative_area_level_2", "locality", "political"].includes(String(x)))) return null;
  const viewport = object(row.viewport), low = object(viewport.low), high = object(viewport.high);
  if (![low, high].every(x => validCoordinates({ latitude: x.latitude as number, longitude: x.longitude as number, verified: true }))) return null;
  return { rectangle: { low, high } };
}
export async function autocomplete(input: unknown, sessionToken: unknown, bias?: unknown) {
  const body = { input: inputString(input, "village search", 200), sessionToken: token(sessionToken), includedRegionCodes: ["in"], regionCode: "in", languageCode: "en", ...(bias ? { locationBias: bias } : {}) };
  const data = object(await googleJson(`${PLACES_URL}:autocomplete`, "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text", body));
  if (!Array.isArray(data.suggestions)) return [];
  return data.suggestions.slice(0, 5).map(object).filter(x => x.placePrediction).map(x => object(x.placePrediction)).filter(x => validPlaceId(x.placeId)).map(x => ({ placeId: x.placeId as string, text: inputString(object(x.text).text, "suggestion", 1000) }));
}
export async function findMarketCandidates(marketId: unknown) {
  googleKey(); const id = inputString(marketId, "market ID");
  const filters = await getVerifiedFilters(), market = filters.markets.find(x => x.value === id);
  if (!market) throw new GoogleFailure("UNKNOWN_MARKET", "Choose a canonical real mandi. Synthetic destinations are not supported.", 400);
  const state = filters.states.find(x => x.value === market.stateId)?.label, district = filters.districts.find(x => x.value === market.districtId)?.label;
  if (!state || !district) throw new GoogleFailure("UNKNOWN_MARKET", "Market region is unresolved.", 400);
  const data = object(await googleJson(`${PLACES_URL}:searchText`, PLACE_FIELDS.split(",").map(x => `places.${x}`).join(","), { textQuery: `${market.label}, agricultural market yard, ${district}, ${state}, India`, pageSize: 3, regionCode: "in", languageCode: "en" }));
  const candidates = Array.isArray(data.places) ? data.places.slice(0, 3).map(normalizeGooglePlace).filter(isYardCandidate) : [];
  return { marketId: id, marketName: market.label, candidates };
}
export async function computeRoadRoutes(origin: ConfirmedOrigin, destinations: MarketDestination[], fetcher: typeof fetch = fetch): Promise<MarketRoute[]> {
  googleKey();
  if (!origin?.confirmed || !validCoordinates(origin.coordinates) || !Array.isArray(destinations) || !destinations.length || destinations.length > 3 || new Set(destinations.map(x => x.marketId)).size !== destinations.length || destinations.some(x => !x.verified || !validCoordinates(x.coordinates) || /^synthetic-|^demo-/i.test(x.marketId))) throw new GoogleFailure("INVALID_INPUT", "A confirmed origin and at most three distinct real verified mandi destinations are required.", 400);
  const waypoint = (coordinates: { latitude: number; longitude: number }) => ({ waypoint: { location: { latLng: { latitude: coordinates.latitude, longitude: coordinates.longitude } } } });
  const start = waypoint(origin.coordinates), markets = destinations.map(x => waypoint(x.coordinates));
  const bodies = [{ origins: [start], destinations: markets }, { origins: markets, destinations: [start] }];
  const responses = await Promise.allSettled(bodies.map(body => googleJson(MATRIX_URL, MATRIX_FIELDS, { ...body, travelMode: "DRIVE", routingPreference: "TRAFFIC_UNAWARE" }, fetcher)));
  const ids = destinations.map(x => x.marketId), outward = mapRouteMatrix(responses[0].status === "fulfilled" ? responses[0].value : null, ids, "outbound"), back = mapRouteMatrix(responses[1].status === "fulfilled" ? responses[1].value : null, ids, "return");
  for (const [index, legs] of [[0, outward], [1, back]] as const) { const response = responses[index]; if (response.status === "rejected") for (const id of ids) legs[id] = { status: "unavailable", reason: response.reason instanceof GoogleFailure ? response.reason.message : "Google route request failed" }; }
  return destinations.map(destination => ({ marketId: destination.marketId, originKey: origin.key, destinationKey: destinationKey(destination), outbound: outward[destination.marketId], returnLeg: back[destination.marketId], source: "Google Routes API", fetchedAt: new Date().toISOString() }));
}
