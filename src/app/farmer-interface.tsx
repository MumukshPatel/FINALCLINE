"use client";

import { useEffect, useRef, useState } from "react";
import { DateField, DeferredValidationContext, Field, FieldLabelsContext, NumberField, SelectField, TextField } from "./components/form-fields";
import { LanguageSelector } from "./components/language-selector";
import { comparisonDifference, SELLING_CATEGORIES, type ChargingBasis, type QuoteInclusion, type SellingCategory } from "../lib/calculator";
import { syntheticFarmerRecords } from "../lib/demo/farmer-fixtures";
import { validCoordinates } from "../lib/location";
import { applyRoadRoute, currentRoute, googleDirectionsUrl, invalidateFetchedDistances, roadLimitStatus, type ConfirmedOrigin, type MarketDestination, type MarketRoute } from "../lib/location/routing";
import { locationText } from "../lib/location/copy";
import { VillageSearch, RoadRoutingPanel, GoogleAttributions, type RoutingMarket } from "./components/location-controls";
import { ComparisonAssistant, type AssistantHandle } from "./components/comparison-assistant";
import { comparisonProjection, type ExplanationInput } from "../lib/agent/comparison";
import { latestRecords, marketAssumptionKey, type MarketRecord, type ProviderResult, type VerifiedFilters } from "../lib/market";
import { calendarDate, kolkataToday } from "../lib/market/normalization";
import { providerText } from "../lib/market/provider-copy";
import { farmerComparison, formQuantityAndLoads } from "../lib/market/comparison";
import { changeParentSelection, createMarketForm, demoFarmerForm, emptyFarmerForm, numeric, type ExpenseForm, type FarmerForm, type MarketForm } from "../lib/market/form";
import { assumptionText, exclusionText, formatDate, formatMoney, isPartial, LANGUAGE_STORAGE_KEY, localeMetadata, locales, translate, type TranslationKey } from "../lib/i18n";

