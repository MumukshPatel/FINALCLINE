import { getMarketRecords } from "../../../lib/market/agmarknet-server";
import { observationResponse } from "../../../lib/agent/snapshots";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const result = await getMarketRecords({
    stateId: query.get("state") ?? "", districtId: query.get("district") ?? "",
    cropId: query.get("crop") ?? "", varietyId: query.get("variety") ?? "",
    marketId: query.get("market") ?? "", pricesAsOn: query.get("date") ?? "",
  });
  return observationResponse(request, result);
}
