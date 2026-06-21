import * as React from "react";
import { brandVars } from "./brand";

export type ThemeScheme = "light" | "dark";
export type Density = "comfortable" | "compact";
export type Radius = "sharp" | "default" | "rounded";

export interface ThemeContextValue { scheme: ThemeScheme; density: Density; radius: Radius; brand?: string; }
const ThemeContext = React.createContext<ThemeContextValue>({ scheme: "light", density: "comfortable", radius: "default" });
export const useTheme = () => React.useContext(ThemeContext);

export interface ThemeProviderProps {
  scheme?: ThemeScheme; density?: Density; radius?: Radius; brand?: string;
  className?: string; children: React.ReactNode;
}

export function ThemeProvider({
  scheme = "light", density = "comfortable", radius = "default", brand, className = "", children,
}: ThemeProviderProps) {
  const style = React.useMemo<React.CSSProperties>(
    () => (brand ? (brandVars(brand) as React.CSSProperties) : {}),
    [brand]
  );
  const value = React.useMemo(() => ({ scheme, density, radius, brand }), [scheme, density, radius, brand]);
  return (
    <ThemeContext.Provider value={value}>
      <div className={`fos ${className}`.trim()} data-theme={scheme} data-density={density} data-radius={radius} style={style}>
        {children}
      </div>
    </ThemeContext.Provider>
  );
}