export default function FarmerInterface() {
  const [language, setLanguage] = useState("en"), [languageReady, setLanguageReady] = useState(false);
  const [submitted, setSubmitted] = useState(false), [regionOpen, setRegionOpen] = useState(false);
  const [mode, setMode] = useState<"reported" | "synthetic">("reported");
  const [form, setForm] = useState<FarmerForm>(emptyFarmerForm);
  const [records, setRecords] = useState<MarketRecord[]>([]), [providerStatus, setProviderStatus] = useState<"loading" | ProviderResult["status"]>("loading");
  const [assumptions, setAssumptions] = useState<Record<string, MarketForm>>({});
  const [scenario, setScenario] = useState<"reportedModal" | "reportedMinimum">("reportedModal");
  const [dateFrom, setDateFrom] = useState(""), [dateTo, setDateTo] = useState("");
  const [verified, setVerified] = useState<VerifiedFilters | null>(null), [providerInfo, setProviderInfo] = useState<ProviderResult | null>(null), [filterError, setFilterError] = useState("");
  const [marketId, setMarketId] = useState(""), [pricesAsOn, setPricesAsOn] = useState(""), [filterDirty, setFilterDirty] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null), [importSource, setImportSource] = useState(""), [importTime, setImportTime] = useState(""), [importUnit, setImportUnit] = useState(""), [importEvidence, setImportEvidence] = useState("");
  const invalidDateRange = !!(dateFrom && dateTo && dateFrom > dateTo);
  const [actualNow, setActualNow] = useState(0), [origin, setOrigin] = useState<ConfirmedOrigin | null>(null);
  const [destinations, setDestinations] = useState<Record<string, MarketDestination>>({}), [routes, setRoutes] = useState<Record<string, MarketRoute>>({});
  const originRef = useRef<ConfirmedOrigin | null>(null), destinationsRef = useRef<Record<string, MarketDestination>>({});
  const providerRequest = useRef(0);
  const assistantRef = useRef<AssistantHandle>(null), [assistantBusy, setAssistantBusy] = useState(false);
  const t = (key: TranslationKey, values: Record<string, string | number> = {}) => translate(language, key, values);
  const p = (key: Parameters<typeof providerText>[1]) => providerText(language, key);
  const l = (key: Parameters<typeof locationText>[1]) => locationText(language, key);
  const meta = localeMetadata(language);
  const marketName = (record: MarketRecord) => record.observation.dataKind === "synthetic" ? t("demoMarket", { letter: record.observation.marketId.slice(-1).toUpperCase() }) : record.observation.marketLabel;
  const money = (value: number | null) => formatMoney(language, value);

  useEffect(() => {
    try { const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY); if (saved && locales.some((locale) => locale.id === saved)) setLanguage(saved); } catch { /* Storage may be unavailable; the current selection still works. */ }
    setLanguageReady(true);
    setActualNow(Date.now()); setPricesAsOn(kolkataToday()); const timer = setInterval(() => setActualNow(Date.now()), 60000); return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    document.documentElement.lang = meta.tag; document.documentElement.dir = meta.dir; document.documentElement.dataset.script = meta.script;
    if (languageReady) try { localStorage.setItem(LANGUAGE_STORAGE_KEY, language); } catch { /* Preference storage is optional. */ }
  }, [language, languageReady, meta.tag, meta.dir, meta.script]);
  useEffect(() => {
    if (mode !== "reported") return;
    const requestId = ++providerRequest.current;
    const controller = new AbortController(); setProviderStatus("loading"); setRecords([]);
    Promise.all([fetch("/api/markets/filters", { signal: controller.signal, cache: "no-store" }), fetch("/api/markets", { signal: controller.signal, cache: "no-store" })])
      .then(async ([filtersResponse, response]) => { const filtersData = await filtersResponse.json(); if (!response.ok) throw new Error("Provider request failed"); return { filtersData, filtersOk: filtersResponse.ok, result: await response.json() as ProviderResult }; })
      .then(({ filtersData, filtersOk, result }) => { if (controller.signal.aborted) return; if (filtersOk) { setVerified(filtersData); setFilterError(filtersData.error ?? ""); } else setFilterError(filtersData.error); if (requestId === providerRequest.current) receiveResult(result); })
      .catch(() => { if (!controller.signal.aborted && requestId === providerRequest.current) { setProviderStatus("error"); setFilterError("Official provider request failed."); } });
    return () => controller.abort();
  }, [mode]);

  function receiveResult(result: ProviderResult) {
    setRecords(result.records); setProviderStatus(result.status); setProviderInfo(result); setFilterDirty(false);
    setAssumptions(current => ({ ...current, ...Object.fromEntries(result.records.map(record => [marketAssumptionKey(record), current[marketAssumptionKey(record)] ?? createMarketForm(record)])) }));
    for (const record of result.records) if (record.observation.dataKind === "reported" && validCoordinates(record.coordinates) && !destinationsRef.current[record.observation.marketId]) changeDestination(record.observation.marketId, { marketId: record.observation.marketId, marketName: record.observation.marketLabel, coordinates: record.coordinates, name: record.observation.marketLabel, verified: true, verification: "existing-verified" });
  }
  function changeOrigin(value: ConfirmedOrigin | null) {
    if (value?.source === "google-places" && verified) {
      const states = verified.states.filter(x => x.label.trim().toLowerCase() === value.state?.trim().toLowerCase());
      const districts = states.length === 1 ? verified.districts.filter(x => x.stateId === states[0].value && x.label.trim().toLowerCase() === value.district?.trim().toLowerCase()) : [];
      if (states.length === 1 && districts.length === 1) { setForm(current => ({ ...current, stateId: states[0].value, districtId: districts[0].value })); setMarketId(""); setFilterDirty(true); }
    }
    originRef.current = value; setOrigin(value); setRoutes({}); setAssumptions(current => Object.fromEntries(Object.entries(current).map(([key, entry]) => [key, invalidateFetchedDistances(entry)]))); }
  function changeDestination(id: string, value: MarketDestination | null) { const next = { ...destinationsRef.current }; if (value) next[id] = value; else delete next[id]; destinationsRef.current = next; setDestinations(next); setRoutes(current => { const next = { ...current }; delete next[id]; return next; }); setAssumptions(current => current[`reported:${id}`] ? { ...current, [`reported:${id}`]: invalidateFetchedDistances(current[`reported:${id}`]) } : current); }
  function receiveRoutes(values: MarketRoute[]) { const accepted = values.filter(value => currentRoute(value, originRef.current, destinationsRef.current[value.marketId])); if (!accepted.length) return; setRoutes(current => ({ ...current, ...Object.fromEntries(accepted.map(value => [value.marketId, value])) })); setAssumptions(current => { const next = { ...current }; for (const route of accepted) { const key = `reported:${route.marketId}`; next[key] = applyRoadRoute(next[key] ?? createMarketForm(), route); } return next; }); }
  function manualDistance(id: string, direction: "outbound" | "returnKm", value: string) { setAssumptions(current => { const key = `reported:${id}`, entry = current[key] ?? createMarketForm(); return { ...current, [key]: { ...entry, [direction]: value, ...(direction === "outbound" ? { distanceMethod: value ? "manual" as const : null } : { returnDistanceMethod: value ? "manual" as const : null }) } }; }); }

  async function refresh() {
    setSubmitted(true);
    if (!form.stateId || !form.districtId) { setRegionOpen(true); return; }
    const requestId = ++providerRequest.current;
    setProviderStatus("loading"); setRecords([]);
    try {
      const query = new URLSearchParams({ state: form.stateId, district: form.districtId, crop: form.cropId, variety: form.varietyId, market: marketId, date: pricesAsOn });
      const response = await fetch(`/api/markets?${query}`, { cache: "no-store" }); if (!response.ok) throw new Error("Provider request failed");
      const result: ProviderResult = await response.json(); if (requestId !== providerRequest.current) return; receiveResult(result);
    } catch { if (requestId === providerRequest.current) setProviderStatus("error"); }
  }
  async function importExport() {
    if (!importFile) return;
    const requestId = ++providerRequest.current; setProviderStatus("loading");
    const upload = new FormData(); upload.set("file", importFile); upload.set("sourceUrl", importSource); upload.set("retrievedAt", importTime); upload.set("priceUnit", importUnit); upload.set("unitEvidence", importEvidence);
    try {
      const response = await fetch("/api/markets/import", { method: "POST", body: upload }); const result = await response.json();
      if (requestId !== providerRequest.current) return;
      if (!response.ok) { setProviderStatus("error"); setFilterError(result.error); return; }
      setFilterError(""); const first = result.records[0] as MarketRecord | undefined;
      if (first) { updateForm({ stateId: first.location!.stateId, districtId: first.location!.districtId, cropId: first.cropId, varietyId: first.varietyId, grade: first.observation.grade ?? "" }); setMarketId(""); }
      receiveResult(result);
    } catch { if (requestId === providerRequest.current) { setProviderStatus("error"); setFilterError("Import request failed."); } }
  }
  function tryDemo() {
    ++providerRequest.current;
    setDateFrom(""); setDateTo("");
    const demo = syntheticFarmerRecords(); setMode("synthetic"); setProviderStatus("ready"); setRecords(demo);
    setForm((current) => ({ ...demoFarmerForm(), stateId: current.stateId, districtId: current.districtId, village: current.village }));
    setAssumptions(current => ({ ...current, ...Object.fromEntries(demo.map((record) => [record.observation.id, createMarketForm(record)])) }));
  }
  const updateForm = (changes: Partial<FarmerForm>) => setForm((current) => ({ ...current, ...changes }));
  const costKey = (id: string) => marketAssumptionKey(records.find(record => record.observation.id === id)!);
  const updateMarket = (id: string, changes: Partial<MarketForm>) => setAssumptions((current) => { const key = costKey(id); return { ...current, [key]: { ...current[key], ...changes } }; });
  const updateExpense = (id: string, category: SellingCategory, changes: Partial<ExpenseForm>) => setAssumptions((current) => { const key = costKey(id); return { ...current, [key]: { ...current[key], expenses: { ...current[key].expenses, [category]: { ...current[key].expenses[category], ...changes } } } }; });
  const filters = { stateId: mode === "synthetic" ? "" : form.stateId, districtId: mode === "synthetic" ? "" : form.districtId, cropId: form.cropId, varietyId: form.varietyId, marketId: mode === "synthetic" ? "" : marketId, pricesAsOn: mode === "synthetic" ? "" : pricesAsOn, observationFrom: invalidDateRange ? "" : dateFrom, observationTo: invalidDateRange ? "" : dateTo };
  const matching = latestRecords(records, filters).filter((record) => !!assumptions[marketAssumptionKey(record)]);
  const roadLimit = numeric(form.distanceLimit === "custom" ? form.customDistance : form.distanceLimit);
  const radiusStatus = (record: MarketRecord) => { const entry = assumptions[marketAssumptionKey(record)], route = currentRoute(routes[record.observation.marketId], origin, destinations[record.observation.marketId]); return roadLimitStatus(route?.outbound.status === "ready" ? { ...entry, outbound: String(route.outbound.km) } : entry, roadLimit); };
  const outsideRecords = mode === "reported" ? matching.filter(record => radiusStatus(record) === "outside") : [];
  const unknownRadius = mode === "reported" && matching.some(record => radiusStatus(record) === "unknown");
  const availableRecords = mode === "reported" ? matching.filter(record => radiusStatus(record) !== "outside") : matching;
  const routingMarkets: RoutingMarket[] = mode === "reported" ? matching.length ? [...new Map(matching.map(record => [record.observation.marketId, { id: record.observation.marketId, label: record.observation.marketLabel, coordinates: record.coordinates, state: record.location?.stateLabel, district: record.location?.districtLabel }])).values()].slice(0, 3) : (verified?.markets.filter(x => x.stateId === form.stateId && x.districtId === form.districtId && (!marketId || x.value === marketId)) ?? []).slice(0, 3).map(x => ({ id: x.value, label: x.label })) : [];
  const historical = mode === "reported" && !!pricesAsOn && actualNow > 0 && pricesAsOn < kolkataToday(actualNow);
  const invalidComparisonDate = mode === "reported" && (!calendarDate(pricesAsOn) || pricesAsOn > kolkataToday(actualNow || Date.now()));
  const comparison = farmerComparison(form, assumptions, availableRecords, scenario, mode, historical ? Date.parse(`${pricesAsOn}T12:00:00+05:30`) : actualNow);
  const ranking = comparison.rankings[scenario];
  const active = comparison.markets.filter((market) => market.eligibility.eligible);
  const excluded = comparison.markets.filter((market) => !market.eligibility.eligible);
  const ranked = [...active].sort((a, b) => {
    const aRank = ranking.entries.find((entry) => entry.observationId === a.observation.id)?.rank ?? Number.MAX_SAFE_INTEGER;
    const bRank = ranking.entries.find((entry) => entry.observationId === b.observation.id)?.rank ?? Number.MAX_SAFE_INTEGER;
    return aRank - bRank;
  });
  const lookup = (id: string) => availableRecords.find((record) => record.observation.id === id)!;
  const commonEstimate = comparison.markets[0]?.estimate;
  const commonQuantity = formQuantityAndLoads(form);
  const options = (key: "cropId" | "varietyId") => [...new Map(records.filter((record) => key !== "varietyId" || !form.cropId || record.cropId === form.cropId).map((record) => [record[key], {
    value: record[key], label: record.observation.dataKind === "synthetic" ? t(key === "cropId" ? "demoCrop" : "demoVariety") : record.observation[key === "cropId" ? "crop" : "variety"],
  }])).values()];
  const selectionField = (key: "stateId" | "districtId" | "cropId" | "varietyId", label: TranslationKey) => {
    const derivedChoices = key === "cropId" || key === "varietyId" ? options(key) : [...new Map(records.filter((record) => record.location?.verified && (key !== "districtId" || !form.stateId || record.location.stateId === form.stateId)).map((record) => {
      const location = record.location!; const id = key === "stateId" ? location.stateId : location.districtId;
      return [id, { value: id, label: key === "stateId" ? location.stateLabel : location.districtLabel }];
    })).values()];
    const officialChoices = mode === "reported" && verified ? key === "stateId" ? verified.states : key === "districtId" ? verified.districts.filter(x => x.stateId === form.stateId) : key === "cropId" ? verified.crops : verified.varieties.filter(x => x.cropIds?.includes(form.cropId)) : [];
    const choices = [...new Map([...officialChoices, ...derivedChoices].map(x => [x.value, x])).values()];
    const change = (value: string) => { ++providerRequest.current; setFilterDirty(true); if (providerStatus === "loading") setProviderStatus("unavailable"); if (key === "stateId" || key === "districtId") { setMarketId(""); changeOrigin(null); } key === "varietyId" ? updateForm({ varietyId: value, grade: "" }) : setForm((current) => changeParentSelection(current, key, value)); };
    const required = mode === "reported" || key === "cropId" || key === "varietyId";
    return choices.length || (mode === "reported" && verified) ? <SelectField label={t(label)} required={required} error={required && !form[key] ? t("missingInput", { field: t(label) }) : undefined} value={form[key]} onChange={change} options={[{ value: "", label: t("selectOption") }, ...choices]} />
      : <TextField label={t(label)} required={required} value={form[key]} onChange={change} hint={t("manualOptions")} />;
  };
  const globalError = (field: string) => (commonEstimate?.missingAssumptions ?? commonQuantity.missingAssumptions).find((item) => item.field === field);
  const invalid = (value: string, positive: boolean) => value !== "" && (numeric(value) === null || !Number.isFinite(numeric(value)) || (positive ? numeric(value)! <= 0 : numeric(value)! < 0));
  const fieldError = (label: TranslationKey, value: string, positive = false) => invalid(value, positive) ? t("invalidInput", { field: t(label) }) : undefined;
  const demoDifference = mode === "synthetic" ? comparisonDifference(comparison, "synthetic-a", "synthetic-b", scenario) : null;
  const statusMessage = [mode === "synthetic" ? t("synthetic") : providerStatus === "loading" ? t("loadingRecords") : providerStatus !== "ready" || !records.length ? t("providerUnavailable") : p("connected"), mode === "reported" && historical ? p("historical") : "", mode === "reported" && !["en", "hi", "gu"].includes(language) ? p("translation") : "", language !== "en" ? t("machineNotice") : "", isPartial(language) ? t("fallbackNotice") : "", active.length ? t("missingCount", { count: new Intl.NumberFormat(meta.tag).format(active.reduce((count, market) => count + market.estimate.missingAssumptions.length, 0)) }) : ""].filter(Boolean).join(" · ");
  const explanationInput: ExplanationInput = { mode, scenario, language, observationSnapshotId: mode === "reported" ? providerInfo?.observationSnapshotId : undefined, recordIds: availableRecords.map(x => x.observation.id), form: { ...form, village: "" }, assumptions: Object.fromEntries(availableRecords.map(x => [marketAssumptionKey(x), assumptions[marketAssumptionKey(x)]])), asOfEpochMs: historical ? Date.parse(`${pricesAsOn}T12:00:00+05:30`) : actualNow, pricesAsOn, expected: comparisonProjection(comparison, scenario), suppressBest: unknownRadius || invalidComparisonDate || filterDirty || invalidDateRange };

  return <DeferredValidationContext.Provider value={!submitted}><FieldLabelsContext.Provider value={{ required: t("required"), optional: t("optional") }}><main lang={meta.tag} dir={meta.dir}>
    <header><div><a className="brand" href="/">MandiNet</a><p className="header-description">{t("description")}</p></div>
      <div className="language-controls"><LanguageSelector value={language} onChange={setLanguage} /></div></header>
    <div className="data-banner" role="status"><div><p>{statusMessage}</p></div>
      <button type="button" className={mode === "synthetic" ? "secondary" : "primary"} onClick={mode === "synthetic" ? () => { setMode("reported"); setForm(current => ({ ...emptyFarmerForm(), village: current.village })); setAssumptions(current => Object.fromEntries(Object.entries(current).filter(([key]) => key.startsWith("reported:")))); setMarketId(""); setProviderInfo(null); } : tryDemo}>{t(mode === "synthetic" ? "useRealData" : "tryDemo")}</button>
    </div>
    {mode === "reported" && <p className="fine">{p("date")}: {formatDate(language, pricesAsOn)}{historical ? ` · ${p("historical")}` : ""}</p>}
    <div className="farmer-layout"><div className="form-column">
      <section className="panel" aria-labelledby="crop-title"><h2 id="crop-title"><span className="step">1</span>{t("locationCrop")}</h2>
        <VillageSearch value={form.village} onTextChange={village => updateForm({ village })} origin={origin} onOriginChange={changeOrigin} state={verified?.states.find(x => x.value === form.stateId)?.label ?? records.find(x => x.location?.stateId === form.stateId)?.location?.stateLabel ?? ""} district={verified?.districts.find(x => x.value === form.districtId)?.label ?? records.find(x => x.location?.districtId === form.districtId)?.location?.districtLabel ?? ""} language={language} />
        {mode === "synthetic" && <p className="fine">{t("demoLocation")}</p>}
        <div className="fields">{selectionField("cropId", "crop")}{selectionField("varietyId", "variety")}</div>
        {availableRecords.some((record) => record.observation.grade) && <SelectField label={t("grade")} value={form.grade} onChange={(grade) => updateForm({ grade })} options={[{ value: "", label: t("selectOption") }, ...[...new Set(availableRecords.map((record) => record.observation.grade).filter(Boolean))].map((grade) => ({ value: grade!, label: grade! }))]} />}
        <div className="fields"><NumberField label={t("quantity")} value={form.quantity} onChange={(quantity) => updateForm({ quantity })} error={globalError("quantity") ? assumptionText(language, globalError("quantity")!) : fieldError("quantity", form.quantity, true)} />
          <SelectField label={t("unit")} value={form.unit} onChange={(unit) => updateForm({ unit: unit as FarmerForm["unit"] })} options={["kg", "quintal", "tonne", "bag"].map((unit) => ({ value: unit, label: t(unit as TranslationKey) }))} /></div>
        {form.unit === "bag" && <NumberField label={t("kgPerBag")} value={form.kgPerBag} onChange={(kgPerBag) => updateForm({ kgPerBag })} error={globalError("kgPerBag") ? assumptionText(language, globalError("kgPerBag")!) : fieldError("kgPerBag", form.kgPerBag, true)} />}
        <SelectField label={t("roadLimit")} value={form.distanceLimit} onChange={(distanceLimit) => updateForm({ distanceLimit })} options={[{ value: "25", label: "25 km" }, { value: "50", label: "50 km" }, { value: "100", label: "100 km" }, { value: "custom", label: t("custom") }]} />
        {form.distanceLimit === "custom" && <NumberField label={t("customDistance")} value={form.customDistance} onChange={(customDistance) => updateForm({ customDistance })} error={fieldError("customDistance", form.customDistance, true)} />}
        <details className="advanced" open={regionOpen} onToggle={event => setRegionOpen(event.currentTarget.open)}><summary>{t("regionOptions")}</summary><div className="fields">{selectionField("stateId", "state")}{selectionField("districtId", "district")}</div></details>
        <details className="advanced"><summary>{t("advancedOptions")}</summary>{mode === "reported" && <>
          <SelectField label={p("market")} required={false} value={marketId} onChange={value => { ++providerRequest.current; setMarketId(value); setFilterDirty(true); if (providerStatus === "loading") setProviderStatus("unavailable"); }} options={[{ value: "", label: t("selectOption") }, ...(verified?.markets.filter(x => x.stateId === form.stateId && x.districtId === form.districtId) ?? [])]} />
          <DateField label={p("date")} required value={pricesAsOn} error={invalidComparisonDate ? t("reasonDate") : undefined} max={actualNow ? kolkataToday(actualNow) : undefined} onChange={value => { ++providerRequest.current; setPricesAsOn(value); setFilterDirty(!providerInfo?.providerId.includes("import")); if (providerStatus === "loading") setProviderStatus("unavailable"); }} />
          <p className="fine">{p("exact")}</p>{filterDirty && <p className="fine" role="status">{p("selected")}</p>}
        </>}
        <div className="fields date-fields"><DateField label={t("observationFrom")} value={dateFrom} onChange={setDateFrom} max={dateTo || undefined} /><DateField label={t("observationTo")} value={dateTo} onChange={setDateTo} min={dateFrom || undefined} error={invalidDateRange ? t("dateRangeError") : undefined} /></div>
        {mode === "reported" && <RoadRoutingPanel markets={routingMarkets} origin={origin} destinations={destinations} routes={routes} onDestination={changeDestination} onRoutes={receiveRoutes} language={language} manualDistances={Object.fromEntries(routingMarkets.map(x => [x.id, assumptions[`reported:${x.id}`] ?? { outbound: "", returnKm: "" }]))} onManualDistance={manualDistance} />}
        </details>
        {mode === "reported" && <button type="button" className="primary" onClick={refresh} disabled={providerStatus === "loading"}>{t("refresh")}</button>}
      </section>
      <section className="panel" aria-labelledby="transport-title"><h2 id="transport-title"><span className="step">2</span>{t("transportExpenses")}</h2>
        <p className="load-count">{commonQuantity.loads !== null && commonQuantity.quantity ? t("loadSummary", { loads: commonQuantity.loads, kg: commonQuantity.quantity.totalKg }) : t("quantityPayloadHint")}</p>
        {active.map(market => <div className="expense-summary" key={market.observation.id}><strong>{marketName(lookup(market.observation.id))}</strong><p>{t("transportCost")}: {money(market.estimate.scenarios[scenario].transportCost)} · {t("sellingCost")}: {money(market.estimate.scenarios[scenario].sellingExpenses)}</p><p>{t("missingCount", { count: new Intl.NumberFormat(meta.tag).format(market.estimate.missingAssumptions.length) })}</p></div>)}
        {!active.length && <p className="fine">{t("missingCount", { count: commonQuantity.missingAssumptions.length })}</p>}
        <details className="cost-editor"><summary>{t("editCosts")}</summary>
        {active.some(market => assumptions[marketAssumptionKey(lookup(market.observation.id))].mode !== "unselected") && <>
        <div className="fields"><NumberField label={t("payload")} value={form.payload} onChange={(payload) => updateForm({ payload })} error={globalError("usablePayloadKg") ? assumptionText(language, globalError("usablePayloadKg")!) : fieldError("payload", form.payload, true)} />
          <SelectField label={t("payloadUnit")} value={form.payloadUnit} onChange={(payloadUnit) => updateForm({ payloadUnit: payloadUnit as FarmerForm["payloadUnit"] })} options={["kg", "quintal", "tonne"].map((unit) => ({ value: unit, label: t(unit as TranslationKey) }))} /></div>
        <label className="check"><input type="checkbox" checked={form.payloadConfirmed} onChange={(event) => updateForm({ payloadConfirmed: event.target.checked })} />{t("confirmPayload")}</label>
        </>}
        <p className="fine">{t("transportNotice")}</p>
        {active.map((market) => {
          const id = market.observation.id, record = lookup(id), entry = assumptions[marketAssumptionKey(record)];
          const errorFor = (field: string) => market.estimate.missingAssumptions.find((item) => item.field === field);
          const transportNumber = (label: TranslationKey, key: "outbound" | "returnKm" | "loadedMileage" | "emptyMileage" | "fuelPrice" | "driver" | "toll" | "other", field: string) => <NumberField label={t(label)} required={key !== "outbound" || entry.mode === "owned"} value={entry[key]} onChange={(value) => updateMarket(id, { [key]: value, ...(key === "outbound" ? { distanceMethod: "manual" } : key === "returnKm" ? { returnDistanceMethod: "manual" } : {}) })} error={errorFor(field) ? assumptionText(language, errorFor(field)!) : fieldError(label, entry[key], ["loadedMileage", "emptyMileage", "fuelPrice"].includes(key))} />;
          return <details className="market-assumptions" key={id}><summary>{marketName(record)}<span>{t("editableEstimate")}</span></summary>
            <SelectField label={t("transportMode")} value={entry.mode} onChange={(value) => updateMarket(id, { mode: value as MarketForm["mode"] })} options={[{ value: "unselected", label: t("selectOption") }, { value: "owned", label: t("owned") }, { value: "hired-job", label: t("hiredJob") }, { value: "hired-load", label: t("hiredLoad") }]} />
            {entry.mode !== "unselected" && <>
            {transportNumber("outbound", "outbound", "outboundKm")}<small className="fine">{entry.distanceMethod === "fetched" ? l("fetched") : l("manual")}</small>
            {entry.mode === "owned" ? <>
              {!entry.sameReturn && transportNumber("returnDistance", "returnKm", "returnKm")}
              {!entry.sameReturn && <small className="fine">{entry.returnDistanceMethod === "fetched" ? l("fetched") : l("manual")}</small>}
              <label className="check"><input type="checkbox" checked={entry.sameReturn} onChange={(event) => updateMarket(id, { sameReturn: event.target.checked })} />{t("sameReturn")}</label>
              <div className="fields">{transportNumber("loadedMileage", "loadedMileage", "loadedKmPerLitre")}{transportNumber("emptyMileage", "emptyMileage", "emptyKmPerLitre")}</div>
              <div className="fields"><SelectField label={t("fuelType")} value={entry.fuelType} onChange={(value) => updateMarket(id, { fuelType: value as MarketForm["fuelType"] })} options={["diesel", "petrol", "otherFuel"].map((value) => ({ value, label: t(value as TranslationKey) }))} />{transportNumber("fuelPrice", "fuelPrice", "fuelPricePerLitre")}</div>
              <button type="button" className="text-button" onClick={() => setAssumptions((current) => Object.fromEntries(Object.entries(current).map(([key, value]) => [key, availableRecords.some(record => marketAssumptionKey(record) === key) ? { ...value, fuelType: entry.fuelType, fuelPrice: entry.fuelPrice, loadedMileage: entry.loadedMileage, emptyMileage: entry.emptyMileage } : value]))) }>{t("applyFuel")}</button>
            </> : <>
              <NumberField label={t("quote")} value={entry.quote} onChange={(quote) => updateMarket(id, { quote })} error={errorFor("hireQuote") ? assumptionText(language, errorFor("hireQuote")!) : undefined} />
              <p className="fine">{t(entry.mode === "hired-job" ? "jobQuoteNotice" : "loadQuoteNotice")}</p>
              <SelectField label={t("quoteInclusion", { expense: t("fuel") })} value={entry.inclusions.fuel} onChange={(value) => updateMarket(id, { inclusions: { ...entry.inclusions, fuel: value as QuoteInclusion } })} options={["included", "excluded", "unknown"].map((value) => ({ value, label: t(value as TranslationKey) }))} />
              {entry.inclusions.fuel === "included" && <p className="included-note">{t("includedTransport")}</p>}
              {entry.inclusions.fuel === "excluded" && <NumberField label={t("additionalCost", { expense: t("fuel") })} value={entry.extras.fuel} onChange={(value) => updateMarket(id, { extras: { ...entry.extras, fuel: value } })} error={errorFor("additional.fuel") ? assumptionText(language, errorFor("additional.fuel")!) : undefined} />}
              <div className="fields">{(["loading", "unloading"] as const).map((category) => {
                const row = entry.expenses[category], inclusion = row.status === "included" && row.includedIn === "transport" ? "included" : row.status === "unknown" ? "unknown" : "excluded";
                return <SelectField key={category} label={t("quoteInclusion", { expense: t(category) })} value={inclusion} onChange={(value) => updateExpense(id, category, value === "included" ? { status: "included", includedIn: "transport" } : value === "unknown" ? { status: "unknown" } : { status: row.status === "zero" ? "zero" : "amount" })} options={["included", "excluded", "unknown"].map((value) => ({ value, label: t(value as TranslationKey) }))} />;
              })}</div>
            </>}
            <details className="advanced"><summary>{t("advancedTransport")}</summary>{(["driver", "toll", "other"] as const).map((category) => entry.mode === "owned" ? <NumberField key={category} label={t("totalCost", { expense: t(category) })} value={entry[category]} onChange={(value) => updateMarket(id, { [category]: value })} error={errorFor(category) ? assumptionText(language, errorFor(category)!) : undefined} />
              : <div key={category}><SelectField label={t("quoteInclusion", { expense: t(category) })} value={entry.inclusions[category]} onChange={(value) => updateMarket(id, { inclusions: { ...entry.inclusions, [category]: value as QuoteInclusion } })} options={["included", "excluded", "unknown"].map((value) => ({ value, label: t(value as TranslationKey) }))} />
                {entry.inclusions[category] === "excluded" && <NumberField label={t("additionalCost", { expense: t(category) })} value={entry.extras[category]} onChange={(value) => updateMarket(id, { extras: { ...entry.extras, [category]: value } })} error={errorFor(`additional.${category}`) ? assumptionText(language, errorFor(`additional.${category}`)!) : undefined} />}</div>)}</details>
            </>}
            <h3>{t("selling")}</h3><p className="fine">{t("expenseNotice")}</p>
            {SELLING_CATEGORIES.map((category) => {
              const row = entry.expenses[category], error = errorFor(`selling.${category}`);
              return <details className="expense-row" key={category}><summary>{t(category)}<span>{row.status === "included" ? t("includedOther") : row.status === "zero" ? t("noCharge") : row.status === "amount" ? t("editableEstimate") : t("unknown")}</span></summary>
                <SelectField label={t("expenseStatus", { expense: t(category) })} value={row.status} onChange={(value) => updateExpense(id, category, { status: value as ExpenseForm["status"] })} options={[{ value: "amount", label: t("enterAmount") }, { value: "zero", label: t("noCharge") }, { value: "included", label: t("includedOther") }, { value: "unknown", label: t("unknown") }]} />
                {row.status === "amount" && <div className="fields"><NumberField label={t("amount")} value={row.value} onChange={(value) => updateExpense(id, category, { value })} error={error ? assumptionText(language, error) : undefined} />
                  <SelectField label={t("chargingBasis")} value={row.basis} onChange={(basis) => updateExpense(id, category, { basis: basis as ChargingBasis })} options={["fixed-total", "per-quintal", "per-kg", "per-load"].map((value) => ({ value, label: t(value as TranslationKey) }))} /></div>}
                {row.status === "included" && <><SelectField label={t("parentExpense")} value={row.includedIn} onChange={(value) => updateExpense(id, category, { includedIn: value as ExpenseForm["includedIn"] })} options={[{ value: "transport", label: t("transportCost") }, ...SELLING_CATEGORIES.filter((parent) => parent !== category).map((value) => ({ value, label: t(value) }))]} /><p className="included-note">{row.includedIn === "transport" ? t("includedTransport") : t("includedParent", { expense: t(row.includedIn) })}</p></>}
                {submitted && row.status !== "amount" && error && <p className="field-error">{assumptionText(language, error)}</p>}
              </details>;
            })}
          </details>;
        })}
        </details>
      </section>
      {mode === "reported" && <details className="panel"><summary>{t("dataManagement")}</summary>
        {providerInfo && <p className="fine">{p("provider")}: {providerInfo.providerId}</p>}
        {filterError && <p className="fine">{filterError}</p>}{providerInfo?.error && <p className="fine">{providerInfo.error}</p>}
        <h3>{p("import")}</h3><p className="fine">{p("instructions")}</p>
        <Field label={p("file")}>{(id, describedBy) => <input id={id} aria-describedby={describedBy} type="file" accept=".csv,.json,.xlsx,text/csv,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={event => setImportFile(event.target.files?.[0] ?? null)} />}</Field>
        <TextField label={p("source")} required={false} value={importSource} onChange={setImportSource} />
        <TextField label={p("fetched")} required={false} value={importTime} onChange={setImportTime} />
        <TextField label={p("unit")} required={false} value={importUnit} onChange={setImportUnit} />
        <TextField label={p("evidence")} required={false} value={importEvidence} onChange={setImportEvidence} />
        <button type="button" className="primary" disabled={!importFile || providerStatus === "loading"} onClick={importExport}>{p("submit")}</button>
      </details>}
    </div><section className="results-column" aria-labelledby="results-title"><h2 id="results-title"><span className="step">3</span>{t("marketComparison")}</h2>
      <SelectField label={t("scenario")} value={scenario} onChange={(value) => setScenario(value as typeof scenario)} options={[{ value: "reportedModal", label: t("reportedModal") }, { value: "reportedMinimum", label: t("reportedMinimum") }]} />
      <details className="advanced"><summary>{t("priceNotice")}</summary><p>{t("modalNotice")}</p></details>
      {unknownRadius && <p className="warning" role="status">{l("unknownRadius")}</p>}
      {mode === "reported" && (providerStatus !== "ready" || !availableRecords.length) && <div className="empty-state" role="status"><h3>{t("noRecords")}</h3><button type="button" className="primary" onClick={tryDemo}>{t("tryDemo")}</button></div>}
      {mode === "synthetic" && !availableRecords.length && <div className="empty-state" role="status">{t("noRecords")}</div>}
      {ranked.map((market) => {
        const record = lookup(market.observation.id), entry = assumptions[marketAssumptionKey(record)], estimate = market.estimate, sale = estimate.scenarios[scenario];
        const directions = record.observation.dataKind === "synthetic" ? null : googleDirectionsUrl(origin, destinations[record.observation.marketId]);
        const roadRoute = currentRoute(routes[record.observation.marketId], origin, destinations[record.observation.marketId]);
        return <article className={`panel result-card ${!unknownRadius && !invalidComparisonDate && !filterDirty && !invalidDateRange && ranking.bestObservationId === market.observation.id ? "leading" : ""}`} key={market.observation.id}>
          <div className="result-title"><h3>{marketName(record)}</h3>{sale.status !== "complete" && <span className="status incomplete">{t("incomplete")}</span>}</div>
          {!unknownRadius && !invalidComparisonDate && !filterDirty && !invalidDateRange && ranking.bestObservationId === market.observation.id && <p className="best">{t("best")}</p>}
          <p className="fine">{record.observation.dataKind === "synthetic" ? `${t("demoCrop")} / ${t("demoVariety")}` : `${record.observation.crop} / ${record.observation.variety}`}{record.observation.grade ? ` · ${record.observation.grade}` : ""}</p>
          {record.location?.verified && <p className="fine">{record.location.label}</p>}
          <p className="fine">{t("observationDate")}: {formatDate(language, record.observation.observationDate)}</p>
          <div className="price-strip"><div><span>{t("minimumPrice")}</span><strong><bdi>{record.observation.priceUnit === "INR/quintal" ? money(record.observation.minimumPricePerQuintal) : t("unavailable")}</bdi></strong><small>{t("priceUnit")}</small></div><div><span>{t("modalPrice")}</span><strong><bdi>{record.observation.priceUnit === "INR/quintal" ? money(record.observation.modalPricePerQuintal) : t("unavailable")}</bdi></strong><small>{t("priceUnit")}</small></div></div>
          <p className="scenario-label">{t(scenario)}</p><div className="net-block"><span>{t("net")}</span><strong data-testid={`net-${record.observation.id}`}><bdi>{sale.estimatedNetSaleProceeds === null ? t("incomplete") : money(sale.estimatedNetSaleProceeds)}</bdi></strong></div>
          <dl className="breakdown"><div><dt>{t("transportCost")}</dt><dd><bdi>{money(sale.transportCost)}</bdi></dd></div><div><dt>{t("sellingCost")}</dt><dd><bdi>{money(sale.sellingExpenses)}</bdi></dd></div></dl>
          {estimate.missingAssumptions.length > 0 && <p className="warning">{t("missingCount", { count: new Intl.NumberFormat(meta.tag).format(estimate.missingAssumptions.length) })}</p>}
          <details className="advanced"><summary>{t("fullDetails")}</summary>

          <dl className="breakdown"><div><dt>{t("loads")}</dt><dd>{estimate.loads ?? t("unavailable")}</dd></div>
            <div><dt>{entry.distanceMethod === "fetched" ? l("fetched") : l("manual")}</dt><dd>{numeric(entry.outbound) === null ? t("unavailable") : `${entry.outbound} km`}</dd></div>
            <div><dt>{t("gross")}</dt><dd><bdi>{money(sale.grossSaleProceeds)}</bdi></dd></div><div><dt>{t("transportCost")}</dt><dd><bdi>{money(sale.transportCost)}</bdi></dd></div>
            {estimate.sellingExpenseBreakdown.map((line) => <div key={line.category}><dt>{t(line.category)}{line.status === "included" && <small>{line.includedIn === "transport" ? t("includedTransport") : t("includedParent", { expense: t(line.includedIn!) })}</small>}</dt><dd><bdi>{money(line.total)}</bdi></dd></div>)}
            <div className="deduction-total"><dt>{t("totalDeductions")}</dt><dd><bdi>{money(sale.totalDeductions)}</bdi></dd></div>
          </dl>

            <dl className="breakdown"><div><dt>{t("fuelLitres")}</dt><dd>{estimate.transport.fuelLitres ?? t("unavailable")}</dd></div><div><dt>{t("fuel")}</dt><dd>{entry.mode !== "owned" && entry.inclusions.fuel === "included" ? t("includedTransport") : money(estimate.transport.fuelCost)}</dd></div>
              {entry.mode === "owned" ? <div><dt>{t("returnDistance")}{entry.sameReturn && <small>{t("sameReturn")}</small>}</dt><dd>{estimate.transport.returnDistance.km === null ? t("unavailable") : `${estimate.transport.returnDistance.km} km`}</dd></div> : <div><dt>{t(entry.mode === "hired-job" ? "hiredJob" : "hiredLoad")}</dt><dd><bdi>{money(estimate.transport.quoteCost)}</bdi></dd></div>}
              {(["driver", "toll", "other"] as const).map((category) => <div key={category}><dt>{t(category)}</dt><dd><bdi>{entry.mode !== "owned" && estimate.transport.inclusions?.[category] === "included" ? t("includedTransport") : money(estimate.transport.additionalCosts[category])}</bdi></dd></div>)}
              <div><dt>{t("retrievedAt")}</dt><dd>{formatDate(language, record.retrievedAt, true)}</dd></div></dl>
            <p className="fine">{t("source")}: {record.observation.dataKind === "synthetic" ? t("synthetic") : record.observation.sourceLabel}</p>
            {record.observation.sourceUrl && <a href={record.observation.sourceUrl} target="_blank" rel="noreferrer">{t("source")}</a>}
            {record.provenance && <dl className="breakdown"><div><dt>{p("unit")}</dt><dd>{record.provenance.originalPriceUnit ?? t("unknown")}</dd></div><div><dt>{p("evidence")}</dt><dd>{record.provenance.unitEvidence ?? t("unknown")}</dd></div><div><dt>{p("provider")}</dt><dd>{record.provenance.acquisitionMode}</dd></div><div><dt>Source record ID</dt><dd>{record.provenance.sourceRecordId ?? t("unavailable")}</dd></div><div><dt>Maximum reported price (original unit)</dt><dd>{record.provenance.maximumPrice ?? t("unavailable")}</dd></div></dl>}
            {!destinations[record.observation.marketId] && <p className="fine">{l("unresolved")}</p>}
            {roadRoute && <div className="google-content"><p className="fine">{l("fetched")}: {roadRoute.outbound.status === "ready" ? `${roadRoute.outbound.km} km` : l("unavailable")} · {l("return")}: {roadRoute.returnLeg.status === "ready" ? `${roadRoute.returnLeg.km} km` : l("unavailable")}</p><GoogleAttributions /></div>}
            {estimate.missingAssumptions.length > 0 && <div className="issues"><h4>{t("missingAssumptions")}</h4><ul>{estimate.missingAssumptions.map((item, index) => <li key={index}>{assumptionText(language, item)}</li>)}</ul></div>}
          </details>
          <div className="result-actions"><button type="button" disabled={assistantBusy || invalidDateRange || (mode === "reported" && (filterDirty || invalidComparisonDate))} onClick={() => { setSubmitted(true); assistantRef.current?.explain(); }}>{t("explain")}</button>{directions ? <a className="button secondary" href={directions} target="_blank" rel="noreferrer">{t("directions")}</a> : <button type="button" disabled title={t("directionsUnavailable")}>{t("directions")}</button>}</div>
        </article>;
      })}
      {demoDifference && demoDifference.winnerId && <aside className="comparison-explanation">{t("demoExplanation", { marketA: marketName(lookup("synthetic-a")), marketB: marketName(lookup("synthetic-b")), gross: money(demoDifference.grossDifference), transport: money(demoDifference.transportDifference), winner: marketName(lookup(demoDifference.winnerId)), net: money(demoDifference.netDifference) })}</aside>}
      {outsideRecords.length > 0 && <section className="excluded-section"><h3>{l("outside")}</h3>{outsideRecords.map(record => <article className="excluded-card" key={record.observation.id}><h4>{marketName(record)}</h4><p>{l("outside")}</p><p>{t("minimumPrice")}: {record.provenance?.rawMinimum ?? record.observation.minimumPricePerQuintal ?? t("unavailable")} · {t("modalPrice")}: {record.provenance?.rawModal ?? record.observation.modalPricePerQuintal ?? t("unavailable")} · {record.provenance?.originalPriceUnit ?? record.observation.priceUnit}</p><p className="fine">{t("observationDate")}: {formatDate(language, record.observation.observationDate)}</p></article>)}</section>}
      {excluded.length > 0 && <section className="excluded-section"><h3>{t("excludedRecords")}</h3>{excluded.map((market) => <article className="excluded-card" key={market.observation.id}><h4>{marketName(lookup(market.observation.id))}</h4><p className="fine">{t("observationDate")}: {formatDate(language, market.observation.observationDate)}</p>
        <p className="fine">{market.observation.crop} / {market.observation.variety}{market.observation.grade ? ` · ${market.observation.grade}` : ""}</p>
        <p>{t("minimumPrice")}: {lookup(market.observation.id).provenance?.rawMinimum ?? market.observation.minimumPricePerQuintal ?? t("unavailable")} · {t("modalPrice")}: {lookup(market.observation.id).provenance?.rawModal ?? market.observation.modalPricePerQuintal ?? t("unavailable")} · {lookup(market.observation.id).provenance?.originalPriceUnit ?? market.observation.priceUnit}</p>
        {market.observation.priceUnit === "unknown" && <p>{p("unknown")}</p>}
        <ul>{market.eligibility.exclusionReasons.map((reason, index) => <li key={index}>{exclusionText(language, reason, market.eligibility.ageDays)}</li>)}</ul></article>)}</section>}
      <ComparisonAssistant ref={assistantRef} input={explanationInput} revision={JSON.stringify([form.village, origin?.key, dateFrom, dateTo, marketId])} onBusy={setAssistantBusy} />
    </section></div><footer>{t("footer")}<p><a href="/terms">{l("terms")}</a> · <a href="/privacy">{l("privacy")}</a></p></footer>
  </main></FieldLabelsContext.Provider></DeferredValidationContext.Provider>;
}
