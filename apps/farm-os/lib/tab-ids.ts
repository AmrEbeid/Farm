/**
 * Server-safe mirrors of the DS Tabs id helpers.
 *
 * `@amrebeid/ui`'s `tabId`/`tabPanelId` are exported from its `"use client"` Tabs
 * module, so they are client functions — a React Server Component cannot call
 * them (Next throws "Attempted to call tabPanelId() from the server"). The 360
 * pages render their tab panels server-side and need these ids, so we mirror the
 * pure string helpers here in a server-safe module.
 *
 * These MUST stay byte-identical to the DS implementation so each server panel's
 * id matches the client Tabs button's `aria-controls`/`aria-labelledby`.
 */
export function tabId(id: string): string {
  return `fos-tab-${id}`;
}

export function tabPanelId(id: string): string {
  return `fos-tabpanel-${id}`;
}
