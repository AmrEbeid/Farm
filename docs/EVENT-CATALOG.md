# Event Catalog — Farm OS

*Phase 2 of the Product Knowledge System ([`SPEC-0015`](SPEC-0015-product-knowledge-system.md)). The `farm_event`
model is the operational spine — every operation/observation is an event that rolls up palm→line→hawsha→sector→farm.
Reconciled to `main` 2026-06-27 (`0004` schema, `0083` RPCs, `lib/labels.ts`, `RecordActivity.tsx`). Maturity **L3**.
Feature: FEAT-011 (events) / FEAT-012 (execution). Table: TBL-014..020.*

## Event types (verified `fn_record_event` `0083` + `RecordActivity.tsx`)
| Type | Arabic | Meaning | Typical source |
|---|---|---|---|
| `operation` | عملية | A field operation (often from a plan) | `fn_execute_operation` (RPC-017) or ad-hoc `fn_record_event` (RPC-018) |
| `inspection` | تفتيش | A scouting/inspection record | `fn_record_event` |
| `issue` | ملاحظة/مشكلة | A problem/observation | `fn_record_event` |
| `note` | مذكرة | A free note | `fn_record_event` |

Rule: type ∈ {operation, inspection, issue, note} (**BR-104**).

## Operation subtypes (verified `lib/labels.ts SUBTYPE_AR`)
| Subtype | Arabic | Notes |
|---|---|---|
| `fertilization` | تسميد | consumes inventory (material requirement) |
| `irrigation` | ري | weather-gated (advisory) |
| `spraying` | رش | weather-gated; agronomy template (BR-113) |
| `pollination` | تلقيح | seasonal |
| `inspection` | تفتيش | also a standalone type |

## Event status (verified `lib/labels.ts OP_STATUS_AR`)
`planned/مخطط → reserved/محجوز → ready/جاهز → in_progress/قيد التنفيذ → done/منفذ`; plus `approved/معتمد`,
`blocked/محظور`, `abandoned/ملغاة`, `skipped/متخطّاة`. Execution only from an **active** status; a `done` event is
not re-executable (**BR-031/032**). Transitions via `fn_set_event_status` (RPC-019), logged to `event_status_history`.

## Anatomy of an event (tables written)
| Component | Table | Written by |
|---|---|---|
| The event row (type/subtype/status/when/plan) | `farm_event` (partitioned) | RPC-017/018 |
| Ancestor chain (farm/sector/hawsha/line) — roll-up | `event_locations` | RPC-018 |
| Affected palm(s) | `event_assets` | RPC-018 |
| Measurements (count/weight/volume/currency; inventory adjustment) | `quantities` | RPC-017/018 |
| Status transitions | `event_status_history` | RPC-019 |
| Follow-up tasks | `event_followups` | RPC-020 |
| Photos/docs | `event_attachments` / `attachments` | RPC-027 |

## Two ways an event is created
1. **Planned → executed (FEAT-012):** a `plan_operation` is executed via `fn_execute_operation` (RPC-017) — atomic,
   claim-first: flips the op to `done`, writes the `farm_event` (+ locations + quantities), posts the `issue` stock
   movement (material consumption) and `release` of the reservation, and computes `actual_cost = actual_qty ×
   unit_rate`. Feeds the **planned-vs-actual** report (`/reports/[planId]/pva`).
2. **Ad-hoc (FEAT-011):** `fn_record_event` (RPC-018) records an event against any node (farm/sector/hawsha/line/
   palm); it derives the full ancestor chain (a palm event sets sector_id + farm_id) so it rolls up into every 360
   page. Used by `RecordActivity.tsx`.

## Validation & guards
- type/subtype/status/location-type validated in the RPC; assignee + location must be in the caller's org (cross-org
  rejected); `op.execute` permission required (**BR-030/034**).
- Inventory effect: an operation's material consumption posts through the ledger (BR-010/014) — never a direct write.

## Inventory ↔ event linkage
`quantities.material_id` + `inventory_adjustment` (negative = consumption) tie an event to stock; execution posts the
matching `inventory_movements` (`issue`/`release`) so on-hand and the coverage engine (FEAT-007) stay consistent.

Maintenance: a new subtype/status → add to `lib/labels.ts` first, then here. A new event type → update BR-104 + the
`fn_record_event` check together.
