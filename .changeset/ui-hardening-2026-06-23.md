---
"@amrebeid/ui": minor
---

White-label brand robustness, URL/XSS hardening, and non-finite guards (from the 2026-06-23 review).

- Fix: a malformed tenant `brand` no longer crashes the subtree — `ThemeProvider` falls back to the default theme.
- Add/Fix: `ThemeProvider` exposes the resolved brand vars via `useTheme().brandStyle`, and `Modal`/`Drawer`/`Toaster` spread them onto their `document.body` portal roots so the white-label brand reaches portalled content.
- Fix: `Breadcrumbs`/`NavItem` `href` and `Avatar` `src` are scheme-sanitized (`javascript:`/`data:text/html` neutralized via `safeHref`/`safeImgSrc`); `Avatar` falls back to initials on image load error.
- Fix: the toast auto-dismiss timer no longer restarts every live toast when another toast is added/removed.
- Fix: `Pagination` no longer crashes on a non-finite `pageCount`; `Progress` guards a non-finite `value`.
