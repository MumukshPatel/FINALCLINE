"use client";

import { useState } from "react";
import {
  compareMarkets,
  type ExpenseInput, type MarketEstimateInput, type QuantityInput,
  type QuoteInclusion, type TransportCategory, type TransportInput,
} from "../lib/calculator";
import { createSyntheticComparison, SYNTHETIC_LABEL } from "../lib/demo/synthetic-fixtures";

const fixture = createSyntheticComparison();
const categories: TransportCategory[] = ["fuel", "driver", "toll", "other"];
const currency = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
const rupees = (value: number | null) => value === null ? "Unconfirmed" : currency.format(value);
const numeric = (value: string): number | null => value.trim() === "" ? null : Number(value);
const fee = (value: string): ExpenseInput => numeric(value) === null
  ? { status: "unknown" } : { status: "confirmed", total: numeric(value)! };

type MarketForm = {
  mode: "owned" | "hired";
  quote: string;
  quoteBasis: "whole-job" | "per-round-trip-load";
  inclusions: Record<TransportCategory, QuoteInclusion>;
  extras: Record<TransportCategory, string>;
  sellingExpenses: string;
  outboundKm: string;
  returnKm: string;
  equalReturn: boolean;
  loadedMileage: string;
  emptyMileage: string;
  fuelPrice: string;
  driver: string;
  toll: string;
  other: string;
  date: string;
};

function initialMarket(quote: string): MarketForm {
  return {
    mode: "hired", quote, quoteBasis: "whole-job",
    inclusions: { fuel: "included", driver: "included", toll: "included", other: "included" },
    extras: { fuel: "", driver: "", toll: "", other: "" }, sellingExpenses: "400",
    outboundKm: "40", returnKm: "40", equalReturn: true, loadedMileage: "5",
    emptyMileage: "8", fuelPrice: "100", driver: "0", toll: "0", other: "0", date: "2026-10-10",
  };
}

function transport(form: MarketForm): TransportInput {
  return form.mode === "hired" ? {
    mode: "hired", quote: fee(form.quote), quoteBasis: form.quoteBasis, inclusions: form.inclusions,
    additionalCosts: Object.fromEntries(categories.map((category) => [category, fee(form.extras[category])])),
  } : {
    mode: "owned", outboundKm: numeric(form.outboundKm),
    returnDistance: form.equalReturn ? { assumption: "same-as-outbound" } : { assumption: "entered", km: numeric(form.returnKm) },
    loadedKmPerLitre: numeric(form.loadedMileage), emptyKmPerLitre: numeric(form.emptyMileage),
    fuelPricePerLitre: numeric(form.fuelPrice), driver: fee(form.driver), toll: fee(form.toll), other: fee(form.other),
  };
}

function NumberField({ label, value, onChange, hint }: {
  label: string; value: string; onChange: (value: string) => void; hint?: string;
}) {
  return <label className="field"><span>{label}</span>
    <input type="number" step="any" value={value} onChange={(event) => onChange(event.target.value)} />
    {hint && <small>{hint}</small>}
  </label>;
}

