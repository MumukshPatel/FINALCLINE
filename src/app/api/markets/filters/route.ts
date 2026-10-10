import { getVerifiedFilters } from "../../../../lib/market/agmarknet-server";
export const runtime = "nodejs";
export async function GET() {
  try { return Response.json(await getVerifiedFilters(), { headers: { "Cache-Control": "no-store" } }); }
  catch { return Response.json({ error: "Official filter request failed. Try again or import an official export." }, { status: 502 }); }
}
