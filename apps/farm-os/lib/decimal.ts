// Exact decimal values for PostgreSQL `numeric` accounting amounts — parsed, summed and rendered in
// DECIMAL-STRING space, never through JavaScript floating point.
//
// WHY THIS EXISTS. `numeric` is an arbitrary-precision decimal type; a JS number is a binary double,
// which cannot represent 0.1 exactly. Adding two hundred two-decimal amounts as doubles drifts
// (0.1 + 0.2 === 0.30000000000000004), and the drift lands in a total an accountant SIGNS and in the
// CSV annex attached to that signature. Every sum here is accumulated as a scaled BigInt — an exact
// integer type — so a total is exact for any batch size, and every exported amount keeps the exact
// canonical digits rather than a re-formatted float. CSV bytes preserve those digits; spreadsheet
// applications may still apply their own numeric precision when opening the file.
//
// TRUTHFULNESS (CLAUDE.md #1). A value that is missing, empty, or not a readable decimal is `null`
// — "unknown". It is never 0, never rounded into existence, and never dropped silently: the summary
// carries `unknownCount` so the caller must state it.
//
// SCOPE. `lib/money.ts` stays the general (double-based) display formatter for ordinary pages; this
// module is for the values that get signed. It is pure — no DB, no React, no I/O.

export type DecimalString = string;

/** A sum plus the honest bookkeeping around it: what was counted, and what could not be read. */
export interface DecimalSummary {
  /** Canonical decimal string. "0" when nothing readable was summed — read it with `knownCount`. */
  total: DecimalString;
  /** How many input values parsed as a decimal and are therefore inside `total`. */
  knownCount: number;
  /** How many input values were missing/unreadable. These are NOT in `total` and are never 0. */
  unknownCount: number;
  hasUnknown: boolean;
}

/**
 * Bounds. PostgreSQL allows up to 16383 digits after the point; nothing in this system records more
 * than a handful, so a value beyond these bounds is a corrupt or hostile value, not an amount. It is
 * reported as unknown (never silently truncated to something that looks like money).
 */
const MAX_SCALE = 100;
const MAX_INTEGER_DIGITS = 1000;

const PLAIN_DECIMAL_RE = /^([+-]?)(\d+)(?:\.(\d*))?$/;
const EXPONENT_DECIMAL_RE = /^([+-]?)(\d+)(?:\.(\d*))?[eE]([+-]?\d+)$/;

/** Canonical form: no sign on zero, no leading zeros, no trailing fraction zeros, no bare point. */
function canonical(sign: string, integerDigits: string, fractionDigits: string): DecimalString | null {
  const integer = integerDigits.replace(/^0+(?=\d)/, "");
  const fraction = fractionDigits.replace(/0+$/, "");
  if (integer.length > MAX_INTEGER_DIGITS || fraction.length > MAX_SCALE) return null;
  const magnitude = fraction ? `${integer}.${fraction}` : integer;
  return sign === "-" && magnitude !== "0" ? `-${magnitude}` : magnitude;
}

/** Expand `1.5e-7` / `1e21` into plain digits. Only the EXPONENT goes through an integer parse. */
function expand(
  sign: string,
  integerDigits: string,
  fractionDigits: string,
  exponentText: string,
): DecimalString | null {
  const exponent = Number.parseInt(exponentText, 10);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > MAX_INTEGER_DIGITS + MAX_SCALE) {
    return null;
  }
  if (exponent >= 0) {
    return exponent >= fractionDigits.length
      ? canonical(sign, integerDigits + fractionDigits + "0".repeat(exponent - fractionDigits.length), "")
      : canonical(
          sign,
          integerDigits + fractionDigits.slice(0, exponent),
          fractionDigits.slice(exponent),
        );
  }
  const shift = -exponent;
  return shift >= integerDigits.length
    ? canonical(sign, "0", "0".repeat(shift - integerDigits.length) + integerDigits + fractionDigits)
    : canonical(
        sign,
        integerDigits.slice(0, integerDigits.length - shift),
        integerDigits.slice(integerDigits.length - shift) + fractionDigits,
      );
}

/**
 * Parse one recorded amount into a canonical decimal string, or `null` when it is not one.
 *
 * A string (what PostgREST returns for a `numeric` when it is serialised as text) is read DIGIT BY
 * DIGIT — it never passes through `Number`, so no precision is lost however long it is.
 *
 * A number is accepted too, because PostgREST may serialise `numeric` as a JSON number, in which case
 * the JSON parser already produced a double before this module ever sees the value. `String(n)` is
 * that double's shortest round-tripping decimal form — the most exact reading of it that exists — and
 * from there on the value stays in decimal space, so nothing drifts further while summing.
 */
export function parseDecimal(value: unknown): DecimalString | null {
  let text: string;
  if (typeof value === "string") text = value.trim();
  else if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    text = String(value);
  } else if (typeof value === "bigint") text = value.toString();
  else return null;
  if (text === "") return null;

  const plain = PLAIN_DECIMAL_RE.exec(text);
  if (plain) return canonical(plain[1], plain[2], plain[3] ?? "");
  const scientific = EXPONENT_DECIMAL_RE.exec(text);
  if (scientific) return expand(scientific[1], scientific[2], scientific[3] ?? "", scientific[4]);
  return null;
}

/** True when `value` is already a canonical decimal string produced by `parseDecimal`. */
export function isDecimalString(value: unknown): value is DecimalString {
  return typeof value === "string" && parseDecimal(value) === value;
}

