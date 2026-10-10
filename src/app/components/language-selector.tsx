"use client";
import { useEffect, useId, useState } from "react";
import { isPartial, locales, translate } from "../../lib/i18n";
import { Field } from "./form-fields";

/** Native searchable combobox: accepts only registered languages, never changes form values. */
export function LanguageSelector({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const list = useId(), label = (id: string) => { const locale = locales.find(x => x.id === id)!; return `${locale.name} (${locale.englishName})`; };
  const [query, setQuery] = useState(label(value));
  useEffect(() => setQuery(label(value)), [value]);
  return <Field label={translate(value, "language")} required={false}>{(id, describedBy) => <>
    <input id={id} type="search" list={list} value={query} aria-describedby={describedBy} onFocus={event => event.target.select()} onBlur={() => setQuery(label(value))} onChange={event => { const text = event.target.value; setQuery(text); const selected = locales.find(locale => [label(locale.id), locale.name, locale.englishName].some(name => name.toLowerCase() === text.toLowerCase())); if (selected) onChange(selected.id); }} />
    <datalist id={list}>{locales.map(locale => <option key={locale.id} value={label(locale.id)}>{isPartial(locale.id) ? translate(value, "partial") : locale.name}</option>)}</datalist>
  </>}</Field>;
}
