"use client";

import { createContext, useContext, useId, useState, type ReactNode } from "react";

export const FieldLabelsContext = createContext({ required: "Required", optional: "Optional" });
export const DeferredValidationContext = createContext(false);
type FieldProps = {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: (id: string, describedBy: string, invalid: boolean) => ReactNode;
};

/** One visible border-inset label, an explicit status and linked help/error text. */
export function Field({ label, children, hint, error, required = true }: FieldProps) {
  const id = useId(), labels = useContext(FieldLabelsContext);
  const deferred = useContext(DeferredValidationContext), [touched, setTouched] = useState(false);
  if (deferred && !touched) error = undefined;
  const describedBy = [`${id}-status`, hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ");
  return <div className={`field outlined-field${error ? " has-error" : ""}`} onBlurCapture={() => setTouched(true)} onChangeCapture={() => setTouched(true)}>
    <fieldset className="field-control">
      <legend><label htmlFor={id}>{label}</label>{" "}<span id={`${id}-status`} className={`field-status ${required ? "is-required" : ""}`}>{required ? labels.required : labels.optional}</span></legend>
      {children(id, describedBy, !!error)}
    </fieldset>
    {hint && <small id={`${id}-hint`}>{hint}</small>}
    {error && <small id={`${id}-error`} className="field-error" role="alert">{error}</small>}
  </div>;
}
type ValueFieldProps = Omit<FieldProps, "children"> & { value: string; onChange: (value: string) => void };

export function NumberField({ label, value, onChange, hint, error, required = true }: ValueFieldProps) {
  return <Field label={label} hint={hint} error={error} required={required}>{(id, describedBy, invalid) =>
    <input id={id} type="number" step="any" inputMode="decimal" value={value} required={required} aria-describedby={describedBy} aria-invalid={invalid} onChange={(event) => onChange(event.target.value)} />}</Field>;
}
export function TextField({ label, value, onChange, hint, error, required = true }: ValueFieldProps) {
  return <Field label={label} hint={hint} error={error} required={required}>{(id, describedBy, invalid) =>
    <input id={id} type="text" value={value} required={required} aria-describedby={describedBy} aria-invalid={invalid} onChange={(event) => onChange(event.target.value)} />}</Field>;
}
export function SelectField({ label, value, onChange, hint, error, required = true, options }: ValueFieldProps & { options: { value: string; label: string }[] }) {
  return <Field label={label} hint={hint} error={error} required={required}>{(id, describedBy, invalid) =>
    <select id={id} value={value} required={required} aria-describedby={describedBy} aria-invalid={invalid} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>}</Field>;
}
export function DateField({ label, value, onChange, hint, error, required = false, min, max }: ValueFieldProps & { min?: string; max?: string }) {
  return <Field label={label} hint={hint} error={error} required={required}>{(id, describedBy, invalid) =>
    <input id={id} type="date" value={value} min={min} max={max} required={required} aria-describedby={describedBy} aria-invalid={invalid} onInput={(event) => onChange(event.currentTarget.value)} onChange={(event) => onChange(event.target.value)} />}</Field>;
}
