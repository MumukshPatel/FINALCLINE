"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Field, NumberField } from "./form-fields";
import { requestLocation, validCoordinates, type Coordinates } from "../../lib/location";
import { SAVED_VILLAGE_KEY, originKey, destinationKey, placeRegionMismatch, googleDirectionsUrl, type ConfirmedOrigin, type GooglePlace, type GoogleAttribution, type MarketDestination, type MarketRoute } from "../../lib/location/routing";
import { locationText } from "../../lib/location/copy";
import { translate } from "../../lib/i18n";

export async function locationRequest(body: unknown, signal?: AbortSignal) {
  const response = await fetch("/api/location/google", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal, cache: "no-store" });
  const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Location request failed."); return result;
}
export function GoogleAttributions({ items = [] }: { items?: GoogleAttribution[] }) {
  return <div className="google-attribution"><span translate="no">Google Maps</span>{items.map((item, index) => <span key={index}>{item.uri ? <a href={item.uri} target="_blank" rel="noreferrer">{item.provider}</a> : item.provider}</span>)}</div>;
}
export function VillageSearch({ value, onTextChange, origin, onOriginChange, state, district, language }: { value: string; onTextChange: (value: string) => void; origin: ConfirmedOrigin | null; onOriginChange: (origin: ConfirmedOrigin | null) => void; state: string; district: string; language: string }) {
  const c = (key: Parameters<typeof locationText>[1]) => locationText(language, key);
  const [configured, setConfigured] = useState<boolean | null>(null), [saved, setSaved] = useState<string | null>(null), [remember, setRemember] = useState(false);
  const [suggestions, setSuggestions] = useState<{ placeId: string; text: string }[]>([]), [pending, setPending] = useState<ConfirmedOrigin | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [searched, setSearched] = useState(false), [bias, setBias] = useState<unknown>(null);
  const sequence = useRef(0), session = useRef<string | null>(null), regionSequence = useRef(0);
  const listId = useId(), inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { const controller = new AbortController(); fetch("/api/location/google", { signal: controller.signal, cache: "no-store" }).then(response => response.json()).then(result => setConfigured(result.configured === true)).catch(() => { if (!controller.signal.aborted) setConfigured(false); }); try { setSaved(localStorage.getItem(SAVED_VILLAGE_KEY)); } catch { /* optional storage */ } return () => controller.abort(); }, []);
  useEffect(() => { setBias(null); if (!configured || !state) return; const request = ++regionSequence.current, controller = new AbortController(); locationRequest({ action: "region-bias", state, district }, controller.signal).then(result => { if (request === regionSequence.current && !controller.signal.aborted) setBias(result.bias); }).catch(() => { /* A missing bias does not prevent India-restricted search. */ }); return () => controller.abort(); }, [state, district, configured]);
  useEffect(() => {
    setSuggestions([]); setSearched(false);
    if (!configured || value.trim().length < 3 || origin || pending) return;
    const request = ++sequence.current, controller = new AbortController();
    const timer = setTimeout(() => { session.current ??= crypto.randomUUID(); setBusy(true); setError(""); locationRequest({ action: "autocomplete", input: value, sessionToken: session.current, bias }, controller.signal).then(result => { if (request === sequence.current && !controller.signal.aborted) { setSuggestions(result.suggestions); setSearched(true); } }).catch(error => { if (request === sequence.current && !controller.signal.aborted) setError(error.message); }).finally(() => { if (request === sequence.current && !controller.signal.aborted) setBusy(false); }); }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [value, configured, bias, origin, pending]);
  function edit(text: string) { ++sequence.current; setBusy(false); setPending(null); onOriginChange(null); onTextChange(text); setError(""); }
  async function select(placeId: string, reuse = false) {
    const request = ++sequence.current; setBusy(true); setError(""); onOriginChange(null);
    try { const result = await locationRequest({ action: "details", placeId, ...(reuse ? {} : { sessionToken: session.current }) }); if (request !== sequence.current) return;
      const place = result.place as GooglePlace; setPending({ key: originKey(place.coordinates, place.placeId), confirmed: true, source: "google-places", coordinates: place.coordinates, placeId: place.placeId, name: place.name, address: place.address, state: place.state, district: place.district, attributions: place.attributions }); onTextChange(place.name); setSuggestions([]); session.current = null;
    } catch (error) { if (request === sequence.current) setError(reuse ? c("savedError") : error instanceof Error ? error.message : "Place Details failed."); }
    finally { if (request === sequence.current) setBusy(false); }
  }
  async function locate() { const request = ++sequence.current; setBusy(true); setError(""); setPending(null); onOriginChange(null); const result = await requestLocation(navigator.geolocation); if (request !== sequence.current) return; setBusy(false); if (result.status !== "success") { setError(c("gpsError")); return; } setPending({ key: originKey(result.coordinates), confirmed: true, source: "browser-gps", coordinates: result.coordinates, name: "Current browser location", accuracyMetres: result.accuracyMetres }); setSuggestions([]); }
  const mismatch = pending?.source === "google-places" ? placeRegionMismatch({ state: pending.state ?? "", district: pending.district ?? "" }, state, district) : [];
  const confirmedMismatch = origin?.source === "google-places" ? placeRegionMismatch({ state: origin.state ?? "", district: origin.district ?? "" }, state, district) : [];
  function forget() { try { localStorage.removeItem(SAVED_VILLAGE_KEY); } catch { /* optional */ } setSaved(null); setRemember(false); ++sequence.current; setPending(null); onOriginChange(null); onTextChange(""); }
  function confirm() { if (!pending || mismatch.length) return; onOriginChange(pending); if (pending.source === "google-places") onTextChange(pending.name); if (pending.placeId && remember) try { localStorage.setItem(SAVED_VILLAGE_KEY, pending.placeId); setSaved(pending.placeId); } catch { setError("Device storage is unavailable; this origin still works for the current session."); } setPending(null); }
  return <div className="village-search">
    <Field label={translate(language, "village")} required={false} hint={configured ? c("select") : undefined}>{(id, describedBy) => <input ref={inputRef} id={id} type="text" role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded={suggestions.length > 0} aria-controls={suggestions.length ? listId : undefined} aria-describedby={describedBy} autoComplete="off" value={value} onChange={event => edit(event.target.value)} onKeyDown={event => { if (event.key === "Escape") setSuggestions([]); if (event.key === "ArrowDown" && suggestions.length) { event.preventDefault(); document.getElementById(listId)?.querySelector<HTMLButtonElement>("button")?.focus(); } }} />}</Field>
    {configured === false && <p className="fine">{translate(language, "roadUnavailable")}</p>}
    {busy && <p className="fine" role="status">{c("searching")}</p>}
    {error && <p className="warning" role="alert">{error}</p>}
    {suggestions.length > 0 && <div className="google-content"><ul id={listId} role="listbox" className="place-suggestions" aria-label={c("search")}>{suggestions.map((item, index) => <li key={item.placeId} role="presentation"><button type="button" role="option" aria-selected={false} onClick={() => select(item.placeId)} onKeyDown={event => { if (event.key === "Escape") { setSuggestions([]); inputRef.current?.focus(); } if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); const buttons = document.getElementById(listId)?.querySelectorAll<HTMLButtonElement>("button"); buttons?.[(index + (event.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length]?.focus(); } }}>{item.text}</button></li>)}</ul><GoogleAttributions /></div>}
    {searched && !suggestions.length && !busy && !origin && !pending && <p className="fine">{c("empty")}</p>}
    <button type="button" className="secondary" disabled={busy} onClick={locate}>{translate(language, "useLocation")}</button>
    {saved && <div className="result-actions"><button type="button" disabled={!configured || busy} onClick={() => select(saved, true)}>{c("reuse")}</button><button type="button" onClick={forget}>{c("forget")}</button></div>}
    {(pending || origin) && <div className="origin-summary"><strong>{origin ? c("origin") : c("confirm")}</strong><p>{(pending ?? origin)!.name}<br />{(pending ?? origin)!.address}</p><p className="fine">{(pending ?? origin)!.coordinates.latitude.toFixed(5)}, {(pending ?? origin)!.coordinates.longitude.toFixed(5)} · {(pending ?? origin)!.source}</p>
      {(pending ?? origin)!.source === "browser-gps" && <p className="fine">{c("accuracy")}: {(pending ?? origin)!.accuracyMetres ?? "Unavailable"}</p>}
      {[...mismatch, ...confirmedMismatch].length > 0 && <p className="warning" role="alert">{c("mismatch")} {[...mismatch, ...confirmedMismatch].join("; ")}</p>}
      {(pending ?? origin)!.source === "google-places" && <><GoogleAttributions items={(pending ?? origin)!.attributions} /><label className="check"><input type="checkbox" checked={remember} onChange={event => { setRemember(event.target.checked); if (!event.target.checked) { try { localStorage.removeItem(SAVED_VILLAGE_KEY); } catch { /* optional */ } setSaved(null); } }} />{c("remember")}</label></>}
      {pending && <><p className="fine">{c("confirmGPS")}</p><button type="button" className="primary" disabled={mismatch.length > 0} onClick={confirm}>{c("confirm")}</button></>}
      <button type="button" className="secondary" onClick={() => edit("")}>{c("change")}</button>
    </div>}
    {!["en", "hi", "gu"].includes(language) && <p className="translation-notice">{c("fallback")}</p>}
  </div>;
}

export type RoutingMarket = { id: string; label: string; coordinates?: Coordinates | null; state?: string; district?: string };
export function RoadRoutingPanel({ markets, origin, destinations, routes, onDestination, onRoutes, language, manualDistances, onManualDistance }: { markets: RoutingMarket[]; origin: ConfirmedOrigin | null; destinations: Record<string, MarketDestination>; routes: Record<string, MarketRoute>; onDestination: (marketId: string, destination: MarketDestination | null) => void; onRoutes: (routes: MarketRoute[]) => void; language: string; manualDistances: Record<string, { outbound: string; returnKm: string; distanceMethod?: string | null; returnDistanceMethod?: string | null }>; onManualDistance: (marketId: string, direction: "outbound" | "returnKm", value: string) => void }) {
  const c = (key: Parameters<typeof locationText>[1]) => locationText(language, key);
  const [candidates, setCandidates] = useState<Record<string, GooglePlace[]>>({}), [errors, setErrors] = useState<Record<string, string>>({}), [searching, setSearching] = useState<string | null>(null), [routing, setRouting] = useState(false);
  const request = useRef(0), searchRequest = useRef(0), signature = JSON.stringify([origin?.key, markets.map(x => x.id), Object.values(destinations).map(destinationKey)]);
  useEffect(() => { ++request.current; ++searchRequest.current; setRouting(false); setSearching(null); }, [signature]);
  async function find(id: string) { const current = ++searchRequest.current; setSearching(id); setErrors(value => ({ ...value, [id]: "" })); try { const result = await locationRequest({ action: "destinations", marketId: id }); if (current !== searchRequest.current) return; setCandidates(value => ({ ...value, [id]: result.candidates })); if (!result.candidates.length) setErrors(value => ({ ...value, [id]: c("unresolved") })); } catch (error) { if (current === searchRequest.current) setErrors(value => ({ ...value, [id]: error instanceof Error ? error.message : c("unresolved") })); } finally { if (current === searchRequest.current) setSearching(null); } }
  const selected = markets.map(x => destinations[x.id]).filter((x): x is MarketDestination => !!x?.verified);
  async function fetchRoutes() { if (!origin || !selected.length) return; const current = ++request.current; setRouting(true); setErrors(value => ({ ...value, routes: "" })); try { const result = await locationRequest({ action: "routes", origin, destinations: selected }); if (current === request.current) onRoutes(result.routes); } catch (error) { if (current === request.current) setErrors(value => ({ ...value, routes: error instanceof Error ? error.message : c("unavailable") })); } finally { if (current === request.current) setRouting(false); } }
  return <section className="road-routing"><p className="fine">{c("shortlist")}</p><p className="fine">{c("estimate")}</p>{markets.map(market => {
    const destination = destinations[market.id], route = routes[market.id], directions = googleDirectionsUrl(origin, destination);
    return <details key={market.id} className="market-assumptions"><summary>{market.label}</summary>
      {!destination && <p className="fine">{c("unresolved")}</p>}
      <button type="button" disabled={searching !== null} onClick={() => find(market.id)}>{searching === market.id ? c("searching") : c("yard")}</button>
      {errors[market.id] && <p className="warning" role="alert">{errors[market.id]}</p>}
      {candidates[market.id]?.map(place => <div key={place.placeId} className="google-content"><p>{place.name}<br />{place.address}</p><p className="fine">{place.coordinates.latitude}, {place.coordinates.longitude}</p><GoogleAttributions items={place.attributions} /><button type="button" onClick={() => { onDestination(market.id, { marketId: market.id, marketName: market.label, coordinates: place.coordinates, placeId: place.placeId, name: place.name, address: place.address, verified: true, verification: "farmer-confirmed-google-yard", attributions: place.attributions }); setCandidates(value => ({ ...value, [market.id]: [] })); }}>{c("candidate")}</button></div>)}
      {destination && <div className="google-content"><p>{destination.name}<br />{destination.address}</p>{destination.verification === "farmer-confirmed-google-yard" && <GoogleAttributions items={destination.attributions} />}<button type="button" onClick={() => onDestination(market.id, null)}>{c("change")}</button></div>}
      {route && <div className="google-content"><p className="fine">{c("fetched")}: {route.outbound.status === "ready" ? `${route.outbound.km} km · ${Math.ceil(route.outbound.durationSeconds / 60)} min` : `${c("unavailable")} ${route.outbound.reason}`}</p><p className="fine">{c("return")}: {route.returnLeg.status === "ready" ? `${route.returnLeg.km} km · ${Math.ceil(route.returnLeg.durationSeconds / 60)} min` : `${c("unavailable")} ${route.returnLeg.reason}`}</p><GoogleAttributions /></div>}
      <NumberField label={`${manualDistances[market.id]?.distanceMethod === "fetched" ? c("fetched") : c("manual")} (km)`} required={false} value={manualDistances[market.id]?.outbound ?? ""} onChange={value => onManualDistance(market.id, "outbound", value)} error={manualDistances[market.id]?.outbound && (!Number.isFinite(Number(manualDistances[market.id].outbound)) || Number(manualDistances[market.id].outbound) < 0) ? "Enter a non-negative distance." : undefined} />
      <NumberField label={`${c("return")} — ${manualDistances[market.id]?.returnDistanceMethod === "fetched" ? c("fetched") : c("manual")} (km)`} required={false} value={manualDistances[market.id]?.returnKm ?? ""} onChange={value => onManualDistance(market.id, "returnKm", value)} error={manualDistances[market.id]?.returnKm && (!Number.isFinite(Number(manualDistances[market.id].returnKm)) || Number(manualDistances[market.id].returnKm) < 0) ? "Enter a non-negative distance." : undefined} />
      {directions ? <a className="button secondary" href={directions} target="_blank" rel="noreferrer">{c("directions")}</a> : <button type="button" disabled>{c("directions")}</button>}
    </details>;
  })}<p className="fine">{c("requires")}</p><button type="button" className="primary" disabled={!origin || !selected.length || routing} onClick={fetchRoutes}>{c(routing ? "routeBusy" : "route")}</button>{errors.routes && <p className="warning" role="alert">{errors.routes}</p>}</section>;
}
