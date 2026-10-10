import type { MarketObservation, TransportInput, SellingExpenseInput } from "../calculator";
import type { Coordinates, RoadDistance } from "../location";

export type MarketRecord = {
  observation: MarketObservation;
  cropId: string;
  varietyId: string;
  location: { stateId: string; stateLabel: string; districtId: string; districtLabel: string; label: string; verified: boolean } | null;
  coordinates: Coordinates | null;
  roadDistance: RoadDistance | null;
  retrievedAt: string | null;
  provenance?: { sourceRecordId: string | null; sourceEndpoint: string; acquisitionMode: "live" | "manual-import"; originalPriceUnit: string | null; unitEvidence: string | null; maximumPrice: number | null; rawMinimum: number | null; rawModal: number | null };
  demoDefaults?: { transport: TransportInput; sellingExpenses: SellingExpenseInput };
};
export type ProviderResult = { status: "ready" | "unavailable" | "error"; records: MarketRecord[]; providerId: string; retrievedAt: string | null; error?: string; cached?: boolean; exactDateOnly?: boolean; observationSnapshotId?: string };
export type MarketFilters = { stateId: string; districtId: string; cropId: string; varietyId: string; marketId?: string; pricesAsOn?: string; observationFrom?: string; observationTo?: string };
export type FilterChoice = { value: string; label: string; stateId?: string; districtId?: string; cropIds?: string[] };
export type VerifiedFilters = { states: FilterChoice[]; districts: FilterChoice[]; markets: FilterChoice[]; crops: FilterChoice[]; varieties: FilterChoice[]; retrievedAt: string; sourceEndpoint: string; cached?: boolean; error?: string };
export const marketAssumptionKey = (record: MarketRecord) => record.observation.dataKind === "synthetic" ? record.observation.id : `reported:${record.observation.marketId}`;

export interface MarketProvider {
  readonly id: string;
  getRecords(filters: MarketFilters): Promise<ProviderResult>;
}

/** Explicit honest integration seam for a future official Agmarknet fetch/manual import. */
export const unconnectedProvider: MarketProvider = {
  id: "agmarknet-unconnected",
  async getRecords() { return { status: "unavailable", records: [], providerId: this.id, retrievedAt: null }; },
};

export function matchingRecords(records: MarketRecord[], filters: MarketFilters): MarketRecord[] {
  return records.filter((record) => (!filters.stateId || record.location?.stateId === filters.stateId) &&
    (!filters.districtId || record.location?.districtId === filters.districtId) &&
    (!filters.cropId || record.cropId === filters.cropId) && (!filters.varietyId || record.varietyId === filters.varietyId) &&
    (!filters.marketId || record.observation.marketId === filters.marketId) &&
    (!filters.pricesAsOn || record.observation.observationDate <= filters.pricesAsOn) &&
    (!filters.observationFrom || record.observation.observationDate >= filters.observationFrom) &&
    (!filters.observationTo || record.observation.observationDate <= filters.observationTo));
}

/** Latest on/before a selected date, without collapsing distinct varieties or grades. */
export function latestRecords(records: MarketRecord[], filters: MarketFilters): MarketRecord[] {
  const selected = new Map<string, MarketRecord>();
  for (const record of matchingRecords(records, filters)) {
    const key = JSON.stringify([record.observation.marketId, record.cropId, record.varietyId, record.observation.grade ?? ""]);
    const previous = selected.get(key);
    if (!previous || record.observation.observationDate > previous.observation.observationDate) selected.set(key, record);
  }
  return [...selected.values()];
}
