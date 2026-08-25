"use client";

import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";
import { track } from "@vercel/analytics";
import type { Lang } from "@/lib/site-content";

type PublicSiteAction =
  | "certificate_opened"
  | "contact_email"
  | "contact_phone"
  | "contact_whatsapp"
  | "enquiry_submitted";

export function keepPublicHomepageOnly(event: BeforeSendEvent): BeforeSendEvent | null {
  try {
    const url = new URL(event.url, window.location.origin);
    if (url.origin !== window.location.origin || url.pathname !== "/") return null;

    // Campaign links may contain personal or commercially sensitive query values.
    url.search = "";
    url.hash = "";
    return { ...event, url: url.toString() };
  } catch {
    return null;
  }
}

export function trackPublicSiteAction(
  action: PublicSiteAction,
  language: Lang,
  properties?: Record<string, string | number | boolean>,
) {
  track(action, { language, ...properties });
}

export function PublicSiteAnalytics() {
  return <Analytics beforeSend={keepPublicHomepageOnly} />;
}