export default function CalculatorDemo() {
  const [quantity, setQuantity] = useState("20");
  const [unit, setUnit] = useState<QuantityInput["unit"]>("quintal");
  const [bagWeight, setBagWeight] = useState("");
  const [payload, setPayload] = useState("1000");
  const [payloadConfirmed, setPayloadConfirmed] = useState(true);
  const [freshnessDays, setFreshnessDays] = useState("2");
  const [forms, setForms] = useState([initialMarket("800"), initialMarket("2800")]);
  const update = (index: number, changes: Partial<MarketForm>) =>
    setForms((current) => current.map((form, i) => i === index ? { ...form, ...changes } : form));

  const quantityInput: QuantityInput = unit === "bag"
    ? { unit, value: numeric(quantity) ?? NaN, kgPerBag: numeric(bagWeight) }
    : { unit, value: numeric(quantity) ?? NaN };
  const markets: MarketEstimateInput[] = fixture.markets.map((market, index) => ({
    ...market, observation: { ...market.observation, observationDate: forms[index].date },
    transport: transport(forms[index]), sellingExpenses: fee(forms[index].sellingExpenses),
  }));
  const result = compareMarkets({
    ...fixture, quantity: quantityInput,
    payload: payloadConfirmed ? { status: "confirmed", usablePayloadKg: numeric(payload) ?? NaN } : { status: "unknown" },
    freshness: { ...fixture.freshness, maxAgeDays: numeric(freshnessDays) ?? NaN }, markets,
  });

  return <main>
    <header><a className="brand" href="/">MandiNet<span>CALCULATOR</span></a><span className="phase">Phase 1 · Demo</span></header>
    <section className="intro"><p className="eyebrow">KNOW WHAT YOU TAKE HOME</p>
      <h1>Compare estimated<br />net sale proceeds.</h1>
      <p>See how transport and farmer-borne selling expenses change two sale scenarios for the same crop and variety.</p>
    </section>
    <aside className="demo-notice"><strong>{SYNTHETIC_LABEL}</strong>
      <span>A and B are fictional examples. Every prefilled price, cost and date is synthetic. Demo comparison date: 10 October 2026, Asia/Kolkata.</span>
    </aside>
    <section className="panel quantity-panel" aria-labelledby="quantity-title">
      <div><p className="eyebrow">YOUR LOAD</p><h2 id="quantity-title">Quantity & usable payload</h2></div>
      <div className="fields">
        <NumberField label="Quantity" value={quantity} onChange={setQuantity} />
        <label className="field"><span>Unit</span><select value={unit} onChange={(event) => setUnit(event.target.value as QuantityInput["unit"])}>
          <option value="kg">kg</option><option value="quintal">quintal (100 kg)</option>
          <option value="tonne">tonne (1,000 kg)</option><option value="bag">bags</option>
        </select></label>
        {unit === "bag" && <NumberField label="User-entered kg per bag" value={bagWeight} onChange={setBagWeight} />}
        <NumberField label="Usable payload per load (kg)" value={payload} onChange={setPayload} />
        <NumberField label="Maximum observation age (days)" value={freshnessDays} onChange={setFreshnessDays} hint="Inclusive Kolkata calendar days. Default: 2." />
      </div>
      <div className="load-footer"><label className="check"><input type="checkbox" checked={payloadConfirmed} onChange={(event) => setPayloadConfirmed(event.target.checked)} /> I confirm the usable payload</label>
        <span className="load-count">{result.markets[0].estimate.loads ?? "?"} loads/trips <small>· {result.markets[0].estimate.quantity?.totalKg.toLocaleString("en-IN") ?? "?"} kg total</small></span>
      </div>
    </section>
    <div className="market-grid">{result.markets.map((market, index) => {
      const form = forms[index];
      const estimate = market.estimate;
      const best = result.rankings.reportedModal.bestObservationId === market.observation.id;
      return <section className="panel market" key={market.observation.id}>
        <div className="market-title"><div><p className="eyebrow">SYNTHETIC EXAMPLE</p><h2>{market.observation.marketLabel}</h2></div>
          {best && <span className="best">Highest eligible modal estimate</span>}</div>
        <p className="meta">{market.observation.crop} / {market.observation.variety}</p>
        <div className="price-strip"><span>Reported-modal scenario <strong>{rupees(market.observation.modalPricePerQuintal)} / quintal</strong></span>
          <span>Reported-minimum scenario <strong>{rupees(market.observation.minimumPricePerQuintal)} / quintal</strong></span></div>
        <p className="fine">Modal is not an average. Minimum is a reported price scenario, not a crop grade.</p>
        <label className="field"><span>Synthetic observation date (Asia/Kolkata)</span><input type="date" value={form.date} onChange={(event) => update(index, { date: event.target.value })} /></label>
        <h3>Transport</h3>
        <label className="field"><span>Arrangement</span><select value={form.mode} onChange={(event) => update(index, { mode: event.target.value as MarketForm["mode"] })}>
          <option value="hired">Hired transport</option><option value="owned">Owned transport</option>
        </select></label>
        {form.mode === "hired" ? <>
          <div className="fields"><NumberField label="Confirmed hire quote (₹)" value={form.quote} onChange={(quote) => update(index, { quote })} />
            <label className="field"><span>Quote basis</span><select value={form.quoteBasis} onChange={(event) => update(index, { quoteBasis: event.target.value as MarketForm["quoteBasis"] })}>
              <option value="whole-job">Whole job — used once</option><option value="per-round-trip-load">Per round-trip load</option>
            </select></label></div>
          <p className="fine">Confirm what the quote includes. Enter TOTAL job costs for excluded items.</p>
          <div className="fields">{categories.map((category) => <div key={category}>
            <label className="field"><span className="capitalize">{category} in quote</span><select value={form.inclusions[category]} onChange={(event) => update(index, { inclusions: { ...form.inclusions, [category]: event.target.value as QuoteInclusion } })}>
              <option value="included">Included</option><option value="excluded">Excluded</option><option value="unknown">Unknown</option>
            </select></label>
            {form.inclusions[category] === "excluded" && <NumberField label={`TOTAL additional ${category} (₹)`} value={form.extras[category]} onChange={(value) => update(index, { extras: { ...form.extras, [category]: value } })} />}
          </div>)}</div>
        </> : <>
          <div className="fields"><NumberField label="Outbound distance per trip (km)" value={form.outboundKm} onChange={(outboundKm) => update(index, { outboundKm })} />
            <NumberField label="Loaded mileage (km/litre)" value={form.loadedMileage} onChange={(loadedMileage) => update(index, { loadedMileage })} />
            <NumberField label="Empty-return mileage (km/litre)" value={form.emptyMileage} onChange={(emptyMileage) => update(index, { emptyMileage })} />
            <NumberField label="Fuel price (₹/litre)" value={form.fuelPrice} onChange={(fuelPrice) => update(index, { fuelPrice })} /></div>
          <label className="check"><input type="checkbox" checked={form.equalReturn} onChange={(event) => update(index, { equalReturn: event.target.checked })} /> Assume empty return distance equals outbound distance for every trip</label>
          {!form.equalReturn && <NumberField label="Empty return distance per trip (km)" value={form.returnKm} onChange={(returnKm) => update(index, { returnKm })} />}
          <p className="fine">{estimate.transport.returnDistance.description}</p>
          <div className="fields">{(["driver", "toll", "other"] as const).map((category) => <NumberField key={category} label={`TOTAL ${category} cost (₹)`} value={form[category]} onChange={(value) => update(index, { [category]: value })} />)}</div>
          <p className="fine">Fuel: {estimate.transport.fuelLitres?.toLocaleString("en-IN", { maximumFractionDigits: 3 }) ?? "Unconfirmed"} litres · {rupees(estimate.transport.fuelCost)}</p>
        </>}
        <h3>Selling expenses</h3><NumberField label="Confirmed TOTAL farmer-borne selling expenses (₹)" value={form.sellingExpenses} onChange={(sellingExpenses) => update(index, { sellingExpenses })} hint="Blank = unknown. Enter 0 only when explicitly confirmed zero." />
        <div className="breakdown"><div><span>Total transport</span><strong>{rupees(estimate.transport.total)}</strong></div>
          <div><span>Selling expenses</span><strong>{rupees(estimate.sellingExpenses)}</strong></div></div>
        <div className="net-results"><p className="eyebrow">ESTIMATED NET SALE PROCEEDS</p>
          <div><span>Reported-modal scenario<small>Gross: {rupees(estimate.scenarios.reportedModal.grossSaleProceeds)}</small></span><strong>{rupees(estimate.scenarios.reportedModal.estimatedNetSaleProceeds)}</strong></div>
          <div><span>Reported-minimum scenario<small>Gross: {rupees(estimate.scenarios.reportedMinimum.grossSaleProceeds)}</small></span><strong>{rupees(estimate.scenarios.reportedMinimum.estimatedNetSaleProceeds)}</strong></div>
        </div>
        {market.exclusionReasons.length > 0 && <div className="issues" role="status"><strong>Excluded from ranking</strong><ul>{market.exclusionReasons.map((reason, i) => <li key={`${reason.code}-${i}`}>{reason.message}</li>)}</ul></div>}
      </section>;
    })}</div>
    <footer>Gross sale proceeds − transport − farmer-borne selling expenses. Estimates depend on entered costs and the dated price scenario.</footer>
  </main>;
}
