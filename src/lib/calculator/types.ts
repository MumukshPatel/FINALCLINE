/** All amounts are INR. Transport costs are TOTAL job costs; itemized selling rows declare their charging basis. */
export type QuantityInput =
  | { unit: "kg" | "quintal" | "tonne"; value: number }
  | { unit: "bag"; value: number; kgPerBag: number | null };

export type ConfirmedPayload =
  | { status: "confirmed"; usablePayloadKg: number }
  | { status: "unknown" };

/** Confirmed zero is explicit; unknown never defaults to zero. */
export type ExpenseInput =
  | { status: "confirmed"; total: number }
  | { status: "unknown" };

export type SellingCategory = "loading" | "unloading" | "weighing" | "packaging" | "commission" | "otherSelling";
export type ChargingBasis = "fixed-total" | "per-quintal" | "per-kg" | "per-load";
export type SellingExpenseRow = { category: SellingCategory } & (
  | { status: "amount"; amount: number; basis: ChargingBasis }
  | { status: "zero" }
  | { status: "included"; includedIn: "transport" | SellingCategory }
  | { status: "unknown" }
);
export type SellingExpenseInput = ExpenseInput | { status: "itemized"; items: SellingExpenseRow[] };
export type SellingExpenseLine = { category: SellingCategory; total: number | null; status: SellingExpenseRow["status"]; includedIn?: "transport" | SellingCategory };

export type ReturnDistanceInput =
  | { assumption: "same-as-outbound" }
  | { assumption: "entered"; km: number | null }
  | { assumption: "unknown" };

export type TransportCategory = "fuel" | "driver" | "toll" | "other";
export type QuoteInclusion = "included" | "excluded" | "unknown";
export type QuoteInclusions = Record<TransportCategory, QuoteInclusion>;

export type OwnedTransport = {
  mode: "owned";
  outboundKm: number | null;
  returnDistance: ReturnDistanceInput;
  loadedKmPerLitre: number | null;
  emptyKmPerLitre: number | null;
  fuelPricePerLitre: number | null;
  driver: ExpenseInput;
  toll: ExpenseInput;
  other: ExpenseInput;
};

export type HiredTransport = {
  mode: "hired";
  quoteBasis: "whole-job" | "per-round-trip-load";
  quote: ExpenseInput;
  inclusions: QuoteInclusions;
  /** Only explicitly excluded categories are added. Included ones are ignored. */
  additionalCosts: Partial<Record<TransportCategory, ExpenseInput>>;
};

export type TransportInput = OwnedTransport | HiredTransport | { mode: "unknown" };

export type AssumptionIssue = {
  kind: "missing" | "invalid";
  field: string;
  message: string;
};

export type CalculationResult<T> = {
  value: T | null;
  missingAssumptions: AssumptionIssue[];
};

export type NormalizedQuantity = { totalKg: number; quantityInQuintals: number };
export type CalculationStatus = "complete" | "incomplete" | "invalid";

export type TransportBreakdown = {
  mode: TransportInput["mode"];
  loads: number | null;
  outboundKm: number | null;
  returnDistance: {
    assumption: ReturnDistanceInput["assumption"];
    km: number | null;
    description: string;
  };
  fuelLitres: number | null;
  fuelCost: number | null;
  quoteBasis: HiredTransport["quoteBasis"] | null;
  quoteCost: number | null;
  inclusions: QuoteInclusions | null;
  additionalCosts: Record<TransportCategory, number | null>;
  total: number | null;
  missingAssumptions: AssumptionIssue[];
};

export type ScenarioKind = "reported-modal" | "reported-minimum";
export type SaleScenario = {
  kind: ScenarioKind;
  pricePerQuintal: number | null;
  grossSaleProceeds: number | null;
  transportCost: number | null;
  sellingExpenses: number | null;
  totalDeductions: number | null;
  estimatedNetSaleProceeds: number | null;
  status: CalculationStatus;
};

export type SaleEstimateInput = {
  quantity: QuantityInput;
  payload: ConfirmedPayload;
  transport: TransportInput;
  sellingExpenses: SellingExpenseInput;
  modalPricePerQuintal: number | null;
  minimumPricePerQuintal: number | null;
};

export type SaleEstimate = {
  quantity: NormalizedQuantity | null;
  loads: number | null;
  transport: TransportBreakdown;
  sellingExpenses: number | null;
  sellingExpenseBreakdown: SellingExpenseLine[];
  scenarios: { reportedModal: SaleScenario; reportedMinimum: SaleScenario };
  status: CalculationStatus;
  missingAssumptions: AssumptionIssue[];
};

/** Date-only records use YYYY-MM-DD interpreted as an Asia/Kolkata calendar date. */
export type MarketObservation = {
  id: string;
  marketId: string;
  marketLabel: string;
  crop: string;
  variety: string;
  observationDate: string;
  priceUnit: "INR/quintal" | "unknown";
  grade?: string;
  modalPricePerQuintal: number | null;
  minimumPricePerQuintal: number | null;
  dataKind: "reported" | "synthetic";
  sourceLabel: string;
  sourceUrl: string | null;
};

export type FreshnessPolicy = {
  /** Explicit clock makes functions pure, reproducible and independent of host timezone. */
  asOfEpochMs: number;
  /** Inclusive age in Kolkata calendar days: 2 admits today, yesterday and day before. */
  maxAgeDays: number;
};

export type ExclusionCode =
  | "crop_mismatch" | "variety_mismatch" | "invalid_record"
  | "invalid_date" | "future_observation" | "stale_observation"
  | "invalid_prices" | "invalid_freshness_policy" | "dataset_mismatch"
  | "incomplete_estimate";
// Additional exclusions do not conflate missing routing capabilities with invalid prices.
export type AdditionalExclusionCode = "unknown_price_unit" | "grade_mismatch" | "outside_road_limit" | "missing_selected_price";
export type ExclusionReason = { code: ExclusionCode | AdditionalExclusionCode; message: string };
export type ObservationEligibility = {
  eligible: boolean;
  ageDays: number | null;
  exclusionReasons: ExclusionReason[];
};

export type MarketEstimateInput = {
  observation: MarketObservation;
  transport: TransportInput;
  sellingExpenses: SellingExpenseInput;
};

export type ComparisonInput = {
  scenario?: "reportedModal" | "reportedMinimum";
  quantity: QuantityInput;
  payload: ConfirmedPayload;
  crop: string;
  variety: string;
  grade?: string;
  freshness: FreshnessPolicy;
  /** Defaults to reported; synthetic records require explicit opt-in. */
  dataset?: MarketObservation["dataKind"];
  markets: MarketEstimateInput[];
};

export type RankedEstimate = {
  rank: number;
  observationId: string;
  marketId: string;
  estimatedNetSaleProceeds: number;
};
export type ScenarioRanking = {
  entries: RankedEstimate[];
  /** No best badge when ANY otherwise-eligible comparison is incomplete, or on a tie. */
  bestObservationId: string | null;
};
export type MarketComparison = {
  markets: {
    observation: MarketObservation;
    eligibility: ObservationEligibility;
    estimate: SaleEstimate;
    exclusionReasons: ExclusionReason[];
  }[];
  rankings: { reportedModal: ScenarioRanking; reportedMinimum: ScenarioRanking };
};
