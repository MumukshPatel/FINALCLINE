import Decimal from "decimal.js";

// Isolated configuration avoids binary floating-point boundary errors (e.g. 3 * 0.1).
const Arithmetic = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export function decimal(value: number): Decimal { return new Arithmetic(value); }
