"use client";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { assistantText, type AssistantKey } from "../../lib/agent/copy";
import type { Activity, ExplanationInput, ExplanationResult } from "../../lib/agent/comparison";
import { assumptionText, exclusionText, formatDate, formatMoney, translate, type TranslationKey } from "../../lib/i18n";

export type AssistantHandle = { explain: () => void };
export const ComparisonAssistant = forwardRef<AssistantHandle, { input: ExplanationInput; revision: string; onBusy: (busy: boolean) => void }>(function ComparisonAssistant({ input, revision, onBusy }, ref) {
  const signature = JSON.stringify(input) + revision, sequence = useRef(0), controller = useRef<AbortController | null>(null), running = useRef(false);
  const [result, setResult] = useState<ExplanationResult | null>(null), [activity, setActivity] = useState<Activity[]>([]), [error, setError] = useState(false), [invalidated, setInvalidated] = useState(false);
  const c = (key: AssistantKey) => assistantText(input.language, key), t = (key: TranslationKey) => translate(input.language, key);
  useEffect(() => { ++sequence.current; controller.current?.abort(); running.current = false; onBusy(false); setInvalidated(!!result); setResult(null); setActivity([]); setError(false); return () => controller.current?.abort(); }, [signature]);
  useImperativeHandle(ref, () => ({ explain() { if (!running.current) void explain(); } }), [signature]);
  async function explain() {
    const request = ++sequence.current, abort = new AbortController(); controller.current?.abort(); controller.current = abort; running.current = true; onBusy(true); setResult(null); setActivity([]); setError(false); setInvalidated(false);
    const timer = setTimeout(() => abort.abort(), 30_000);
    try {
      const response = await fetch("/api/agent/explain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal: abort.signal, cache: "no-store" });
      if (!response.ok || !response.body) throw new Error("Explanation unavailable");
      const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = "", received = false;
      const consume = (line: string) => { if (!line || request !== sequence.current) return; const event = JSON.parse(line); if (event.activity) setActivity(current => [...current.filter(x => x.step !== event.activity.step), event.activity]); if (event.result) { received = true; setResult(event.result); } };
      while (true) { const chunk = await reader.read(); if (request !== sequence.current) { await reader.cancel(); return; } buffer += decoder.decode(chunk.value, { stream: !chunk.done }); if (buffer.length > 250_000) throw new Error("Invalid response"); const parts = buffer.split("\n"); buffer = parts.pop()!; parts.forEach(consume); if (chunk.done) { consume(buffer); break; } }
      if (!received) throw new Error("No result");
    } catch { if (request === sequence.current) setError(true); }
    finally { clearTimeout(timer); if (request === sequence.current) { running.current = false; onBusy(false); } }
  }
  const name = (line: ExplanationResult["lines"][number]) => line.dataKind === "synthetic" ? translate(input.language, "demoMarket", { letter: line.marketId.slice(-1).toUpperCase() }) : line.marketLabel;
  if (!result && !error && !invalidated && !running.current && activity.length === 0) return null;
  return <section className="panel comparison-assistant" aria-label={c("title")}>
    <h3>{c("title")}</h3>{invalidated && !result && <p className="fine" role="status">{c("invalidated")}</p>}
    {activity.length > 0 && <div className="assistant-activity" aria-live="polite"><h4>{c("activity")}</h4><ul>{activity.map(item => <li key={item.step}>{c(item.step)}: {c(item.status)}{item.detail && <small>{item.detail}</small>}</li>)}</ul></div>}
    {(error || result?.status === "unavailable") && <p className="warning" role="status">{c("unavailable")} — {result?.reason === "CLINE_NOT_CONFIGURED" ? c("missing") : c("failure")}</p>}
    {result && <><p className="fine">{c(result.mode === "synthetic" ? "synthetic" : "reported")} · {t(result.scenario)}</p>
      {result.status === "complete" ? <div><p>{c("sdk")}</p>{result.bestObservationId && <strong>{name(result.lines.find(line => line.observationId === result.bestObservationId)!)}</strong>}{result.reasonCodes?.map(code => <p key={code}>{c(code as AssistantKey)}</p>)}</div> : result.toolsRan.length === 0 && <p className="fine">{c("notRun")}</p>}
      <h4>{c("summary")}</h4>{result.lines.map(line => <details key={line.observationId} open><summary>{name(line)}{!line.eligibility.eligible && ` · ${t("excluded")}`}</summary>
        <p className="fine">{t("observationDate")}: {formatDate(input.language, line.observationDate)} · {line.priceUnit}</p>
        {line.eligibility.eligible && <dl className="breakdown">{([ ["gross", line.scenario.grossSaleProceeds], ["transportCost", line.scenario.transportCost], ["sellingCost", line.scenario.sellingExpenses], ["net", line.scenario.estimatedNetSaleProceeds] ] as [TranslationKey, number | null][]).map(([label, amount]) => <div key={label}><dt>{t(label)}</dt><dd><bdi>{amount === null ? t("incomplete") : formatMoney(input.language, amount)}</bdi></dd></div>)}</dl>}
        {line.missingAssumptions.length > 0 && <div><strong>{t("missingAssumptions")}</strong><ul>{line.missingAssumptions.map((issue, index) => <li key={index}>{assumptionText(input.language, issue)}</li>)}</ul></div>}
        {!line.eligibility.eligible && <ul>{line.eligibility.exclusionReasons.map((reason, index) => <li key={index}>{exclusionText(input.language, reason, line.eligibility.ageDays)}</li>)}</ul>}
        <p className="fine">{t("source")}: {line.sourceLabel} · {line.observationId}</p>
      </details>)}<p className="fine">{result.calculationId}</p></>}
    {!["en", "hi", "gu"].includes(input.language) && <p className="translation-notice">{c("fallback")}</p>}
  </section>;
});
