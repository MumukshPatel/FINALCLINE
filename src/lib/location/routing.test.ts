import { describe, expect, it } from "vitest";
import { calculateTransport } from "../calculator";
import { createMarketForm, formTransport } from "../market/form";
import { requestLocation } from "./index";
import { applyRoadRoute, currentRoute, destinationKey, googleDirectionsUrl, invalidateFetchedDistances, isYardCandidate, mapRouteMatrix, metresToKilometres, originKey, placeRegionMismatch, roadLimitStatus, type ConfirmedOrigin, type GooglePlace, type MarketDestination, type MarketRoute } from "./routing";

// SYNTHETIC test coordinates / IDs, not verified real mandi destinations.
const coords = { latitude: 20, longitude: 75, verified: true };
const origin: ConfirmedOrigin = { key: originKey(coords, "test_origin"), confirmed: true, source: "google-places", coordinates: coords, placeId: "test_origin", name: "Synthetic origin" };
const destination: MarketDestination = { marketId: "test-market", marketName: "Synthetic market", coordinates: { ...coords, longitude: 76 }, placeId: "test_destination", name: "Synthetic APMC yard", verified: true, verification: "farmer-confirmed-google-yard" };
const route: MarketRoute = { marketId: destination.marketId, originKey: origin.key, destinationKey: destinationKey(destination), outbound: { status: "ready", km: 25.25, durationSeconds: 600 }, returnLeg: { status: "ready", km: 27.5, durationSeconds: 660 }, source: "Google Routes API", fetchedAt: "2026-10-10T12:00:00Z" };
const element = (o: number, d: number, metres: number) => ({ originIndex: o, destinationIndex: d, status: {}, condition: "ROUTE_EXISTS", distanceMeters: metres, duration: "120.5s" });
describe("route safety and deterministic cost integration", () => {
  it("converts metres without rounding or inventing a missing zero", () => {
    expect(metresToKilometres(25250)).toBe(25.25); expect(metresToKilometres(0)).toBe(0);
    for (const value of [null, undefined, "1000", NaN, Infinity, -1]) expect(metresToKilometres(value)).toBeNull();
  });
  it("maps out-of-order outward elements by destination index", () => {
    const result = mapRouteMatrix([element(0, 2, 3000), element(0, 0, 1000), element(0, 1, 2000)], ["A", "B", "C"], "outbound");
    expect(result.A).toMatchObject({ status: "ready", km: 1 }); expect(result.B).toMatchObject({ status: "ready", km: 2 }); expect(result.C).toMatchObject({ status: "ready", km: 3 });
  });
  it("maps reversed matrix by origin index, not the outbound order", () => {
    const result = mapRouteMatrix([element(1, 0, 3500), element(0, 0, 1500)], ["A", "B"], "return");
    expect(result.A).toMatchObject({ km: 1.5 }); expect(result.B).toMatchObject({ km: 3.5 });
  });
  it("failed, missing, duplicate, invalid index and missing status routes never become zero", () => {
    const failed = { ...element(0, 0, 0), status: { code: 5 }, condition: "ROUTE_NOT_FOUND" };
    expect(mapRouteMatrix([failed], ["A", "B"], "outbound")).toMatchObject({ A: { status: "unavailable" }, B: { status: "unavailable" } });
    expect(mapRouteMatrix([element(0, 0, 100), element(0, 0, 200)], ["A"], "outbound").A.status).toBe("unavailable");
    expect(mapRouteMatrix([{ ...element(0, 0, 100), originIndex: undefined }], ["A"], "outbound").A.status).toBe("unavailable");
    expect(mapRouteMatrix([{ ...element(0, 0, 100), status: undefined }], ["A"], "outbound").A.status).toBe("unavailable");
  });
  it("handles one failing market independently", () => {
    const result = mapRouteMatrix([element(0, 0, 1000), { ...element(0, 1, 0), condition: "ROUTE_NOT_FOUND" }], ["A", "B"], "outbound");
    expect(result.A.status).toBe("ready"); expect(result.B.status).toBe("unavailable");
  });
  it("ignores routes for changed origins and destinations", () => {
    expect(currentRoute(route, origin, destination)).toBe(route);
    expect(currentRoute(route, { ...origin, key: "changed" }, destination)).toBeNull();
    expect(currentRoute(route, origin, { ...destination, placeId: "another-yard" })).toBeNull();
    expect(currentRoute(route, null, destination)).toBeNull();
  });
  it("invalidates fetched distances but preserves confirmed money and manual distances", () => {
    const form = { ...createMarketForm(), quote: "800", outbound: "25", returnKm: "27", distanceMethod: "fetched" as const, returnDistanceMethod: "manual" as const };
    const result = invalidateFetchedDistances(form); expect(result.outbound).toBe(""); expect(result.returnKm).toBe("27"); expect(result.quote).toBe("800");
  });
  it("applies separate verified outbound and return distances without assuming equality", () => {
    const form = applyRoadRoute(createMarketForm(), route);
    expect(form.outbound).toBe("25.25"); expect(form.returnKm).toBe("27.5"); expect(form.sameReturn).toBe(false);
    expect(form.returnDistanceMethod).toBe("fetched");
  });
  it("never silently replaces explicit manual distance overrides", () => {
    const form = { ...createMarketForm(), outbound: "50", returnKm: "51", distanceMethod: "manual" as const, returnDistanceMethod: "manual" as const };
    expect(applyRoadRoute(form, route)).toMatchObject({ outbound: "50", returnKm: "51" });
  });
  it("keeps return unavailable after partial failure; equality requires the existing explicit checkbox", () => {
    const form = applyRoadRoute(createMarketForm(), { ...route, returnLeg: { status: "unavailable", reason: "No return route" } });
    expect(form.returnKm).toBe(""); expect(form.sameReturn).toBe(false);
  });
  it.each(["hired-job", "hired-load"] as const)("%s quote is not multiplied by kilometres and included fuel is never added", mode => {
    const form = { ...createMarketForm(), mode, quote: "800", inclusions: { fuel: "included" as const, driver: "included" as const, toll: "included" as const, other: "included" as const }, extras: { fuel: "9999", driver: "", toll: "", other: "" } };
    const before = calculateTransport(formTransport(form), 2), after = calculateTransport(formTransport(applyRoadRoute(form, route)), 2);
    expect(after.total).toBe(mode === "hired-job" ? 800 : 1600); expect(after.total).toBe(before.total); expect(after.fuelCost).toBeNull();
  });
  it("owned fuel uses asymmetric outward/return distances", () => {
    const form = { ...applyRoadRoute(createMarketForm(), route), mode: "owned" as const, loadedMileage: "5", emptyMileage: "10", fuelPrice: "100", driver: "0", toll: "0", other: "0" };
    const result = calculateTransport(formTransport(form), 2);
    expect(result.fuelLitres).toBe(15.6); expect(result.total).toBe(1560);
    expect(calculateTransport(formTransport({ ...form, sameReturn: true }), 2).fuelLitres).toBe(15.15);
  });
  it("road limits use usable road km, with explicit unknowns", () => {
    expect(roadLimitStatus({ ...createMarketForm(), outbound: "25" }, 25)).toBe("inside");
    expect(roadLimitStatus({ ...createMarketForm(), outbound: "25.001" }, 25)).toBe("outside");
    expect(roadLimitStatus(createMarketForm(), 25)).toBe("unknown"); expect(roadLimitStatus({ ...createMarketForm(), outbound: "25" }, NaN)).toBe("unknown");
  });
  it("directions contain encoded origin/destination coordinates and Place IDs", () => {
    const url = new URL(googleDirectionsUrl(origin, destination)!);
    expect(url.searchParams.get("origin")).toBe("20,75"); expect(url.searchParams.get("origin_place_id")).toBe("test_origin"); expect(url.searchParams.get("destination_place_id")).toBe("test_destination"); expect(url.searchParams.get("travelmode")).toBe("driving");
    expect(googleDirectionsUrl(null, destination)).toBeNull(); expect(googleDirectionsUrl(origin, { ...destination, coordinates: { ...coords, verified: false } })).toBeNull();
  });
  it("rejects a town centre as a mandi yard and flags conflicting regions", () => {
    const place: GooglePlace = { placeId: "test", name: "Test APMC", address: "Test", coordinates: coords, countryCode: "IN", state: "Gujarat", district: "Rajkot", types: ["establishment"], attributions: [] };
    expect(isYardCandidate(place)).toBe(true); expect(isYardCandidate({ ...place, name: "Rajkot", types: ["locality", "political"] })).toBe(false);
    expect(placeRegionMismatch(place, "Gujarat", "Ahmedabad")).toHaveLength(1); expect(placeRegionMismatch(place, "gujarat", "Rajkot")).toEqual([]);
  });
  it("returns GPS accuracy only after the explicit location request", async () => {
    const api = { getCurrentPosition: (success: PositionCallback) => success({ coords: { latitude: 20, longitude: 75, accuracy: 18 } } as GeolocationPosition) };
    expect(await requestLocation(api)).toMatchObject({ status: "success", accuracyMetres: 18 });
  });
});
