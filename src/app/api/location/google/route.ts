import { autocomplete, computeRoadRoutes, findMarketCandidates, getPlaceDetails, googleConfigured, googleKey, GoogleFailure, regionBias } from "../../../../lib/location/google-server";
import type { ConfirmedOrigin, MarketDestination } from "../../../../lib/location/routing";
import { getVerifiedFilters } from "../../../../lib/market/agmarknet-server";
export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };
export async function GET() { return Response.json({ configured: googleConfigured(), ...(googleConfigured() ? {} : { error: "GOOGLE_MAPS_API_KEY is missing. Village search and automatic road routing are not configured." }) }, { headers }); }
export async function POST(request: Request) {
  const url = new URL(request.url);
  const applicationOrigin = `${url.protocol}//${request.headers.get("host") ?? url.host}`;
  if (request.headers.get("origin") !== applicationOrigin) return Response.json({ error: "Use this application's same-origin location controls." }, { status: 403, headers });
  try {
    googleKey();
    if (Number(request.headers.get("content-length")) > 32000) throw new GoogleFailure("INVALID_INPUT", "Request too large.", 413);
    const text = await request.text(); if (text.length > 32000) throw new GoogleFailure("INVALID_INPUT", "Request too large.", 413);
    const body = JSON.parse(text);
    switch (body.action) {
      case "autocomplete": return Response.json({ suggestions: await autocomplete(body.input, body.sessionToken, body.bias) }, { headers });
      case "details": return Response.json({ place: await getPlaceDetails(body.placeId, body.sessionToken) }, { headers });
      case "region-bias": return Response.json({ bias: await regionBias(body.state, body.district) }, { headers });
      case "destinations": return Response.json(await findMarketCandidates(body.marketId), { headers });
      case "routes": {
        if (!Array.isArray(body.destinations) || body.destinations.length > 3) throw new GoogleFailure("INVALID_INPUT", "At most three verified destinations are allowed.", 400);
        const filters = await getVerifiedFilters();
        if (body.destinations.some((destination: MarketDestination) => !filters.markets.some(market => market.value === destination.marketId))) throw new GoogleFailure("UNKNOWN_MARKET", "A destination must belong to a canonical real mandi ID.", 400);
        return Response.json({ routes: await computeRoadRoutes(body.origin as ConfirmedOrigin, body.destinations as MarketDestination[]) }, { headers });
      }
      default: throw new GoogleFailure("INVALID_INPUT", "Unknown application location action.", 400);
    }
  } catch (error) { return Response.json({ error: error instanceof GoogleFailure ? error.message : "Invalid location request.", code: error instanceof GoogleFailure ? error.code : "INVALID_INPUT" }, { status: error instanceof GoogleFailure ? error.status : 400, headers }); }
}
