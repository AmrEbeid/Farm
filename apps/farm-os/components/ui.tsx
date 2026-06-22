"use client";

// Client-boundary re-export of @amrebeid/ui. The library's components rely on
// React context (createContext), which React Server Components do not provide,
// so the library must only ever be imported across a "use client" boundary.
// App code imports UI components from here, never from "@amrebeid/ui" directly
// in a Server Component.
export {
  ThemeProvider,
  AppShell,
  SidebarNav,
  Button,
  IconButton,
  Field,
  Input,
  KpiCard,
  StatusPill,
  Tag,
  Alert,
  Card,
  type NavItemData,
} from "@amrebeid/ui";
