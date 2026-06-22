import * as React from "react";

export interface ChartTokens {
  /** Primary series / accent color (resolved --brand). */
  brand: string;
  /** Foreground text color for labels/legends (resolved --ink). */
  ink: string;
  /** Muted text color for axis ticks (resolved --ink-muted). */
  inkMuted: string;
  /** Grid / axis line color (resolved --line). */
  line: string;
  /** Chart surface background (resolved --surface). */
  surface: string;
  /** Categorical palette derived from role + status tokens. */
  palette: string[];
  /** Ambient writing direction of the chart scope. */
  dir: "rtl" | "ltr";
}

const EMPTY: ChartTokens = {
  brand: "", ink: "", inkMuted: "", line: "", surface: "", palette: [], dir: "ltr",
};

/** Read one custom property off a resolved style declaration. */
function readVar(cs: CSSStyleDeclaration, name: string): string {
  return cs.getPropertyValue(name).trim();
}

/** Resolve the chart's theme tokens from the scope element `ref` points at. */
function resolve(el: HTMLElement | null): ChartTokens {
  if (!el || typeof window === "undefined") return EMPTY;
  const cs = window.getComputedStyle(el);
  const brand = readVar(cs, "--brand");
  // Categorical palette: brand first, then status/accent hues, all theme-derived.
  const palette = [
    brand,
    readVar(cs, "--info-fg"),
    readVar(cs, "--warning-fg"),
    readVar(cs, "--danger-fg"),
    readVar(cs, "--success-fg"),
    readVar(cs, "--accent-fg"),
  ].filter((c) => c.length > 0);
  const dirAttr = (el.closest("[dir]") as HTMLElement | null)?.getAttribute("dir");
  const dir: "rtl" | "ltr" = dirAttr === "rtl" ? "rtl" : "ltr";
  return {
    brand,
    ink: readVar(cs, "--ink"),
    inkMuted: readVar(cs, "--ink-muted"),
    line: readVar(cs, "--line"),
    surface: readVar(cs, "--surface"),
    palette,
    dir,
  };
}

/**
 * Resolve theme-derived chart colors off `ref`'s element via getComputedStyle.
 * Re-reads when the nearest `.fos` scope's theme attributes change, so charts
 * recolor instantly when the consumer flips scheme/density/radius/brand.
 */
export function useChartTokens(ref: React.RefObject<HTMLElement>): ChartTokens {
  const [tokens, setTokens] = React.useState<ChartTokens>(EMPTY);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setTokens(resolve(el));
    update();

    // Observe the theme scope so a theme flip re-resolves the tokens.
    const scope = (el.closest(".fos") as HTMLElement | null) ?? document.documentElement;
    const mo = new MutationObserver(update);
    mo.observe(scope, {
      attributes: true,
      attributeFilter: ["data-theme", "data-density", "data-radius", "style", "dir"],
    });
    return () => mo.disconnect();
  }, [ref]);

  return tokens;
}
