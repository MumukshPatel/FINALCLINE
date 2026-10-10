import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DateField, DeferredValidationContext, FieldLabelsContext, NumberField, SelectField, TextField } from "./form-fields";

const onChange = () => {};
describe("accessible outlined form controls", () => {
  it("does not expose untouched errors in deferred validation mode", () => {
    const html = renderToStaticMarkup(createElement(DeferredValidationContext.Provider, { value: true }, createElement(NumberField, { label: "Quantity", value: "", onChange, error: "Quantity is required" })));
    expect(html).not.toContain("has-error");
    expect(html).not.toContain('aria-invalid="true"');
    expect(html).not.toContain('role="alert"');
    expect(html).toContain('required=""');
  });
  it("keeps a real number label, units, required state and linked hint/error", () => {
    const html = renderToStaticMarkup(createElement(NumberField, { label: "Cost (₹)", value: "-1", onChange, hint: "Whole-job total", error: "Enter a nonnegative cost" }));
    const labelId = html.match(/<label for="([^"]+)"/)?.[1];
    expect(labelId).toBeTruthy();
    expect(html).toContain(`id="${labelId}"`);
    expect(html).toContain('type="number"');
    expect(html).toContain('required=""');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain(`aria-describedby="${labelId}-status ${labelId}-hint ${labelId}-error"`);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Whole-job total");
    expect(html).toContain("Cost (₹)");
  });
  it("marks manual optional input without using a placeholder as its label", () => {
    const html = renderToStaticMarkup(createElement(TextField, { label: "Village", value: "", onChange, required: false }));
    expect(html).toContain("Optional");
    expect(html).toContain('type="text"');
    expect(html).not.toContain('required=""');
    expect(html).not.toContain("placeholder=");
  });
  it("retains a native select with the selected option", () => {
    const html = renderToStaticMarkup(createElement(SelectField, { label: "Scenario", value: "minimum", onChange, options: [{ value: "modal", label: "Modal" }, { value: "minimum", label: "Minimum" }] }));
    expect(html).toContain("<select");
    expect(html).toContain('value="minimum" selected=""');
    expect(html).toContain("<legend>");
  });
  it("uses a native date control and real date bounds", () => {
    const html = renderToStaticMarkup(createElement(DateField, { label: "Observation date", value: "2000-01-07", onChange, min: "2000-01-01", max: "2000-01-08" }));
    expect(html).toContain('type="date"');
    expect(html).toContain('min="2000-01-01"');
    expect(html).toContain('max="2000-01-08"');
    expect(html).toContain("Optional");
  });
  it("gets requirement text from the active language context", () => {
    const html = renderToStaticMarkup(createElement(FieldLabelsContext.Provider, { value: { required: "આવશ્યક", optional: "વૈકલ્પિક" } }, createElement(TextField, { label: "ગામ", value: "", onChange, required: false })));
    expect(html).toContain("વૈકલ્પિક");
    expect(html).not.toContain("Optional");
  });
});
