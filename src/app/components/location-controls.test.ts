import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RoadRoutingPanel, VillageSearch } from "./location-controls";
import { destinationKey, googleDirectionsUrl, originKey, type ConfirmedOrigin, type MarketDestination } from "../../lib/location/routing";
import { locationText } from "../../lib/location/copy";

// SYNTHETIC unit-test coordinates/IDs only; not actual village/yard verification.
const coordinates = { latitude: 20, longitude: 70, verified: true };
const origin: ConfirmedOrigin = { key: originKey(coordinates, "test_origin"), confirmed: true, source: "google-places", coordinates, placeId: "test_origin", name: "Synthetic test origin" };
const destination: MarketDestination = { marketId: "test-only-market", marketName: "Synthetic test yard", coordinates: { ...coordinates, latitude: 21 }, placeId: "test_yard", name: "Synthetic test yard", verified: true, verification: "farmer-confirmed-google-yard" };
const noop = () => {};
const panel = (start: ConfirmedOrigin | null, destinations: Record<string, MarketDestination> = {}) => renderToStaticMarkup(createElement(RoadRoutingPanel, { markets: [{ id: destination.marketId, label: destination.marketName }], origin: start, destinations, routes: {}, onDestination: noop, onRoutes: noop, language: "en", manualDistances: { [destination.marketId]: { outbound: "25", returnKm: "-1", distanceMethod: "manual" } }, onManualDistance: noop }));

describe("location UI guardrails — synthetic test-only fixtures", () => {
  it("keeps typed-only village unconfirmed with an accessible combobox", () => {
    const html = renderToStaticMarkup(createElement(VillageSearch, { value: "Typed synthetic village", onTextChange: noop, origin: null, onOriginChange: noop, state: "", district: "", language: "en" }));
    expect(html).toContain('role="combobox"');
    expect(html).toContain("Village or location");
    expect(html).not.toContain('class="origin-summary"');
    expect(html).not.toContain("localStorage");
  });
  it("shows manual distance validation and no directions URL for unresolved origins/yards", () => {
    for (const html of [panel(null), panel(origin), panel(null, { [destination.marketId]: destination })]) {
      expect(html).toContain("Manually entered road distance — unverified");
      expect(html).toContain("Enter a non-negative distance");
      expect(html).toContain('aria-invalid="true"');
      expect(html).not.toContain('href="https://www.google.com/maps/dir/');
      expect(html).toContain('disabled="">Get directions');
    }
  });
  it("renders encoded directions only for a confirmed origin and verified yard", () => {
    const html = panel(origin, { [destination.marketId]: destination });
    expect(html).toContain('href="https://www.google.com/maps/dir/?');
    expect(html).toContain("origin_place_id=test_origin");
    expect(html).toContain("destination_place_id=test_yard");
    expect(html).toContain('target="_blank"');
    expect(destinationKey(destination)).toContain(destination.marketId);
    expect(googleDirectionsUrl(origin, { ...destination, marketId: "synthetic-a" })).toBeNull();
    expect(googleDirectionsUrl(origin, { ...destination, marketId: "demo-a" })).toBeNull();
  });
  it("translates new essential location warnings into Hindi and Gujarati", () => {
    for (const language of ["hi", "gu"]) for (const key of ["search", "missing", "unresolved", "shortlist", "unknownRadius", "confirmGPS", "savedError", "gpsError", "terms", "privacy"] as const) {
      expect(locationText(language, key)).not.toBe(locationText("en", key));
    }
    expect(locationText("ta", "fallback")).toContain("English fallback");
  });
});
