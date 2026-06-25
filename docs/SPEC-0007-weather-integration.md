# SPEC-0007 — Weather integration: forecast ingest + operation gating (Stage 9)

*Status: **DRAFT for Owner review** — design + decision-support only. No code/integration/key. Stage 9
is **Medium risk** — an external API is *untrusted content + a secret key* (injection + secret
surface). Mirrors SPEC-0001..0006.*

*Companion to [`MASTER-PLAN.md`](MASTER-PLAN.md) §4 Stage 9 + §6 risks #3/#8, [`CLAUDE.md`](CLAUDE.md)
(Security · untrusted input · lethal trifecta).*

---

## 1. Value & the risk

Weather turns the plan from a calendar into a **condition-gated** schedule: don't spray in wind,
don't pollinate in rain, flag heat stress, time the harvest. The risk is twofold: the forecast feed
is **untrusted external content** (could carry injected instructions / malformed data), and it needs
an **API key** (a secret + a spend surface).

## 2. Non-negotiable controls (enforced, not prompted)

1. **Key server-side only** — never in the client bundle; Vercel/Supabase secret; the browser calls
   *our* endpoint, never the weather provider. (secret-scan gate.)
2. **API responses are untrusted data** — parsed against a strict schema, range-checked, stored as
   structured fields; any text is data, never instructions. A malformed/oversized/garbage response is
   rejected, not trusted. No response value is ever `eval`'d or fed to a model with capability.
3. **No trifecta** — the ingest path has **no outbound-send and no write to sensitive data**; it only
   writes the `weather_forecast` rows. It must not share a context with the AI's untrusted-ingest or
   any send capability (ties to SPEC-0005 §2.4).
4. **Graceful degradation** — a feed outage/parse-failure must not break planning: the weather gate
   becomes "unknown/advisory", never a hard blocker that wedges operations on a 3rd-party outage.

## 3. Scope

**Allowed:** a server-side ingest job (cron/route) → strict-parse the forecast → `weather_forecast`
(org/location/date → temp/wind/rain/humidity); **weather rules** (e.g. wind > X ⇒ spray = blocked;
rain ⇒ pollinate = blocked; heat > Y ⇒ stress flag) as **editable thresholds**, not hardcoded;
**operation gating** surfaced on the plan/execute views (advisory by default — see §2.4). RLS: forecast
is org-scoped read; thresholds owner/farm_manager-writable via `authorize('plan.write')`.

**Forbidden:** key in the client; trusting raw API text; a hard block that can't be overridden by a
responsible role (weather is advisory, the human decides); coupling ingest with outbound/AI capability;
fabricating forecast data when the feed is down (mark unknown).

## 4. Acceptance (the oracle)

1. **Untrusted-input safety:** a malformed/oversized/injected forecast payload is rejected by the
   schema/range check (test with crafted payloads) — no crash, no stored garbage, no instruction
   execution.
2. **Secret hygiene:** the key is server-only (secret-scan); the client never contacts the provider.
3. **Gating correctness:** for a given forecast + thresholds, the spray/pollinate/harvest/heat gates
   compute as specified (deterministic fixture test); a feed outage ⇒ gate = "unknown/advisory", plan
   still usable.
4. **No trifecta:** the ingest path has no send/AI/sensitive-write capability (verified by enumeration).

## 5. Open decisions for the Owner

1. **Provider** (OpenWeather / Tomorrow.io / a MENA-regional source) + cost tier + the location
   granularity (farm vs sector).
2. **Threshold defaults** — the wind/rain/heat cut-offs are **agronomic** values; per non-negotiable
   #4 they're editable templates and ideally cross-checked with the agronomist (overlaps Stage 10).
3. **Advisory vs hard-gate** — recommend **advisory** for MVP (surface the warning; let the role
   proceed), hard-gate only if the Owner wants enforced safety stops.

## 6. Enforcement, evidence, slices

- **Enforcement:** server-only key; strict schema/range validation as the trust boundary; ingest with
  no outbound/sensitive-write; RLS on forecast + thresholds.
- **Evidence:** the crafted-payload rejection test, the gating fixture test, the outage-degradation
  test, secret-scan. **Gate:** Owner.
- **Slices:** (1) `weather_forecast` schema + the strict-parse ingest (no UI) + untrusted-payload
  tests; (2) editable thresholds + the gate computation; (3) surface gates on plan/execute (advisory).
  Each stops at its gate; **do not auto-advance**.

Shares the untrusted-input discipline with SPEC-0005 (the AI); threshold values overlap SPEC-0008
(Care Academy / agronomist sign-off).
