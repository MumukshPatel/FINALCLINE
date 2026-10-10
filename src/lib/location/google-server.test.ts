import { afterEach, expect, it, vi } from "vitest";
import { autocomplete, computeRoadRoutes, googleKey, normalizeGooglePlace, MATRIX_FIELDS, MATRIX_URL } from "./google-server";
import { destinationKey, originKey, type ConfirmedOrigin, type MarketDestination } from "./routing";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it("missing configuration fails clearly and never calls Google", async () => {
  vi.stubEnv("GOOGLE_MAPS_API_KEY", ""); const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  expect(() => googleKey()).toThrow("GOOGLE_MAPS_API_KEY"); await expect(autocomplete("Test", "test-token")).rejects.toThrow("GOOGLE_MAPS_API_KEY"); expect(fetcher).not.toHaveBeenCalled();
});
it("autocomplete uses India restriction, session token and a bounded field mask", async () => {
  vi.stubEnv("GOOGLE_MAPS_API_KEY", "synthetic-unit-test-key-not-real");
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ suggestions: [{ placePrediction: { placeId: "test_place", text: { text: "Synthetic village, Test district, India" } } }] })));
  vi.stubGlobal("fetch", fetcher); const result = await autocomplete("Synthetic village", "test-session");
  expect(result[0].placeId).toBe("test_place"); const [url, init] = fetcher.mock.calls[0]; expect(url).toContain("places:autocomplete"); expect(JSON.parse(init.body)).toMatchObject({ includedRegionCodes: ["in"], sessionToken: "test-session" }); expect(init.headers["X-Goog-FieldMask"]).not.toBe("*"); expect(init.cache).toBe("no-store");
});
it("request matrices use documented fields and separate reverse direction; failed reverse is not zero", async () => {
  vi.stubEnv("GOOGLE_MAPS_API_KEY", "synthetic-unit-test-key-not-real");
  const coords = { latitude: 20, longitude: 75, verified: true };
  const origin: ConfirmedOrigin = { key: originKey(coords), confirmed: true, source: "browser-gps", coordinates: coords, name: "SYNTHETIC TEST" };
  const destination: MarketDestination = { marketId: "test-real-id", marketName: "SYNTHETIC TEST", coordinates: { ...coords, longitude: 76 }, name: "SYNTHETIC TEST", verified: true, verification: "existing-verified" };
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify([{ originIndex: 0, destinationIndex: 0, status: {}, condition: "ROUTE_EXISTS", distanceMeters: 12345, duration: "600s" }]))).mockResolvedValueOnce(new Response("{}", { status: 503 }));
  const result = await computeRoadRoutes(origin, [destination], fetcher);
  expect(fetcher).toHaveBeenCalledTimes(2); expect(fetcher.mock.calls.every(([url]) => url === MATRIX_URL)).toBe(true);
  expect((fetcher.mock.calls[0][1]?.headers as Record<string, string>)["X-Goog-FieldMask"]).toBe(MATRIX_FIELDS);
  const out = JSON.parse(fetcher.mock.calls[0][1]?.body as string), back = JSON.parse(fetcher.mock.calls[1][1]?.body as string);
  expect(out.origins[0].waypoint.location.latLng.longitude).toBe(75); expect(back.origins[0].waypoint.location.latLng.longitude).toBe(76);
  expect(result[0].outbound).toMatchObject({ status: "ready", km: 12.345 }); expect(result[0].returnLeg.status).toBe("unavailable"); expect(result[0].destinationKey).toBe(destinationKey(destination));
});
it("validates Place Details and keeps attribution/address components", () => {
  const place = normalizeGooglePlace({ id: "synthetic_test", displayName: { text: "Synthetic place" }, formattedAddress: "Synthetic address", location: { latitude: 20, longitude: 75 }, addressComponents: [{ longText: "Gujarat", shortText: "GJ", types: ["administrative_area_level_1"] }, { longText: "India", shortText: "IN", types: ["country"] }], attributions: [{ provider: "Test provider", providerUri: "https://example.com" }], types: ["establishment"] });
  expect(place.state).toBe("Gujarat"); expect(place.countryCode).toBe("IN"); expect(place.attributions).toHaveLength(1);
  expect(() => normalizeGooglePlace({ id: "test", location: { latitude: 999, longitude: 0 }, displayName: { text: "Invalid" } })).toThrow();
});