/**
 * True when `value` is TEXT this module can read exactly — the grammar and the scale/magnitude bounds
 * above, nothing else. This is the gate a reader uses on a `numeric` field that arrived as text: a
 * value outside it is not a smaller number, it is an unreadable one, and an acceptance report must
 * refuse it rather than print a figure derived from a guess.
 */
export function isDecimalText(value: unknown): value is DecimalString {
  return typeof value === "string" && parseDecimal(value) !== null;
}

/** value = units / 10^scale, exactly. */
interface DecimalParts {
  units: bigint;
  scale: number;
}

function toParts(decimal: DecimalString): DecimalParts {
  const point = decimal.indexOf(".");
  if (point < 0) return { units: BigInt(decimal), scale: 0 };
  const fraction = decimal.slice(point + 1);
  return { units: BigInt(decimal.slice(0, point) + fraction), scale: fraction.length };
}

/** Rescale by appending zero digits to the integer text — exact, and no exponent arithmetic. */
function rescale(units: bigint, from: number, to: number): bigint {
  return from === to ? units : BigInt(units.toString() + "0".repeat(to - from));
}

function partsToDecimal({ units, scale }: DecimalParts): DecimalString {
  const negative = units < BigInt(0);
  const digits = (negative ? -units : units).toString().padStart(scale + 1, "0");
  const integer = digits.slice(0, digits.length - scale);
  const fraction = scale > 0 ? digits.slice(digits.length - scale) : "";
  return canonical(negative ? "-" : "", integer, fraction) ?? "0";
}

/**
 * Sum recorded amounts exactly. Unreadable values are counted, never added and never treated as 0 —
 * so `total` is always "the sum of what was actually recorded", and `unknownCount` is the rest.
 */
export function sumDecimals(values: unknown[]): DecimalSummary {
  let units = BigInt(0);
  let scale = 0;
  let knownCount = 0;
  let unknownCount = 0;

  for (const value of values) {
    const decimal = parseDecimal(value);
    if (decimal === null) {
      unknownCount += 1;
      continue;
    }
    knownCount += 1;
    const parts = toParts(decimal);
    const merged = Math.max(scale, parts.scale);
    units = rescale(units, scale, merged) + rescale(parts.units, parts.scale, merged);
    scale = merged;
  }

  return {
    total: partsToDecimal({ units, scale }),
    knownCount,
    unknownCount,
    hasUnknown: unknownCount > 0,
  };
}

// ── Rendering. Arabic-Indic digits, EGP, EXACTLY two decimals (a signed accounting figure shows its
//    piastres; the 0-decimal `egp()` in lib/money.ts is for ordinary dashboards, not for this).
//
//    The value never becomes a double on the way to the screen either: it is rounded to two places in
//    integer space, then the integer part is grouped by Intl as a BigInt and the two fraction digits
//    are mapped to Arabic-Indic digits directly. So a 20-digit amount renders every digit it has.

const AR_FMT = new Intl.NumberFormat("ar-EG");
const AR_PARTS = AR_FMT.formatToParts(-1);
const AR_MINUS = AR_PARTS.find((part) => part.type === "minusSign")?.value ?? "-";
const AR_DECIMAL_SEPARATOR =
  new Intl.NumberFormat("ar-EG", { minimumFractionDigits: 1 })
    .formatToParts(0)
    .find((part) => part.type === "decimal")?.value ?? "٫";
const AR_DIGITS = Array.from({ length: 10 }, (_, digit) => AR_FMT.format(digit));

function toArabicDigits(digits: string): string {
  return digits.replace(/\d/g, (digit) => AR_DIGITS[digit.charCodeAt(0) - 48]);
}

/** Round to `scale` places, half away from zero, entirely in integer space (no float rounding). */
export function roundDecimal(value: DecimalString, scale: number): DecimalString {
  if (!Number.isInteger(scale) || scale < 0 || scale > MAX_SCALE) {
    throw new RangeError(`decimal scale must be an integer between 0 and ${MAX_SCALE}`);
  }
  const parts = toParts(value);
  if (parts.scale <= scale) {
    return partsToDecimal({ units: rescale(parts.units, parts.scale, scale), scale });
  }
  const divisor = BigInt("1" + "0".repeat(parts.scale - scale));
  const negative = parts.units < BigInt(0);
  const magnitude = negative ? -parts.units : parts.units;
  const quotient = magnitude / divisor;
  const carry = (magnitude % divisor) * BigInt(2) >= divisor ? BigInt(1) : BigInt(0);
  const rounded = quotient + carry;
  return partsToDecimal({ units: negative ? -rounded : rounded, scale });
}

/** Arabic-Indic, grouped, with EXACTLY `scale` fraction digits (trailing zeros kept, e.g. ١٢٫٥٠). */
export function formatDecimalArabic(value: DecimalString, scale: number): string {
  const rounded = roundDecimal(value, scale);
  const negative = rounded.startsWith("-");
  const [integer, fraction = ""] = (negative ? rounded.slice(1) : rounded).split(".");
  const grouped = AR_FMT.format(BigInt(integer));
  const body =
    scale > 0
      ? `${grouped}${AR_DECIMAL_SEPARATOR}${toArabicDigits(fraction.padEnd(scale, "0"))}`
      : grouped;
  return negative ? `${AR_MINUS}${body}` : body;
}

export function egpExact(value: DecimalString | null | undefined): string {
  if (value == null) return "—";
  return `${formatDecimalArabic(value, 2)} ج.م`;
}

/** The summary line: the exact total, and — only when there is one — the unreadable remainder. */
export function egpDecimalSummary(summary: DecimalSummary): string {
  return summary.hasUnknown ? `${egpExact(summary.total)} + غير معروف` : egpExact(summary.total);
}
