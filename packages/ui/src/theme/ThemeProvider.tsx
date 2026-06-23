import * as React from "react";
import { brandVars } from "./brand";

export type ThemeScheme = "light" | "dark";
export type Density = "comfortable" | "compact";
export type Radius = "sharp" | "default" | "rounded";

export interface ThemeContextValue {
  scheme: ThemeScheme; density: Density; radius: Radius; brand?: string;
  /** Resolved brand CSS variables ({} when unset/invalid). Spread onto portal roots
   *  (Modal/Drawer/Toaster) so the white-label brand reaches content rendered outside
   *  the provider's subtree. */
  brandStyle: React.CSSProperties;
}
const ThemeContext = React.createContext<ThemeContextValue>({ scheme: "light", density: "comfortable", radius: "default", brandStyle: {} });
export const useTheme = () => React.useContext(ThemeContext);

export interface ThemeProviderProps {
  scheme?: ThemeScheme; density?: Density; radius?: Radius; brand?: string;
  className?: string; children: React.ReactNode;
}

export function ThemeProvider({
  scheme = "light", density = "comfortable", radius = "default", brand, className = "", children,
}: ThemeProviderProps) {
  // A brand value is tenant-supplied (DB/API/config); a malformed one must NOT crash the
  // tree. brandVars throws on non-6-digit-hex, so fall back to the default theme on error.
  const style = React.useMemo<React.CSSProperties>(() => {
    if (!brand) return {};
    try {
      return brandVars(brand) as React.CSSProperties;
    } catch {
      return {};
    }
  }, [brand]);
  const value = React.useMemo(
    () => ({ scheme, density, radius, brand, brandStyle: style }),
    [scheme, density, radius, brand, style],
  );
  return (
    <ThemeContext.Provider value={value}>
      <div className={`fos ${className}`.trim()} data-theme={scheme} data-density={density} data-radius={radius} style={style}>
        {children}
      </div>
    </ThemeContext.Provider>
  );
}
