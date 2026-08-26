"use client";

import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";
import { track } from "@vercel/analytics";
import type { Lang } from "@/lib/site-content";
import { SITE_PATH } from "@/lib/site-seo";

type PublicSiteAction =
  | "certificate_opened"
  | "contact_email"
  | "contact_location"
  | "contact_phone"
  | "contact_whatsapp"
  | "enquiry_submitted";
type ContactAction = Exclude<PublicSiteAction, "certificate_opened">;

// Analytics covers the PUBLIC site only — both language routes (`/` and `/en`), never the
// auth-gated app. Sourced from SITE_PATH so adding a public route can't silently go untracked
// (and an app route can't silently become tracked).
const PUBLIC_SITE_PATHS = new Set<string>(Object.values(SITE_PATH));

export function keepPublicSiteOnly(event: BeforeSendEvent): BeforeSendEvent | null {
  try {
    const url = new URL(event.url, window.location.origin);
    if (url.origin !== window.location.origin || !PUBLIC_SITE_PATHS.has(url.pathname)) return null;

    // Campaign links may contain personal or commercially sensitive query values.
    url.search = "";
    url.hash = "";
    return { ...event, url: url.toString() };
  } catch {
    return null;
  }
}

export function trackPublicSiteAction(action: "certificate_opened", language: Lang, properties: { certificate: number }): void;
export function trackPublicSiteAction(action: ContactAction, language: Lang): void;
export function trackPublicSiteAction(
  action: PublicSiteAction,
  language: Lang,
  properties?: { certificate: number },
): void {
  const payload = action === "certificate_opened"
    ? { language, certificate: properties?.certificate ?? 0 }
    : { language };
  track(action, payload);
}

export function PublicSiteAnalytics() {
  return <Analytics beforeSend={keepPublicSiteOnly} />;
}
