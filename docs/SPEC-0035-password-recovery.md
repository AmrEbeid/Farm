# SPEC-0035 — Password Recovery

Status: Implemented candidate, pending production configuration and live verification  
Owner: Amr Ebeid  
Surfaces: `/login`, `/forgot-password`, `/reset-password`, `/auth/reset-password`

## Purpose and page help

- **What:** a Farm-owned flow for requesting and completing a password reset.
- **Why:** users must not be sent to a protected Vercel deployment or need a Vercel account to recover Farm access.
- **When:** use it when a registered user forgets their Farm password or an existing reset link has expired.
- **How:** request a link, open the email, choose and confirm a new password, then sign in again.
- **Common mistakes:** do not reuse an old link, forward a recovery email, share a password, or enter credentials on a domain other than `ebeidfarm.business`.

## Roles and permissions

- The request page is anonymous and accepts an email address.
- The response is deliberately identical whether or not that address belongs to an account.
- Opening the email displays a same-origin form but does not consume the token, protecting links from email prefetch scanners.
- The token is carried in a URL fragment, which browsers do not send in requests or referrers, and is removed from the address bar immediately. The page is `no-store` and `no-referrer`.
- The password endpoint accepts only a Supabase `recovery` token hash and changes the password only in the same request that verifies it.
- A normal signed-in session cannot bypass the one-time recovery token.
- Recovery pages do not query or require Farm organization membership. The user's existing Farm role and membership are unchanged.
- The user chooses and submits the final password. Administrators and application logs never receive it.

## Password and session contract

- New passwords must contain at least 12 characters and both entries must match.
- Raw Supabase errors are not shown in the Arabic UI.
- After a successful update, refresh-token sessions on all devices are revoked and the user signs in normally. If revocation fails after the password changes, the UI states that partial result and tells the user to alert the Owner.
- No service-role credential, database migration, organization write, role change, or business-data change is part of this flow.

## Production configuration

1. Deploy these routes before changing email links.
2. Set the Supabase Auth Site URL to `https://ebeidfarm.business`.
3. Allow `https://ebeidfarm.business/**` as an Auth redirect URL.
4. Point the recovery email to
   `{{ .SiteURL }}/reset-password#token_hash={{ .TokenHash }}&type=recovery`.
5. Send a new recovery email. Previously sent links retain their old destination.

## Verification

- Tests pin account-enumeration resistance, recovery-only OTP verification at explicit form submission, password update ordering, global sign-out including its partial-failure state, failure handling, and middleware independence from organization membership. An installed-library SSR contract test proves the verified access token authorizes `updateUser` and that global sign-out clears the recovery cookies.
- Run full Vitest, TypeScript, ESLint, production build, dependency audit, and independent security review.
- In production, verify the anonymous pages and domain routing. Sending a real recovery email and setting the final password remain user actions.

## Abuse-control follow-up

Supabase's built-in Auth rate limits remain active. CAPTCHA is recommended as a separate defense-in-depth release,
but it requires an Owner-controlled hCaptcha or Cloudflare Turnstile site and secret, Supabase Auth enforcement,
and compatible tokens on every affected Auth form. Do not enable it in the dashboard before those forms are
deployed together, or legitimate login and recovery requests will fail.

## Changelog

- 2026-08-26: Added the complete Arabic Farm-owned password recovery candidate and production configuration contract.
