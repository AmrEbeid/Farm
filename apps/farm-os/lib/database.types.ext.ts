// STRUCT-1 type augmentation — DO edit this file (unlike database.types.ts).
//
// database.types.ts is generated from the prod schema and is periodically reconciled back to prod
// (hand-edits there are reverted). The editable farm-structure feature adds objects that are not yet
// in prod — the `archived` soft-delete column on the structure tables (migration 0051), the
// `attachments` table (0053), and the structure CRUD + media RPCs (0052/0053). Rather than edit the
// generated file, this module augments it: the Supabase clients import `Database` from HERE.
//
// When database.types.ts is next regenerated AFTER these migrations reach prod, these additions will
// appear in the generated file and this augmentation becomes a harmless no-op (the intersections just
// re-state what's already there). Keep the shapes in sync with migrations 0051–0053.

import type { Database as Generated, Json } from "./database.types";
import type { WeatherThresholds } from "./weather";

type Public = Generated["public"];
type Tables = Public["Tables"];

/** Add the soft-delete flag to an existing generated table entry, preserving its relationships. */
type WithArchived<
  T extends {
    Row: object;
    Insert: object;
    Update: object;
    Relationships: unknown;
  }
> = {
  Row: T["Row"] & { archived: boolean };
  Insert: T["Insert"] & { archived?: boolean };
  Update: T["Update"] & { archived?: boolean };
  Relationships: T["Relationships"];
};

/** Relative operation scheduling (2026-07-01, migration 20260701350000): add the optional
 *  "depends on another operation" columns to the generated plan_operations table entry. Both
 *  nullable — most operations leave them unset and behave exactly as before. */
type WithDependsOn<
  T extends {
    Row: object;
    Insert: object;
    Update: object;
    Relationships: unknown;
  }
> = {
  Row: T["Row"] & {
    depends_on_op_id: string | null;
    depends_on_offset_days: number | null;
  };
  Insert: T["Insert"] & {
    depends_on_op_id?: string | null;
    depends_on_offset_days?: number | null;
  };
  Update: T["Update"] & {
    depends_on_op_id?: string | null;
    depends_on_offset_days?: number | null;
  };
  Relationships: T["Relationships"];
};

/** Add the operation-vocabulary harvest_stage column (migration 20260701230000) to
 *  plan_operations, preserving its relationships. */
type WithHarvestStage<
  T extends {
    Row: object;
    Insert: object;
    Update: object;
    Relationships: unknown;
  }
> = {
  Row: T["Row"] & { harvest_stage: string | null };
  Insert: T["Insert"] & { harvest_stage?: string | null };
  Update: T["Update"] & { harvest_stage?: string | null };
  Relationships: T["Relationships"];
};

/** Add the soil-test-driven irrigation record-keeping columns (migration 20260701330000) to
 *  plan_operations, preserving its relationships. */
type WithIrrigationBasis<
  T extends {
    Row: object;
    Insert: object;
    Update: object;
    Relationships: unknown;
  }
> = {
  Row: T["Row"] & {
    irrigation_basis: string | null;
    soil_moisture_reading: string | null;
  };
  Insert: T["Insert"] & {
    irrigation_basis?: string | null;
    soil_moisture_reading?: string | null;
  };
  Update: T["Update"] & {
    irrigation_basis?: string | null;
    soil_moisture_reading?: string | null;
  };
  Relationships: T["Relationships"];
};

/** Add the wage-mode columns migration 20260729090000 put on `people_compensation` — ALREADY LIVE,
 *  just not yet in the generated types. `mode` is `not null default 'hourly'` (optional on Insert);
 *  `unit` is set iff mode='piece' (people_compensation_piece_shape); the two contract bounds are set
 *  iff mode='seasonal' (people_compensation_seasonal_shape). Nullable/optional everywhere else so an
 *  existing hourly row keeps EXACTLY its pre-migration meaning. */
type WithWageMode<
  T extends {
    Row: object;
    Insert: object;
    Update: object;
    Relationships: unknown;
  }
> = {
  Row: T["Row"] & {
    mode: string;
    unit: string | null;
    contract_period_start: string | null;
    contract_period_end: string | null;
  };
  Insert: T["Insert"] & {
    mode?: string;
    unit?: string | null;
    contract_period_start?: string | null;
    contract_period_end?: string | null;
  };
  Update: T["Update"] & {
    mode?: string;
    unit?: string | null;
    contract_period_start?: string | null;
    contract_period_end?: string | null;
  };
  Relationships: T["Relationships"];
};

/** Add the labor-cost-basis person_id FK (migration 20260701250000) to an existing table entry. */
type WithLaborPersonId<
  T extends {
    Row: object;
    Insert: object;
    Update: object;
    Relationships: unknown;
  }
> = {
  Row: T["Row"] & { person_id: string | null };
  Insert: T["Insert"] & { person_id?: string | null };
  Update: T["Update"] & { person_id?: string | null };
  Relationships: T["Relationships"];
};

/** Add the pesticide-application compliance fields (migration 20260701320000) to
 *  plan_material_requirements, preserving its relationships. */
type WithSprayCompliance<
  T extends {
    Row: object;
    Insert: object;
    Update: object;
    Relationships: unknown;
  }
> = {
  Row: T["Row"] & {
    target_pest: string | null;
    apc_registration_ref: string | null;
    rei_hours: number | null;
    phi_days: number | null;
    target_zone: string | null;
    applicator_person_id: string | null;
    wind_speed_kmh: number | null;
    wind_direction: string | null;
    air_temp_c: number | null;
  };
  Insert: T["Insert"] & {
    target_pest?: string | null;
    apc_registration_ref?: string | null;
    rei_hours?: number | null;
    phi_days?: number | null;
    target_zone?: string | null;
    applicator_person_id?: string | null;
    wind_speed_kmh?: number | null;
    wind_direction?: string | null;
    air_temp_c?: number | null;
  };
  Update: T["Update"] & {
    target_pest?: string | null;
    apc_registration_ref?: string | null;
    rei_hours?: number | null;
    phi_days?: number | null;
    target_zone?: string | null;
    applicator_person_id?: string | null;
    wind_speed_kmh?: number | null;
    wind_direction?: string | null;
    air_temp_c?: number | null;
  };
  Relationships: T["Relationships"];
};

/** Add plan_operations.note (migration 20260701340000 — individual-palm treatment free-text note). */
type WithOpNote<
  T extends {
    Row: object;
    Insert: object;
    Update: object;
    Relationships: unknown;
  }
> = {
  Row: T["Row"] & { note: string | null };
  Insert: T["Insert"] & { note?: string | null };
  Update: T["Update"] & { note?: string | null };
  Relationships: T["Relationships"];
};

/** Add the inclusive multi-day end date (migration 20260622000090). */
type WithOperationEnd<
  T extends {
    Row: object;
    Insert: object;
    Update: object;
    Relationships: unknown;
  }
> = {
  Row: T["Row"] & { ends_on: string | null };
  Insert: T["Insert"] & { ends_on?: string | null };
  Update: T["Update"] & { ends_on?: string | null };
  Relationships: T["Relationships"];
};

type AttachmentsTable = {
  Row: {
    id: string;
    org_id: string;
    entity_type: string;
    entity_id: string;
    storage_path: string;
    kind: string;
    caption: string | null;
    content_type: string | null;
    size_bytes: number | null;
    uploaded_by: string | null;
    created_at: string;
    archived: boolean;
  };
  Insert: {
    id?: string;
    org_id: string;
    entity_type: string;
    entity_id: string;
    storage_path: string;
    kind?: string;
    caption?: string | null;
    content_type?: string | null;
    size_bytes?: number | null;
    uploaded_by?: string | null;
    created_at?: string;
    archived?: boolean;
  };
  Update: {
    id?: string;
    org_id?: string;
    entity_type?: string;
    entity_id?: string;
    storage_path?: string;
    kind?: string;
    caption?: string | null;
    content_type?: string | null;
    size_bytes?: number | null;
    uploaded_by?: string | null;
    created_at?: string;
    archived?: boolean;
  };
  Relationships: [];
};

// ── STAGE 10 Care Academy content, migration 20260701400000 ──
type AcademyContentTable = {
  Row: {
    id: string;
    org_id: string;
    title: string;
    body: string;
    category: string;
    has_chemical: boolean;
    agronomist_name: string | null;
    signed_at: string | null;
    pesticide_reg_valid_until: string | null;
    pesticide_reg_number: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
    archived: boolean;
  };
  Insert: {
    id?: string;
    org_id: string;
    title: string;
    body?: string;
    category?: string;
    has_chemical?: boolean;
  };
  Update: {
    title?: string;
    body?: string;
    category?: string;
    has_chemical?: boolean;
    archived?: boolean;
  };
  Relationships: [];
};

type StructFunctions = {
  fn_record_stock_take: {
    // Gated stock-take (جرد) reconciliation — posts an adjustment/loss to reconcile on_hand to a physical
    // count (migration 20260705160000). Returns the reconciled on_hand (= p_counted_qty).
    Args: { p_item: string; p_counted_qty: number; p_location?: string };
    Returns: number;
  };
  fn_save_sector: {
    Args: {
      p_id: string | null;
      p_farm_id: string | null;
      p_name: string;
      p_code: string;
      p_crop?: string | null;
      p_area_feddan?: number | null;
      p_planting_date?: string | null;
      p_notes?: string | null;
    };
    Returns: Json;
  };
  fn_save_hawsha: {
    Args: {
      p_id: string | null;
      p_sector_id: string | null;
      p_name: string;
      p_code: string;
      p_area_qirat?: number | null;
      p_row_count?: number | null;
      p_palm_count_barhi?: number | null;
      p_palm_count_male?: number | null;
      p_planting_date?: string | null;
      p_notes?: string | null;
    };
    Returns: Json;
  };
  fn_save_line: {
    Args: {
      p_id: string | null;
      p_hawsha_id: string | null;
      p_line_no: number;
      p_line_code?: string | null;
      p_palm_count?: number | null;
      p_direction?: string | null;
      p_notes?: string | null;
    };
    Returns: Json;
  };
  fn_save_palm: {
    Args: {
      p_id: string | null;
      p_hawsha_id: string | null;
      p_line_id?: string | null;
      p_name?: string | null;
      p_variety?: string | null;
      p_sex?: string | null;
      p_id_tag?: string | null;
      p_planting_date?: string | null;
      p_health_status?: string | null;
    };
    Returns: Json;
  };
  fn_archive_structure: {
    Args: { p_type: string; p_id: string; p_archived?: boolean };
    Returns: Json;
  };
  fn_add_attachment: {
    Args: {
      p_entity_type: string;
      p_entity_id: string;
      p_storage_path: string;
      p_kind?: string;
      p_caption?: string | null;
      p_content_type?: string | null;
      p_size_bytes?: number | null;
    };
    Returns: Json;
  };
  fn_archive_attachment: {
    Args: { p_id: string; p_archived?: boolean };
    Returns: Json;
  };
  // ── STAGE 3 (SPEC-0010) ad-hoc event recording, migration 0054 ──
  fn_record_event: {
    Args: {
      p_location_type: string;
      p_location_id: string;
      p_type?: string;
      p_subtype?: string | null;
      p_status?: string;
      p_occurred_at?: string | null;
      p_note?: string | null;
      p_assigned_to?: string | null;
      p_qty_measure?: string | null;
      p_qty_value?: number | null;
      p_qty_label?: string | null;
    };
    Returns: Json;
  };
  fn_set_event_status: {
    Args: { p_event_id: string; p_status: string; p_note?: string | null };
    Returns: Json;
  };
  fn_add_event_followup: {
    Args: {
      p_event_id: string;
      p_note: string;
      p_due_at?: string | null;
      p_assigned_to?: string | null;
    };
    Returns: Json;
  };
  // ── STAGE 4 (SPEC-0011) plan builder, migration 0055 ──
  fn_create_plan: {
    Args: {
      p_type: string;
      p_period_start?: string | null;
      p_period_end?: string | null;
      p_scope_type?: string;
      p_scope_id?: string | null;
    };
    Returns: Json;
  };
  fn_set_plan_status: {
    Args: { p_plan_id: string; p_status: string };
    Returns: Json;
  };
  fn_assign_plan_operation: {
    Args: { p_op_id: string; p_person_id: string | null };
    Returns: Json;
  };
  fn_add_plan_labor: {
    Args: {
      p_plan_op_id: string;
      p_person_or_team: string;
      p_count?: number | null;
      p_days?: number | null;
    };
    Returns: Json;
  };
  // ── #398 slice 2: atomic multi-line operation create (multi-day + N materials + N labour +
  //    assignees), migrations 0090 (schema) / 0093 (RPC). p_materials/p_labor are jsonb line arrays.
  //    p_harvest_stage (optional, default null) added by the operation-vocabulary re-emit
  //    (migration 20260701240000) for the harvest ripening stage (خلال/رطب/تمر). Further extended by
  //    migration 20260701320000 with p_preferred_time_of_day, then by migration 20260701330000 with
  //    two trailing OPTIONAL params so an irrigation op can record whether it was soil-test-driven
  //    (and the reading that justified it). Finally extended by
  //    migration 20260701340000 with p_target_type/p_target_id/p_note (individual-palm treatments):
  //    when target_type/target_id are set (target_type='palm'), they override the plan-scope-derived
  //    target for this one operation; p_note is a free-text note persisted on plan_operations.note.
  //    Omitted → identical to the pre-existing behaviour. ──
  fn_add_plan_operation_multi: {
    Args: {
      p_plan_id: string;
      p_subtype: string;
      p_planned_at: string;
      p_ends_on: string | null;
      p_est_cost: number;
      p_materials: Json;
      p_labor: Json;
      p_assignee_ids: string[];
      p_lead_id: string | null;
      p_harvest_stage?: string | null;
      p_preferred_time_of_day?: string | null;
      p_irrigation_basis?: string | null;
      p_soil_moisture_reading?: string | null;
      p_target_type?: string | null;
      p_target_id?: string | null;
      p_note?: string | null;
    };
    Returns: Json;
  };
  // ── #398 follow-up: gated un-assign RPC for plan_operation_assignees, migration 20260701220000.
  //    Deletes the (plan_op_id, person_id) row; a person not actually assigned is a safe no-op
  //    (returns removed:false rather than raising). ──
  fn_unassign_plan_operation: {
    Args: { p_op_id: string; p_person_id: string };
    Returns: Json;
  };
  // ── individual-palm rescue treatments, migration 20260701340000: find-or-create the org's
  //    single implicit "individual treatments" plan (the parent container fn_add_plan_operation_multi
  //    still requires a plan_id for) so the palm-360 quick-treatment form needs no plan picker. ──
  fn_get_or_create_individual_treatment_plan: {
    Args: { p_org: string };
    Returns: string;
  };
  // ── STAGE 1 active-org switcher, migration 0085 ──
  fn_set_active_org: {
    Args: { p_org: string };
    Returns: undefined;
  };
  // ── STAGE 1 org settings, migration 0086 ──
  fn_update_org_settings: {
    Args: {
      p_org: string;
      p_name: string;
      p_locale?: string | null;
      p_currency?: string | null;
      p_area_unit?: string | null;
      p_fiscal_year_start?: string | null;
    };
    Returns: undefined;
  };
  // ── STAGE 10 Care Academy, migration 20260701400000 ──
  fn_save_academy_content: {
    Args: {
      p_id: string | null;
      p_org: string;
      p_title: string;
      p_body?: string;
      p_category?: string;
      p_has_chemical?: boolean;
    };
    Returns: Json;
  };
  fn_signoff_academy_content: {
    Args: {
      p_id: string;
      p_agronomist_name: string;
      p_signed_at?: string;
      p_pesticide_reg_valid_until?: string | null;
      p_pesticide_reg_number?: string | null;
    };
    Returns: Json;
  };
  fn_archive_academy_content: {
    Args: { p_id: string; p_archived?: boolean };
    Returns: Json;
  };
  // ── #520 multi-material execute: p_material_actuals jsonb, migration 20260701220000 ──
  // Array of {requirement_id, item_id, actual_qty} — one entry per plan_material_requirements row on
  // the op, matched server-side by requirement_id (= that row's own id), NOT item_id — an op can carry
  // two requirement rows for the SAME item_id (e.g. two applications of the same fertilizer on
  // different sub-dates), which item_id alone cannot distinguish. Overrides the generated (stale,
  // pre-#520) 4-arg Args once database.types.ts is regenerated; until then this augmentation supplies
  // the 5th param so the RPC call below type-checks.
  fn_execute_operation: {
    Args: {
      p_op_id: string;
      p_actual_qty: number;
      p_labor_count: number;
      p_note?: string | null;
      p_material_actuals?: Json;
    };
    Returns: Json;
  };
};

// ── SPEC-0018 «العهدة وطلبات الصرف» — custody + payment requests. ──
// Augmented here until database.types.ts is regenerated from prod (then a harmless no-op).
type ExpensePaymentStatus =
  | "paid_from_custody"
  | "post_paid_unpaid"
  | "paid_by_owner"
  | "historical_treasury"
  | "historical_reversed"
  | "cancelled";
type ExpenseKind = "operating" | "drawing" | "capex";
type PaymentRoutingColumn = "payment_status" | "paid_by" | "kind";
type ExpenseDimensionColumn = "account_id" | "cost_center_id";

type CustodyAccountsTable = {
  Row: {
    id: string;
    org_id: string;
    holder_label: string;
    holder_user_id: string | null;
    target_float: number;
    active: boolean;
    created_at: string;
    created_by: string | null;
  };
  Insert: Record<string, never>;
  Update: Record<string, never>;
  Relationships: [];
};
type CustodyMovementsTable = {
  Row: {
    id: string;
    org_id: string;
    custody_account_id: string;
    occurred_at: string;
    movement_type: string;
    amount_in: number;
    amount_out: number;
    expense_id: string | null;
    payment_request_id: string | null;
    journal_entry_id: string | null;
    transfer_group_id: string | null;
    reversal_of: string | null;
    reversal_reason: string | null;
    expense_reversal_outcome: "unrouted" | "cancelled" | null;
    reversed_by: string | null;
    reversed_at: string | null;
    note: string | null;
    created_at: string;
    created_by: string | null;
  };
  Insert: Record<string, never>;
  Update: Record<string, never>;
  Relationships: [
    {
      foreignKeyName: "custody_movements_custody_account_id_fkey";
      columns: ["custody_account_id"];
      isOneToOne: false;
      referencedRelation: "custody_accounts";
      referencedColumns: ["id"];
    }
  ];
};
type PaymentRequestsTable = {
  Row: {
    id: string;
    org_id: string;
    request_no: number;
    period_start: string | null;
    period_end: string | null;
    status: string;
    custody_account_id: string | null;
    note: string | null;
    prepared_by: string | null;
    approved_op_by: string | null;
    approved_final_by: string | null;
    submitted_at: string | null;
    approved_op_at: string | null;
    approved_final_at: string | null;
    approved_post_paid_total: number | null;
    approved_custody_top_up: number | null;
    approved_net_request: number | null;
    created_at: string;
  };
  Insert: Record<string, never>;
  Update: Record<string, never>;
  Relationships: [];
};
type PaymentRequestLinesTable = {
  Row: {
    id: string;
    org_id: string;
    payment_request_id: string;
    expense_id: string;
    paid_at: string | null;
    paid_by: string | null;
    paid_from_custody_account_id: string | null;
    custody_movement_id: string | null;
    journal_entry_id: string | null;
    created_at: string;
  };
  Insert: Record<string, never>;
  Update: Record<string, never>;
  Relationships: [];
};
type AccountsTable = {
  Row: {
    id: string;
    org_id: string;
    parent_id: string | null;
    code: string;
    name_ar: string;
    account_type: string;
    normal_balance: string;
    kind: ExpenseKind | null;
    is_system: boolean;
    sort_order: number | null;
    active: boolean;
    created_at: string;
    created_by: string | null;
  };
  Insert: Record<string, never>;
  Update: Record<string, never>;
  Relationships: [];
};
type CostCentersTable = {
  Row: {
    id: string;
    org_id: string;
    parent_id: string | null;
    code: string;
    name_ar: string;
    sector_id: string | null;
    enterprise: string | null;
    area_feddan: number | null;
    is_system: boolean;
    sort_order: number | null;
    active: boolean;
    created_at: string;
    created_by: string | null;
  };
  Insert: Record<string, never>;
  Update: Record<string, never>;
  Relationships: [];
};
type AccountRollupView = {
  Row: {
    org_id: string;
    account_id: string;
    parent_id: string | null;
    code: string;
    name_ar: string;
    account_type: string;
    normal_balance: string;
    kind: ExpenseKind | null;
    active: boolean;
    is_system: boolean;
    sort_order: number | null;
    debit: number;
    credit: number;
    balance: number;
  };
  Relationships: [];
};
type CostCenterRollupView = {
  Row: {
    org_id: string;
    cost_center_id: string;
    parent_id: string | null;
    code: string;
    name_ar: string;
    sector_id: string | null;
    enterprise: string | null;
    area_feddan: number | null;
    active: boolean;
    is_system: boolean;
    sort_order: number | null;
    debit: number;
    credit: number;
    net: number;
    net_per_feddan: number | null;
  };
  Relationships: [];
};
type CostCenterReconciliationFlagsView = {
  Row: {
    org_id: string;
    cost_center_id: string;
    code: string;
    name_ar: string;
    flag_code: string;
    message_ar: string;
  };
  Relationships: [];
};
type JournalEntriesTable = {
  Row: {
    id: string;
    org_id: string;
    entry_date: string;
    source_type: string;
    source_id: string;
    source_sequence: number;
    description: string | null;
    status: string;
    posted_at: string;
    posted_by: string | null;
    reversal_of: string | null;
    created_at: string;
  };
  Insert: Record<string, never>;
  Update: Record<string, never>;
  Relationships: [];
};
type JournalLinesTable = {
  Row: {
    id: string;
    org_id: string;
    journal_entry_id: string;
    account_id: string;
    debit: number;
    credit: number;
    description: string | null;
    custody_account_id: string | null;
    custody_movement_id: string | null;
    expense_id: string | null;
    payment_request_id: string | null;
    cost_center_id: string | null;
    created_at: string;
  };
  Insert: Record<string, never>;
  Update: Record<string, never>;
  Relationships: [];
};
type AccountingPeriodsTable = {
  Row: {
    id: string;
    org_id: string;
    period_start: string;
    period_end: string;
    status: string;
    note: string | null;
    locked_by: string | null;
    locked_at: string;
    reopened_by: string | null;
    reopened_at: string | null;
    created_at: string;
  };
  Insert: Record<string, never>;
  Update: Record<string, never>;
  Relationships: [];
};
type PaymentRequestFundingsTable = {
  Row: {
    id: string;
    org_id: string;
    payment_request_id: string;
    custody_account_id: string;
    custody_movement_id: string | null;
    journal_entry_id: string | null;
    occurred_at: string;
    amount: number;
    note: string | null;
    created_at: string;
    created_by: string | null;
  };
  Insert: Record<string, never>;
  Update: Record<string, never>;
  Relationships: [];
};
type BuyerType = "cash_customer" | "trader" | "company";
type SalePriceStatus = "pending" | "finalized";
type SalePaymentStatus =
  | "unpaid"
  | "partially_collected"
  | "collected"
  // reconciliation-created historical direct-treasury sales (migration 20260726160000):
  // cash-settled at posting (Dr 1010 / Cr typed revenue leaf), never collectible.
  | "historical_treasury"
  | "historical_reversed";
type BuyersTable = {
  Row: {
    id: string;
    org_id: string;
    name: string;
    buyer_type: BuyerType;
    phone: string | null;
    active: boolean;
    created_at: string;
    created_by: string | null;
  };
  Insert: Record<string, never>;
  Update: Record<string, never>;
  Relationships: [];
};
type SalesTable = {
  Row: {
    id: string;
    org_id: string;
    // SPEC-0027 H-A scale columns (migration 20260701530000)
    crates: number | null;
    gross_kg: number | null;
    tare_kg: number | null;
    delivery_note_no: number | null;
    sale_date: string | null;
    farm_id: string | null;
    sector_id: string | null;
    hawsha_id: string | null;
    crop: string;
    season: string | null;
    buyer_id: string | null;
    cost_center_id: string | null;
    qty: number | null;
    unit: string | null;
    unit_price: number | null;
    total: number | null;
    price_status: SalePriceStatus;
    delivery_date: string | null;
    price_finalized_at: string | null;
    payment_status: SalePaymentStatus;
    notes: string | null;
    created_at: string;
    created_by: string | null;
  };
  Insert: Record<string, never>;
  Update: Record<string, never>;
  Relationships: [
    {
      foreignKeyName: "sales_buyer_id_fkey";
      columns: ["buyer_id"];
      isOneToOne: false;
      referencedRelation: "buyers";
      referencedColumns: ["id"];
    }
  ];
};
type SaleCollectionsTable = {
  Row: {
    id: string;
    org_id: string;
    sale_id: string;
    amount: number;
    occurred_at: string;
    collected_by: string | null;
    note: string | null;
    journal_entry_id: string | null;
    created_at: string;
    created_by: string | null;
  };
  Insert: Record<string, never>;
  Update: Record<string, never>;
  Relationships: [];
};
/** Add the SPEC-0018 payment-routing columns to the generated expenses table. */
type WithPaymentStatus<
  T extends {
    Row: object;
    Insert: object;
    Update: object;
    Relationships: unknown;
  }
> = {
  Row: Omit<T["Row"], PaymentRoutingColumn | ExpenseDimensionColumn> & {
    payment_status: ExpensePaymentStatus | null;
    paid_by: string | null;
    kind: ExpenseKind;
    account_id: string | null;
    cost_center_id: string | null;
  };
  Insert: Omit<T["Insert"], PaymentRoutingColumn | ExpenseDimensionColumn> & {
    account_id?: string | null;
    cost_center_id?: string | null;
  };
  Update: Omit<T["Update"], PaymentRoutingColumn | ExpenseDimensionColumn> & {
    account_id?: string | null;
    cost_center_id?: string | null;
  };
  Relationships: T["Relationships"];
};
// ── SPEC-0019 P1-3 "جداول العمليات" — operation templates (instantiate-only slice). ──
// Augmented here until database.types.ts is regenerated from prod (then a harmless no-op).
type PlanOperationTemplatesTable = {
  Row: {
    id: string;
    org_id: string;
    name: string;
    subtype: string;
    recurrence: Json;
    created_by: string | null;
    created_at: string;
  };
  Insert: {
    id?: string;
    org_id: string;
    name: string;
    subtype: string;
    recurrence?: Json;
    created_by?: string | null;
    created_at?: string;
  };
  Update: {
    id?: string;
    org_id?: string;
    name?: string;
    subtype?: string;
    recurrence?: Json;
    created_by?: string | null;
    created_at?: string;
  };
  Relationships: [];
};
type OperationTemplateFunctions = {
  fn_instantiate_operation_template: {
    Args: { p_plan_id: string; p_template_id: string; p_anchor_date: string };
    Returns: Json;
  };
};

type CustodyFunctions = {
  fn_save_account: {
    Args: {
      p_id: string | null;
      p_org: string | null;
      p_parent_id: string | null;
      p_code: string;
      p_name_ar: string;
      p_account_type: "asset" | "liability" | "equity" | "revenue" | "expense";
      p_normal_balance: "debit" | "credit";
      p_kind?: ExpenseKind | null;
      p_sort_order?: number | null;
      p_active?: boolean;
    };
    Returns: Json;
  };
  fn_archive_account: { Args: { p_id: string }; Returns: Json };
  fn_merge_accounts: {
    Args: { p_source: string; p_target: string };
    Returns: Json;
  };
  fn_save_cost_center: {
    Args: {
      p_id: string | null;
      p_org: string | null;
      p_parent_id: string | null;
      p_code: string;
      p_name_ar: string;
      p_sector_id?: string | null;
      p_enterprise?: string | null;
      p_area_feddan?: number | null;
      p_sort_order?: number | null;
      p_active?: boolean;
    };
    Returns: Json;
  };
  fn_archive_cost_center: { Args: { p_id: string }; Returns: Json };
  fn_merge_cost_centers: {
    Args: { p_source: string; p_target: string };
    Returns: Json;
  };
  fn_save_custody_account: {
    Args: {
      p_id: string | null;
      p_org: string | null;
      p_holder_label: string;
      p_holder_user_id?: string | null;
      p_target_float?: string;
      p_active?: boolean;
    };
    Returns: string;
  };
  fn_record_custody_movement: {
    Args: {
      p_account: string;
      p_movement_type: string;
      p_amount_in: string;
      p_amount_out: string;
      p_occurred_at?: string;
      p_expense_id?: string | null;
      p_note?: string | null;
    };
    Returns: string;
  };
  fn_transfer_custody: {
    Args: {
      p_from_account: string;
      p_to_account: string;
      p_amount: string;
      p_occurred_at?: string;
      p_note?: string | null;
    };
    Returns: string;
  };
  fn_set_expense_payment_status: {
    Args: {
      p_expense: string;
      p_status: ExpensePaymentStatus;
      p_custody_account?: string | null;
      p_paid_by?: string | null;
    };
    Returns: undefined;
  };
  fn_reverse_expense_payment: {
    Args: {
      p_expense: string;
      p_expected_movement: string;
      p_outcome: "unrouted" | "cancelled";
      p_reason: string;
      p_reversal_date: string;
    };
    Returns: Json;
  };
  fn_reverse_custody_movement: {
    Args: { p_movement: string; p_reason: string; p_reversal_date: string };
    Returns: Json;
  };
  fn_correct_and_route_reversed_expense: {
    Args: {
      p_expense: string;
      p_date: string | null;
      p_category: string;
      p_description: string | null;
      p_total: string;
      p_supplier: string | null;
      p_account: string | null;
      p_cost_center: string | null;
      p_route: "custody" | "later" | "none";
      p_custody_account?: string | null;
    };
    Returns: Json;
  };
  // Classify an expense (operating / drawing / capex) — the ONLY write path for expenses.kind (the column is
  // omitted from the expenses Insert type above, so it cannot be set by a direct insert). budget.write gated.
  fn_set_expense_kind: {
    Args: { p_id: string; p_kind: ExpenseKind };
    Returns: Json;
  };
  fn_custody_balance: { Args: { p_account: string }; Returns: number };
  fn_custody_dashboard_summary: { Args: { p_org: string }; Returns: Json };
  fn_custody_daily_snapshot: {
    Args: {
      p_org: string;
      p_request_filter: "all" | "awaiting" | "settled";
      p_month_start: string;
      p_month_end: string;
      p_movement_limit?: number;
      p_request_limit?: number;
    };
    Returns: Json;
  };
  fn_create_payment_request: {
    Args: {
      p_org: string;
      p_period_start?: string | null;
      p_period_end?: string | null;
      p_custody_account?: string | null;
      p_note?: string | null;
    };
    Returns: string;
  };
  fn_add_expense_to_request: {
    Args: { p_request: string; p_expense: string };
    Returns: string;
  };
  fn_submit_payment_request: {
    Args: { p_request: string };
    Returns: undefined;
  };
  fn_approve_request_operational: {
    Args: { p_request: string };
    Returns: undefined;
  };
  fn_approve_request_final: { Args: { p_request: string }; Returns: undefined };
  fn_payment_request_totals: { Args: { p_request: string }; Returns: Json };
  fn_payment_request_detail_snapshot: {
    Args: { p_org: string; p_request: string; p_available_limit?: number };
    Returns: Json;
  };
  fn_accounting_trial_balance: { Args: { p_org: string }; Returns: Json };
  fn_accounting_ledger_snapshot: {
    Args: { p_org: string; p_entry_limit?: number };
    Returns: Json;
  };
  fn_transactions_snapshot: {
    Args: { p_org: string; p_row_limit?: number };
    Returns: Json;
  };
  fn_season_dashboard_snapshot: {
    Args: {
      p_org: string;
      p_from: string;
      p_as_of: string;
      p_row_limit?: number;
    };
    Returns: Json;
  };
  fn_custody_reports_snapshot: {
    Args: {
      p_org: string;
      p_period_start: string;
      p_period_end: string;
      p_as_of: string;
      p_row_limit?: number;
    };
    Returns: Json;
  };
  fn_finance_dashboard_snapshot: {
    Args: {
      p_org: string;
      p_month_start: string;
      p_month_end: string;
      p_as_of: string;
      p_row_limit?: number;
      p_journal_limit?: number;
    };
    Returns: Json;
  };
  fn_accounting_balance_sheet: {
    Args: { p_org: string; p_as_of?: string | null };
    Returns: Json;
  };
  fn_accounting_income_statement: {
    Args: { p_org: string; p_from: string; p_to?: string | null };
    Returns: Json;
  };
  fn_budget_vs_actual: {
    Args: { p_org: string; p_from: string; p_to?: string | null };
    Returns: Json;
  };
  fn_pnl_timeseries: {
    Args: {
      p_org: string;
      p_grain: string;
      p_from: string;
      p_to?: string | null;
    };
    Returns: Json;
  };
  fn_close_accounting_period: {
    Args: {
      p_org: string;
      p_period_start: string;
      p_period_end: string;
      p_note?: string | null;
    };
    Returns: string;
  };
  fn_reopen_accounting_period: {
    Args: { p_org: string; p_period_id: string };
    Returns: undefined;
  };
  fn_custody_ledger_report: {
    Args: {
      p_org: string;
      p_period_start?: string | null;
      p_period_end?: string | null;
    };
    Returns: Json;
  };
  fn_custody_cash_expense_report: {
    Args: {
      p_org: string;
      p_period_start?: string | null;
      p_period_end?: string | null;
    };
    Returns: Json;
  };
  fn_unpaid_obligations_report: {
    Args: { p_org: string; p_as_of?: string | null };
    Returns: Json;
  };
  fn_owner_funding_report: {
    Args: {
      p_org: string;
      p_period_start?: string | null;
      p_period_end?: string | null;
    };
    Returns: Json;
  };
  fn_record_payment_request_funding: {
    Args: {
      p_request: string;
      p_custody_account: string;
      p_amount: string;
      p_occurred_at?: string;
      p_note?: string | null;
    };
    Returns: string;
  };
  fn_confirm_request_expense_paid: {
    Args: {
      p_request: string;
      p_expense: string;
      p_custody_account: string;
      p_occurred_at?: string;
      p_paid_by?: string | null;
      p_note?: string | null;
    };
    Returns: string;
  };
  fn_close_payment_request: { Args: { p_request: string }; Returns: undefined };
};

// ── #398: who's assigned to a plan operation (migration 20260622000090). Augmented here because it
// predates the last database.types.ts regeneration. Insert/Update are intentionally Record<string,
// never> — the table is written ONLY via the gated RPCs (fn_add_plan_operation_multi to add,
// fn_unassign_plan_operation to remove); there is no direct-client-write path (mirrors CustodyAccountsTable). ──
type PlanOperationAssigneesTable = {
  Row: {
    id: string;
    org_id: string;
    plan_op_id: string;
    person_id: string;
    is_lead: boolean;
    created_at: string;
  };
  Insert: Record<string, never>;
  Update: Record<string, never>;
  Relationships: [];
};

// ── "/finance/pnl" owner P&L period summary, migration 20260701270000. ──
// Narrowly-scoped, additive to the Stage-7 accounting framework (PR #368, still an unmerged draft) —
// NOT a replacement for `fn_accounting_pnl_summary`. finance.read gated (owner/accountant only).
type OwnerPnlFunctions = {
  fn_owner_pnl_summary: {
    Args: { p_org: string; p_from: string; p_to: string };
    Returns: Json;
  };
};

type OwnerHomeFunctions = {
  fn_owner_home_snapshot: {
    Args: { p_org: string; p_as_of: string; p_detail_limit?: number };
    Returns: Json;
  };
};

type CostCenterSummaryFunctions = {
  fn_cost_center_direct_summary: {
    Args: { p_org: string; p_cost_center: string };
    Returns: Json;
  };
  fn_cost_center_history_summary: {
    Args: { p_org: string };
    Returns: Json;
  };
  fn_cost_center_reports_snapshot: {
    Args: { p_org: string; p_include_history?: boolean };
    Returns: Json;
  };
  fn_cost_center_revenue_summary: {
    Args: { p_org: string };
    Returns: Json;
  };
};

// ── Exact expense register + unpaid-obligation summary, migrations 20260730140000/150000.
// Read-only, STABLE, SECURITY DEFINER, org/finance.read-gated; drawing-scoped fields are JSON null
// for a caller without finance.read (never a fabricated zero). ──
type ExpenseRegisterSummaryFunctions = {
  fn_expense_register_summary: {
    Args: { p_org: string; p_month_start: string; p_month_end: string };
    Returns: Json;
  };
  fn_expense_daily_snapshot: {
    Args: {
      p_org: string;
      p_filter: "all" | "month" | "operating" | "drawing" | "undated" | "unrouted" | "unclassified" | "uncentered";
      p_month_start: string;
      p_month_end: string;
      p_row_limit?: number;
    };
    Returns: Json;
  };
  fn_expense_detail_snapshot: {
    Args: { p_org: string; p_expense: string };
    Returns: Json;
  };
};

type MonthCloseSummaryFunctions = {
  fn_month_close_summary: {
    Args: { p_org: string; p_cutover: string; p_as_of: string };
    Returns: Json;
  };
  fn_set_missing_expense_date: {
    Args: { p_org: string; p_expense: string; p_date: string };
    Returns: string;
  };
};

// ── Accountant home, migration 20260822142600. One exact, bounded, accountant-only active-org
// snapshot reusing fn_month_close_summary's blocker/receivable definitions. STABLE, SECURITY INVOKER,
// accountant-membership-gated. ──
type AccountantHomeFunctions = {
  fn_accountant_home_snapshot: {
    Args: { p_org: string; p_as_of: string; p_cutover: string; p_detail_limit?: number };
    Returns: Json;
  };
};

// ── Farm Manager home, migration 20260823100000. Exact, bounded, operational-only and
// farm-manager-membership-gated. ──
type ManagerHomeFunctions = {
  fn_manager_home_snapshot: {
    Args: { p_org: string; p_as_of: string; p_detail_limit?: number };
    Returns: Json;
  };
};

// ── Agronomist home, migration 20260823110000. Exact, bounded, agronomy-only and
// agri-engineer-membership-gated; recorded counts only, no finance values. ──
type AgronomistHomeFunctions = {
  fn_agronomist_home_snapshot: {
    Args: { p_org: string; p_as_of: string; p_detail_limit?: number };
    Returns: Json;
  };
};

// ── Supervisor home, migration 20260823120000. Exact, bounded, supervisor-membership-gated and
// scoped to the caller's own person link; recorded counts only, no finance values. ──
type SupervisorHomeFunctions = {
  fn_supervisor_home_snapshot: {
    Args: { p_org: string; p_as_of: string; p_detail_limit?: number };
    Returns: Json;
  };
};

// ── Storekeeper home, migration 20260823130000. Exact, bounded, storekeeper-membership-gated store
// day: open receipts whose receivability mirrors fn_post_receipt, today's recorded issues, current
// reorder-threshold and unknown-stock items, and bounded recent movement evidence. Recorded counts
// only, no finance values, and no completed-stock-take claim. ──
type StorekeeperHomeFunctions = {
  fn_storekeeper_home_snapshot: {
    Args: { p_org: string; p_as_of: string; p_detail_limit?: number };
    Returns: Json;
  };
};

// ── Inventory list + item 360, migration 20260823140000. Two exact, bounded, active-org snapshots
// gated on ordinary membership and branched by role INSIDE PostgreSQL: the storekeeper's
// 'operational' payload contains no money, supplier, purchase free-text or purchase-request-id key
// at all, every other member role keeps the 'finance' payload. `fn_inventory_item_snapshot` returns
// SQL NULL — hence `Json | null` — when the item is outside the active organization, so the page
// can answer "not found" without leaking whether another organization owns that id. ──
type InventorySnapshotFunctions = {
  fn_inventory_list_snapshot: {
    Args: {
      p_org: string;
      p_query?: string | null;
      p_filter?: string;
      p_limit?: number;
      p_offset?: number;
    };
    Returns: Json;
  };
  fn_inventory_item_snapshot: {
    Args: {
      p_org: string;
      p_item: string;
      p_movement_limit?: number;
      p_purchase_limit?: number;
    };
    Returns: Json | null;
  };
};

// ── Payroll workspace + run 360, migration 20260823150000. Two exact, bounded, active-org snapshots
// gated on ordinary membership and re-checked payroll.read (owner/accountant) INSIDE PostgreSQL.
// `fn_payroll_run_snapshot` returns SQL NULL — hence `Json | null` — when the run is outside the
// active organization or does not exist, so the page can answer "not found" without leaking which. ──
type PayrollSnapshotFunctions = {
  fn_payroll_workspace_snapshot: {
    Args: { p_org: string; p_limit?: number; p_offset?: number };
    Returns: Json;
  };
  fn_payroll_run_snapshot: {
    Args: { p_org: string; p_run_id: string; p_limit?: number; p_offset?: number };
    Returns: Json | null;
  };
};

// ── Weather thresholds (SPEC-0007 §3), migration 20260701270000 ──
type WeatherFunctions = {
  fn_update_weather_thresholds: {
    Args: { p_org: string; p_thresholds: WeatherThresholds };
    Returns: undefined;
  };
};

// ── RPW-1 «مكافحة سوسة النخيل الحمراء» — pest-trap register + catch/incident log, migration
// 20260701300000. Augmented here until database.types.ts is regenerated from prod (then a
// harmless no-op — see file header). Relationships mirror the `assets` table's FK-embed shape
// (referencedRelation = the table name used in a PostgREST embed like `sectors(name)`).
type PestTrapsTable = {
  Row: {
    id: string;
    org_id: string;
    code: string;
    label: string;
    sector_id: string | null;
    hawsha_id: string | null;
    line_id: string | null;
    installed_at: string;
    lure_changed_at: string | null;
    status: string;
    notes: string | null;
    created_at: string;
  };
  Insert: {
    id?: string;
    org_id: string;
    code: string;
    label: string;
    sector_id?: string | null;
    hawsha_id?: string | null;
    line_id?: string | null;
    installed_at: string;
    lure_changed_at?: string | null;
    status?: string;
    notes?: string | null;
    created_at?: string;
  };
  Update: {
    id?: string;
    org_id?: string;
    code?: string;
    label?: string;
    sector_id?: string | null;
    hawsha_id?: string | null;
    line_id?: string | null;
    installed_at?: string;
    lure_changed_at?: string | null;
    status?: string;
    notes?: string | null;
    created_at?: string;
  };
  Relationships: [
    {
      foreignKeyName: "pest_traps_org_id_fkey";
      columns: ["org_id"];
      isOneToOne: false;
      referencedRelation: "organization";
      referencedColumns: ["id"];
    },
    {
      foreignKeyName: "pest_traps_sector_id_fkey";
      columns: ["sector_id"];
      isOneToOne: false;
      referencedRelation: "sectors";
      referencedColumns: ["id"];
    },
    {
      foreignKeyName: "pest_traps_hawsha_id_fkey";
      columns: ["hawsha_id"];
      isOneToOne: false;
      referencedRelation: "hawshat";
      referencedColumns: ["id"];
    },
    {
      foreignKeyName: "pest_traps_line_id_fkey";
      columns: ["line_id"];
      isOneToOne: false;
      referencedRelation: "lines";
      referencedColumns: ["id"];
    }
  ];
};

type PestTrapCatchesTable = {
  Row: {
    id: string;
    org_id: string;
    trap_id: string;
    checked_at: string;
    catch_count: number;
    notes: string | null;
    created_at: string;
  };
  Insert: {
    id?: string;
    org_id: string;
    trap_id: string;
    checked_at: string;
    catch_count: number;
    notes?: string | null;
    created_at?: string;
  };
  Update: {
    id?: string;
    org_id?: string;
    trap_id?: string;
    checked_at?: string;
    catch_count?: number;
    notes?: string | null;
    created_at?: string;
  };
  Relationships: [
    {
      foreignKeyName: "pest_trap_catches_org_id_fkey";
      columns: ["org_id"];
      isOneToOne: false;
      referencedRelation: "organization";
      referencedColumns: ["id"];
    },
    {
      foreignKeyName: "pest_trap_catches_trap_id_fkey";
      columns: ["trap_id"];
      isOneToOne: false;
      referencedRelation: "pest_traps";
      referencedColumns: ["id"];
    }
  ];
};

type PestIncidentsTable = {
  Row: {
    id: string;
    org_id: string;
    trap_id: string | null;
    asset_id: string | null;
    reported_at: string;
    severity: string;
    notes: string | null;
    response_action: string | null;
    created_at: string;
  };
  Insert: {
    id?: string;
    org_id: string;
    trap_id?: string | null;
    asset_id?: string | null;
    reported_at: string;
    severity: string;
    notes?: string | null;
    response_action?: string | null;
    created_at?: string;
  };
  Update: {
    id?: string;
    org_id?: string;
    trap_id?: string | null;
    asset_id?: string | null;
    reported_at?: string;
    severity?: string;
    notes?: string | null;
    response_action?: string | null;
    created_at?: string;
  };
  Relationships: [
    {
      foreignKeyName: "pest_incidents_org_id_fkey";
      columns: ["org_id"];
      isOneToOne: false;
      referencedRelation: "organization";
      referencedColumns: ["id"];
    },
    {
      foreignKeyName: "pest_incidents_trap_id_fkey";
      columns: ["trap_id"];
      isOneToOne: false;
      referencedRelation: "pest_traps";
      referencedColumns: ["id"];
    },
    {
      foreignKeyName: "pest_incidents_asset_id_fkey";
      columns: ["asset_id"];
      isOneToOne: false;
      referencedRelation: "assets";
      referencedColumns: ["id"];
    }
  ];
};

type PestScoutingFunctions = {
  fn_save_trap: {
    Args: {
      p_org: string;
      p_code: string;
      p_label: string;
      p_installed_at: string;
      p_sector_id?: string | null;
      p_hawsha_id?: string | null;
      p_line_id?: string | null;
      p_lure_changed_at?: string | null;
      p_notes?: string | null;
    };
    Returns: Json;
  };
  fn_update_trap: {
    Args: {
      p_trap_id: string;
      p_lure_changed_at?: string | null;
      p_status?: string | null;
      p_notes?: string | null;
    };
    Returns: Json;
  };
  fn_log_trap_catch: {
    Args: {
      p_trap_id: string;
      p_checked_at: string;
      p_catch_count: number;
      p_notes?: string | null;
    };
    Returns: Json;
  };
  fn_report_pest_incident: {
    Args: {
      p_reported_at: string;
      p_severity: string;
      p_trap_id?: string | null;
      p_asset_id?: string | null;
      p_notes?: string | null;
      p_response_action?: string | null;
    };
    Returns: Json;
  };
};

// ── agronomist-signoff-gate (docs/CLAUDE.md non-negotiable #4) — plan_operations.signed_off_by/at +
// fn_sign_off_plan_operation. Augmented here until database.types.ts is regenerated from prod (then a
// harmless no-op, like the other augmentations in this file). ──
type WithSignoff<
  T extends {
    Row: object;
    Insert: object;
    Update: object;
    Relationships: unknown;
  }
> = {
  Row: T["Row"] & {
    signed_off_by: string | null;
    signed_off_at: string | null;
  };
  Insert: T["Insert"] & {
    signed_off_by?: string | null;
    signed_off_at?: string | null;
  };
  Update: T["Update"] & {
    signed_off_by?: string | null;
    signed_off_at?: string | null;
  };
  Relationships: T["Relationships"];
};
type SignoffFunctions = {
  fn_sign_off_plan_operation: { Args: { p_op_id: string }; Returns: Json };
};

// ── SPEC-0006 slice 2 — `labor_logs` (ACTUAL day-to-day attendance), migration 20260701310000. ──
// Augmented here until database.types.ts is regenerated from prod (then a harmless no-op).
//
// `mode`/`quantity`/`unit` were added by 20260729090000_payroll_run_persistence.sql, which is ALREADY
// LIVE — this is a narrow catch-up on columns that exist, not a forward declaration of a draft.
// `mode` is `not null default 'hourly'` so it is optional on Insert; `quantity`/`unit` are set iff
// mode = 'piece' (labor_logs_piece_shape). `hours` stays required for EVERY mode.
type LaborLogsTable = {
  Row: {
    id: string;
    org_id: string;
    person_id: string | null;
    team_name: string | null;
    work_date: string;
    hours: number;
    mode: string;
    quantity: number | null;
    unit: string | null;
    plan_op_id: string | null;
    note: string | null;
    created_at: string;
  };
  Insert: {
    id?: string;
    org_id: string;
    person_id?: string | null;
    team_name?: string | null;
    work_date: string;
    hours: number;
    mode?: string;
    quantity?: number | null;
    unit?: string | null;
    plan_op_id?: string | null;
    note?: string | null;
    created_at?: string;
  };
  Update: {
    id?: string;
    org_id?: string;
    person_id?: string | null;
    team_name?: string | null;
    work_date?: string;
    hours?: number;
    mode?: string;
    quantity?: number | null;
    unit?: string | null;
    plan_op_id?: string | null;
    note?: string | null;
    created_at?: string;
  };
  Relationships: [
    {
      foreignKeyName: "labor_logs_person_id_fkey";
      columns: ["person_id"];
      isOneToOne: false;
      referencedRelation: "people";
      referencedColumns: ["id"];
    }
  ];
};

// ── Public website content (SPEC public-website), migration 20260701420000. ──
// Org-scoped marketing content for the site at `/`. Reads = RLS-scoped authenticated SELECT (+ the
// service-role admin client for the public page); writes are RPC-only (client INSERT/UPDATE/DELETE
// revoked), so Insert/Update are `never`. fn_save_site_content is owner-gated (authorize('site.write')).
type SiteContentTable = {
  Row: {
    id: string;
    org_id: string;
    content: Json;
    updated_by: string | null;
    updated_at: string;
  };
  Insert: Record<string, never>;
  Update: Record<string, never>;
  Relationships: [];
};
type SiteContentFunctions = {
  fn_save_site_content: {
    Args: { p_org: string; p_content: Json };
    Returns: Json;
  };
};

// Public-site buyer enquiries (migration 20260701430000). Owner-only READ (RLS); writes are
// server-action-only via the service-role admin client (Insert type used there), never client DML.
type SiteEnquiriesTable = {
  Row: {
    id: string;
    org_id: string;
    name: string;
    company: string | null;
    country: string | null;
    volume: string | null;
    message: string;
    status: string;
    created_at: string;
  };
  Insert: {
    org_id: string;
    name: string;
    message: string;
    company?: string | null;
    country?: string | null;
    volume?: string | null;
    status?: string;
  };
  Update: Record<string, never>;
  Relationships: [];
};
type SiteEnquiriesFunctions = {
  fn_set_enquiry_status: {
    Args: { p_id: string; p_status: string };
    Returns: undefined;
  };
};

// SPEC-0024 S-7 — بنك الفسائل. Physical movement ledger; valuation is display-only and finance-read.
type OffshootMovementsTable = {
  Row: {
    id: string;
    org_id: string;
    movement_date: string;
    movement_type: "produce" | "plant" | "sell" | "replant";
    qty: number;
    source_cost_center_id: string | null;
    dest_cost_center_id: string | null;
    note: string | null;
    created_at: string;
    created_by: string | null;
  };
  Insert: Record<string, never>;
  Update: Record<string, never>;
  Relationships: [];
};
type OffshootValuationTable = {
  Row: {
    id: string;
    org_id: string;
    low_per_unit: number | null;
    high_per_unit: number | null;
    updated_at: string;
    updated_by: string | null;
  };
  Insert: Record<string, never>;
  Update: Record<string, never>;
  Relationships: [];
};
type OffshootFunctions = {
  fn_record_offshoot_movement: {
    Args: {
      p_org: string;
      p_movement_type: "produce" | "plant" | "sell" | "replant";
      p_qty: number;
      p_movement_date?: string | null;
      p_source_cost_center_id?: string | null;
      p_dest_cost_center_id?: string | null;
      p_note?: string | null;
    };
    Returns: Json;
  };
  fn_set_offshoot_valuation: {
    Args: { p_org: string; p_low: number | null; p_high: number | null };
    Returns: Json;
  };
};

type DataAuthorityStatusTable = {
  Row: {
    id: string;
    org_id: string;
    domain:
      | "finance_ledger"
      | "palm_registry"
      | "offshoots"
      | "budgets"
      | "payroll"
      | "inventory"
      | "operations";
    status: "verified" | "partial" | "unverified" | "blocked";
    source_label: string | null;
    source_sha256: string | null;
    record_count: number | null;
    notes: string | null;
    verified_at: string | null;
    verified_by: string | null;
    created_at: string;
    updated_at: string;
  };
  Insert: Record<string, never>;
  Update: Record<string, never>;
  Relationships: [];
};

type DataAuthorityFunctions = {
  fn_set_data_authority_status: {
    Args: {
      p_org: string;
      p_domain: DataAuthorityStatusTable["Row"]["domain"];
      p_status: DataAuthorityStatusTable["Row"]["status"];
      p_source_label?: string | null;
      p_source_sha256?: string | null;
      p_record_count?: number | null;
      p_notes?: string | null;
    };
    Returns: DataAuthorityStatusTable["Row"];
  };
};

// SPEC-0027 H-A — شاشة الميزان: one call = crates→net→pending sale + serialized بون.
type HarvestDaysTable = {
  Row: {
    id: string;
    org_id: string;
    day: string;
    cost_center_id: string | null;
    crop: string;
    crates_picked: number;
    crew_count: number | null;
    note: string | null;
    created_at: string;
    created_by: string | null;
  };
  Insert: never;
  Update: never;
  Relationships: [];
};
type HarvestFunctions = {
  fn_record_harvest_day: {
    Args: {
      p_org: string;
      p_crates: number;
      p_cost_center_id?: string | null;
      p_crop?: string | null;
      p_day?: string | null;
      p_crew_count?: number | null;
      p_note?: string | null;
    };
    Returns: Json;
  };
};
type ScaleFunctions = {
  fn_record_scale_delivery: {
    Args: {
      p_org: string;
      p_crop: string;
      p_crates: number;
      p_gross_kg: number;
      p_tare_per_crate: number;
      p_buyer_id?: string | null;
      p_cost_center_id?: string | null;
      p_sale_date?: string | null;
      p_notes?: string | null;
    };
    Returns: Json;
  };
};
type RevenueFunctions = {
  fn_save_buyer: {
    Args: {
      p_id: string | null;
      p_org: string | null;
      p_name: string;
      p_buyer_type?: BuyerType | null;
      p_phone?: string | null;
      p_active?: boolean | null;
    };
    Returns: Json;
  };
  fn_save_sale: {
    Args: {
      p_id: string | null;
      p_org: string | null;
      p_sale_date: string | null;
      p_crop: string;
      p_buyer_id?: string | null;
      p_cost_center_id?: string | null;
      p_farm_id?: string | null;
      p_sector_id?: string | null;
      p_hawsha_id?: string | null;
      p_season?: string | null;
      p_qty?: number | null;
      p_unit?: string | null;
      p_delivery_date?: string | null;
      p_notes?: string | null;
    };
    Returns: Json;
  };
  fn_finalize_sale_price: {
    Args: { p_sale: string; p_unit_price: string };
    Returns: Json;
  };
  fn_record_sale_collection: {
    Args: {
      p_sale: string;
      p_amount: string;
      p_occurred_at?: string | null;
      p_collected_by?: string | null;
      p_note?: string | null;
    };
    Returns: Json;
  };
  fn_pending_sale_pricing: {
    Args: { p_org: string; p_limit?: number };
    Returns: Json;
  };
  fn_open_sale_receivables: {
    Args: { p_org: string; p_limit?: number };
    Returns: Json;
  };
  fn_revenue_sales_report: {
    Args: {
      p_org: string;
      p_period_start?: string | null;
      p_period_end?: string | null;
      p_as_of?: string | null;
    };
    Returns: Json;
  };
  fn_revenue_sales_report_exact: {
    Args: {
      p_org: string;
      p_period_start?: string | null;
      p_period_end?: string | null;
      p_as_of?: string | null;
    };
    Returns: Json;
  };
};

// Accounting reconciliation (SPEC-0004 slices 1A/3, migrations
// 20260725201546_accounting_reconciliation_provenance.sql and
// "20260726120000 accounting reconciliation review rpcs.sql"). Not yet in the generated types.
// Reads are RLS-scoped SELECTs; every write goes through the gated RPCs below, so Insert/Update are
// closed (Record<string, never>), matching the accounting tables above.
type ReconciliationBatchesTable = {
  Row: {
    id: string;
    org_id: string;
    source_workbook_sha256: string | null;
    source_label: string | null;
    status: string;
    created_at: string;
    created_by: string | null;
    approved_by: string | null;
    approved_at: string | null;
    result_summary: Json | null;
  };
  Insert: Record<string, never>;
  Update: Record<string, never>;
  Relationships: [];
};
type ReconciliationEvidenceItemsTable = {
  Row: {
    id: string;
    org_id: string;
    origin_kind: string;
    source_workbook_sha256: string | null;
    sheet_name: string | null;
    row_locator: string | null;
    production_snapshot_sha256: string | null;
    snapshot_target_table: string | null;
    snapshot_target_id: string | null;
    source_identity_fingerprint: string | null;
    source_amount: number | null;
    source_date_text: string | null;
    source_date_parsed: string | null;
    classification: string;
    invalid_calendar_quality_flag: boolean;
    first_staged_batch_id: string | null;
    created_at: string;
    created_by: string | null;
    // Slice 4A (migration 20260726140000): nullable label displayed in the review UI.
    evidence_label: string | null;
  };
  Insert: Record<string, never>;
  Update: Record<string, never>;
  Relationships: [];
};
type ReconciliationBatchRowsTable = {
  Row: {
    id: string;
    org_id: string;
    batch_id: string;
    evidence_item_id: string;
    review_state: string;
    // Migration 20260822140100: optimistic concurrency token for every row mutation.
    review_version: number;
    reviewer_id: string | null;
    review_reason: string | null;
    reviewed_at: string | null;
    target_table: string | null;
    disposition: string;
    expense_category: string | null;
    expense_description: string | null;
    expense_kind: string | null;
    expense_account_id: string | null;
    expense_cost_center_id: string | null;
    expense_supplier_id: string | null;
    expense_payment_decision: string | null;
    sale_crop: string | null;
    sale_quantity: number | null;
    sale_unit: string | null;
    sale_unit_price: number | null;
    sale_recorded_total: number | null;
    sale_buyer_id: string | null;
    sale_cost_center_id: string | null;
    sale_farm_id: string | null;
    sale_sector_id: string | null;
    sale_hawsha_id: string | null;
    sale_season: string | null;
    sale_delivery_date: string | null;
    sale_notes: string | null;
    sale_historical_date_decision: string | null;
    sale_effective_date: string | null;
    corrects_expense_id: string | null;
    corrects_sale_id: string | null;
    payload_hash: string | null;
    frozen: boolean;
    frozen_at: string | null;
    execution_result: string;
    execution_error: string | null;
    created_at: string;
    created_by: string | null;
  };
  Insert: Record<string, never>;
  Update: Record<string, never>;
  Relationships: [];
};
/**
 * What the two owner-only money RPCs return.
 *
 * Both answer with a jsonb VERDICT, not with a bare void: fn_execute_reconciliation_batch catches a
 * non-transient failure, records it on the batch, and returns `{status:'failed', failure_code,
 * safe_locator}` WITHOUT raising, so `status` is the only truthful signal that anything was posted.
 * Typing these as an opaque `Json` forced a caller to either ignore the body or cast it, which is
 * exactly how a returned failure came to be reported as success.
 *
 * Every field is optional and nullable ON PURPOSE. This type says "here is the shape you may look
 * for"; it does not assert the server sent it. `lib/reconciliation review.ts`'s parseExecuteOutcome /
 * parseRollbackOutcome remain the authoritative runtime validation and fail closed on anything else.
 */
export type ReconciliationBatchOutcome = {
  batch_id?: string | null;
  status?: string | null;
  idempotent?: boolean | null;
  executed_rows?: number | null;
  skipped_rows?: number | null;
  /** Coarse execution failure class. Mapped to Arabic; never rendered raw. */
  failure_code?: string | null;
  // `safe_locator` IS on the wire and is deliberately NOT modelled here. It is a row-level locator,
  // and §2.7's redaction discipline keeps row-level identifiers out of anything a user can see. Not
  // declaring it makes that a COMPILE error rather than a convention: `data.safe_locator` does not
  // typecheck, so a future caller cannot reach it without deliberately casting past this contract.
  reversed_journals?: number | null;
  reinstated_journals?: number | null;
  zero_value_rows?: number | null;
  ledger_rows_reversed?: number | null;
  rows_marked_reversed?: number | null;
};

/**
 * What fn_stage_reconciliation_manifest returns.
 *
 * Every field is optional and nullable ON PURPOSE — same rationale as ReconciliationBatchOutcome
 * above: this type describes the shape a caller MAY look for, it does not assert the server sent it.
 * `lib/reconciliation staging.ts`'s parseStageOutcome is the authoritative runtime validation and
 * fails closed unless `batch_id` is a real UUID and `status` a non-empty string.
 */
export type ReconciliationStageOutcome = {
  batch_id?: string | null;
  status?: string | null;
  /** True when the deterministic manifest was already staged byte-for-byte; nothing was written. */
  idempotent_replay?: boolean | null;
  staged_rows?: number | null;
  total_rows?: number | null;
};

/**
 * What fn_reconciliation_acceptance_snapshot returns (migration
 * "20260728120000 accounting reconciliation acceptance snapshot.sql").
 *
 * Every field is optional and nullable ON PURPOSE — same rationale as the two types above: this says
 * "here is the shape you may look for", it does not assert the server sent it.
 * `lib/reconciliation acceptance data.ts`'s parseAcceptanceSnapshot is the authoritative runtime
 * validation and refuses anything it does not fully recognise.
 *
 * `batch` and `rows` are deliberately `Json`: the parser reads them field by field (including that no
 * accounting amount arrived as a JSON number), so declaring a convenient shape here would only invite
 * a caller to trust it without that check.
 */
export type ReconciliationAcceptanceSnapshot = {
  /** Pins the payload contract; the reader refuses any other value. */
  version?: string | null;
  /** 'ok' | 'not_found' | 'empty' | 'overflow' | 'incomplete' | 'count_mismatch'. */
  status?: string | null;
  /** The whole-batch bound the DB enforced. Must equal the app's ACCEPTANCE_MAX_ROWS. */
  max_rows?: number | null;
  row_count?: number | null;
  evidence_item_count?: number | null;
  declared_row_count?: number | null;
  rows_missing_evidence?: number | null;
  staged_batch_row_count?: number | null;
  staged_evidence_item_count?: number | null;
  batch?: Json | null;
  rows?: Json | null;
};

/** Runtime-validated by lib/reconciliation queue data.ts before any display row is trusted. */
export type ReconciliationQueuePageSnapshot = {
  version?: string | null;
  status?: string | null;
  total?: number | null;
  page?: number | null;
  page_size?: number | null;
  counts?: Json | null;
  rows?: Json | null;
  row_count?: number | null;
  rows_with_evidence?: number | null;
};

// The authenticated client RPCs the reconciliation workspace calls: the staging RPC, the three
// review-stage ones, the two owner-only money RPCs the batch page drives, and the read-only
// acceptance snapshot.
type ReconciliationFunctions = {
  /**
   * Stage an already-generated Slice-2 manifest as REVIEW ROWS ONLY (20260726120000, re-emitted by
   * 20260726140000). Owner/accountant via authorize('reconciliation.write', p_org); `p_org` must be
   * the caller's own org and must equal the manifest's own `batch.org_id` (the RPC re-checks both).
   * Creates no expense, sale, or journal — posting happens only at owner execution.
   */
  fn_stage_reconciliation_manifest: {
    Args: { p_org: string; p_manifest: Json };
    Returns: ReconciliationStageOutcome;
  };
  fn_review_reconciliation_row: {
    Args: { p_row_id: string; p_decision: Json };
    Returns: Json;
  };
  fn_freeze_reconciliation_batch: {
    Args: { p_batch_id: string };
    Returns: Json;
  };
  fn_approve_reconciliation_batch: {
    Args: { p_batch_id: string };
    Returns: Json;
  };
  /**
   * Owner-only, whole-batch atomic execution of an approved batch (20260726150000/20260726160000).
   * Returns a verdict — a `failed` status arrives with NO PostgREST error, so the body must be read.
   */
  fn_execute_reconciliation_batch: {
    Args: { p_batch_id: string };
    Returns: ReconciliationBatchOutcome;
  };
  /**
   * Owner-only, whole-batch atomic rollback of an executed batch (20260726170000). `p_reason` is
   * MANDATORY at the RPC — it is typed non-optional here so a caller cannot omit it at compile time.
   */
  fn_rollback_reconciliation_batch: {
    Args: { p_batch_id: string; p_reason: string };
    Returns: ReconciliationBatchOutcome;
  };
  /**
   * READ-ONLY, SECURITY INVOKER single-snapshot payload for the acceptance report (20260728120000).
   *
   * Owner/accountant via authorize('finance.read', p_org); `p_org` must be the caller's ACTIVE org.
   * It reads the batch, every row, each row's evidence and the readable dimension labels in ONE
   * database snapshot, serialises every `numeric` accounting field as canonical decimal TEXT, and
   * refuses — never truncates — an over-large batch, an incomplete read, or a batch whose stored row
   * count disagrees with what staging recorded. It calls no other RPC and writes nothing.
   */
  fn_reconciliation_acceptance_snapshot: {
    Args: { p_org: string; p_batch_id: string };
    Returns: ReconciliationAcceptanceSnapshot;
  };
  /**
   * Read-only canonical queue order (20260822140200). Returns one page of at most 50 complete display
   * rows plus its exact filtered total from one tenant-scoped database snapshot.
   */
  fn_reconciliation_queue_page: {
    Args: {
      p_org: string;
      p_batch_id: string;
      p_classification?: string | null;
      p_state?: string | null;
      p_quality?: string | null;
      p_page?: number;
      p_limit?: number;
    };
    Returns: ReconciliationQueuePageSnapshot;
  };
};

// Payroll persistence (SPEC-0006 slice 3, migration 20260729090000_payroll_run_persistence.sql —
// already live). Not yet in the generated types. Both tables are FORCE RLS with a SELECT-only grant
// gated on authorize('payroll.read', org_id) (owner/accountant); the ONLY write path is the
// SECURITY DEFINER RPC below, and both tables are additionally immutable through an unconditional
// BEFORE UPDATE OR DELETE trigger. Insert/Update are therefore closed (Record<string, never>),
// matching the accounting/reconciliation tables above — a stray `.insert()` fails to compile.
type PayrollRunsTable = {
  Row: {
    id: string;
    org_id: string;
    period_start: string;
    period_end: string;
    closed_by: string | null;
    closed_at: string;
    total_gross: number;
  };
  Insert: Record<string, never>;
  Update: Record<string, never>;
  Relationships: [];
};
type PayrollRunLinesTable = {
  Row: {
    id: string;
    org_id: string;
    run_id: string;
    person_id: string;
    /** Worker display name frozen when the immutable payroll line is inserted. */
    person_name_snapshot: string;
    mode: string;
    /** Set iff mode = 'piece' (payroll_run_lines_piece_shape). */
    unit: string | null;
    quantity: number;
    rate: number;
    /** round(quantity * rate, 2) — pinned by the payroll_run_lines_gross_exact CHECK. */
    gross: number;
  };
  Insert: Record<string, never>;
  Update: Record<string, never>;
  Relationships: [];
};
type PayrollFunctions = {
  /**
   * Close a payroll period: freeze one immutable run + its snapshot lines for the caller's own org
   * (owner/accountant via authorize('payroll.read', p_org)). Idempotent on an exact replay, and it
   * takes a per-org EXCLUSIVE advisory lock BEFORE deciding, so a concurrent second caller never
   * races it — an app-side pre-check would only reintroduce the race the RPC already closes.
   *
   * NO PAYMENT EXECUTION and NO JOURNAL: it snapshots gross pay for reporting only.
   *
   * Every failure arrives as a raised SQLSTATE whose message embeds raw identifiers (person/org
   * UUIDs). Callers MUST route it through lib/payroll-close.ts' `payrollCloseFailure`, never render
   * `error.message`.
   */
  fn_close_payroll_run: {
    Args: { p_org: string; p_period_start: string; p_period_end: string };
    Returns: Json;
  };
};

// ── SPEC-0032 — Marketing module, migration 20260820090000. ──
// Reads/writes are role-scoped to owner/accountant/farm_manager (RLS + RPC inline check, no
// authorize() dependency); client INSERT/UPDATE/DELETE is revoked on all three tables, so every
// Insert/Update type below is `never` — the RPCs (below) are the only write surface.
type MarketingContactTable = {
  Row: {
    id: string;
    org_id: string;
    name: string;
    phone: string | null;
    email: string | null;
    org_name: string | null;
    category: "exporter" | "buyer_lead" | "kuwait_distributor" | "platform" | "freight" | "other";
    source: string | null;
    source_key: string | null;
    notes: string | null;
    metadata: Json;
    selected: boolean;
    archived: boolean;
    created_by: string | null;
    created_at: string;
    updated_at: string;
  };
  Insert: Record<string, never>;
  Update: Record<string, never>;
  Relationships: [];
};

// Append-only (no update/delete RPC exists at all — fn_log_marketing_contact_activity is the only writer).
type MarketingContactActivityTable = {
  Row: {
    id: string;
    org_id: string;
    contact_id: string;
    kind: "call" | "email" | "meeting" | "note" | "followup";
    notes: string | null;
    occurred_at: string;
    follow_up_at: string | null;
    created_by: string | null;
    created_at: string;
  };
  Insert: Record<string, never>;
  Update: Record<string, never>;
  Relationships: [
    {
      foreignKeyName: "marketing_contact_activity_contact_id_fkey";
      columns: ["contact_id"];
      isOneToOne: false;
      referencedRelation: "marketing_contact";
      referencedColumns: ["id"];
    },
  ];
};

export type MarketingRecordType =
  | "price_observation"
  | "exw_bid"
  | "quality_batch"
  | "weekly_availability"
  | "competitor"
  | "lead_local"
  | "lead_offshoot"
  | "lead_social"
  | "lead_linkedin"
  | "hot_lead"
  | "task"
  | "platform_state"
  | "broker_state"
  | "certificate"
  | "channel_target"
  | "message_template"
  | "freight_reference"
  | "market_reference"
  | "daily_sales_report"
  | "repeat_customer";

type MarketingRecordTable = {
  Row: {
    id: string;
    org_id: string;
    record_type: MarketingRecordType;
    title: string;
    payload: Json;
    contact_id: string | null;
    amount: number | null;
    status: string | null;
    source_key: string | null;
    archived: boolean;
    created_by: string | null;
    created_at: string;
    updated_at: string;
  };
  Insert: Record<string, never>;
  Update: Record<string, never>;
  Relationships: [
    {
      foreignKeyName: "marketing_record_contact_id_fkey";
      columns: ["contact_id"];
      isOneToOne: false;
      referencedRelation: "marketing_contact";
      referencedColumns: ["id"];
    },
  ];
};

type MarketingImportRunTable = {
  Row: {
    id: string;
    org_id: string;
    source_hash: string;
    expected_contacts: number;
    imported_contacts: number;
    existing_contacts: number;
    expected_records: number;
    imported_records: number;
    existing_records: number;
    coverage: Json;
    created_by: string | null;
    created_at: string;
  };
  Insert: Record<string, never>;
  Update: Record<string, never>;
  Relationships: [];
};

type MarketingWorkspaceControlTable = {
  Row: {
    id: string;
    org_id: string;
    area_id: string;
    control_key: string;
    value: Json;
    updated_by: string | null;
    created_at: string;
    updated_at: string;
  };
  Insert: Record<string, never>;
  Update: Record<string, never>;
  Relationships: [];
};

type MarketingFunctions = {
  fn_save_marketing_contact: {
    Args: {
      p_id: string | null;
      p_org: string | null;
      p_name: string;
      p_phone: string | null;
      p_email: string | null;
      p_org_name: string | null;
      p_category: string;
      p_source: string | null;
      p_notes: string | null;
      p_selected?: boolean;
      p_source_key?: string | null;
    };
    Returns: Json;
  };
  fn_archive_marketing_contact: { Args: { p_id: string; p_archived: boolean }; Returns: undefined };
  fn_save_marketing_contact_v2: {
    Args: {
      p_id: string | null;
      p_org: string | null;
      p_name: string;
      p_phone: string | null;
      p_email: string | null;
      p_org_name: string | null;
      p_category: string;
      p_source: string | null;
      p_notes: string | null;
      p_selected?: boolean;
      p_source_key?: string | null;
      p_metadata?: Json;
    };
    Returns: Json;
  };
  fn_save_marketing_contact_v3: {
    Args: {
      p_id: string | null;
      p_org: string | null;
      p_name: string;
      p_phone: string | null;
      p_email: string | null;
      p_org_name: string | null;
      p_category: string;
      p_source: string | null;
      p_notes: string | null;
      p_selected?: boolean;
      p_source_key?: string | null;
      p_status?: string | null;
    };
    Returns: Json;
  };
  fn_log_marketing_contact_activity: {
    Args: {
      p_contact_id: string;
      p_kind: string;
      p_notes: string | null;
      p_occurred_at?: string;
      p_follow_up_at?: string | null;
    };
    Returns: Json;
  };
  fn_save_marketing_record: {
    Args: {
      p_id: string | null;
      p_org: string | null;
      p_record_type: string;
      p_title: string;
      p_payload: Json;
      p_contact_id?: string | null;
      p_amount?: number | null;
      p_status?: string | null;
      p_source_key?: string | null;
    };
    Returns: Json;
  };
  fn_archive_marketing_record: { Args: { p_id: string; p_archived: boolean }; Returns: undefined };
  fn_import_marketing_source: {
    Args: {
      p_org: string;
      p_source_hash: string;
      p_contacts: Json;
      p_records: Json;
      p_expected_contacts: number;
      p_expected_records: number;
      p_coverage: Json;
    };
    Returns: Json;
  };
  fn_marketing_contacts_page: {
    Args: {
      p_org: string;
      p_query?: string | null;
      p_category?: string | null;
      p_archived?: boolean | null;
      p_page?: number;
      p_page_size?: number;
    };
    Returns: Json;
  };
  fn_marketing_dashboard_snapshot: { Args: { p_org: string }; Returns: Json };
  fn_save_marketing_workspace_control: {
    Args: { p_org: string; p_area_id: string; p_control_key: string; p_value: Json };
    Returns: Json;
  };
  fn_marketing_workspace_aggregates: { Args: { p_org: string }; Returns: Json };
};

export type Database = Omit<Generated, "public"> & {
  public: Omit<Public, "Tables" | "Functions" | "Views"> & {
    Views: Public["Views"] & {
      v_account_rollup: AccountRollupView;
      v_cost_center_rollup: CostCenterRollupView;
      v_cost_center_reconciliation_flags: CostCenterReconciliationFlagsView;
    };
    Tables: Omit<
      Tables,
      | "farms"
      | "sectors"
      | "hawshat"
      | "lines"
      | "expenses"
      | "plan_operations"
      | "plan_labor_requirements"
      | "plan_material_requirements"
      | "people_compensation"
    > & {
      people_compensation: WithWageMode<Tables["people_compensation"]>;
      farms: WithArchived<Tables["farms"]>;
      sectors: WithArchived<Tables["sectors"]>;
      hawshat: WithArchived<Tables["hawshat"]>;
      lines: WithArchived<Tables["lines"]>;
      expenses: WithPaymentStatus<Tables["expenses"]>;
      plan_operations: WithOpNote<
        WithOperationEnd<
          WithSignoff<
            WithDependsOn<
              WithIrrigationBasis<WithHarvestStage<Tables["plan_operations"]>>
            >
          >
        >
      >;
      plan_material_requirements: WithSprayCompliance<
        Tables["plan_material_requirements"]
      >;
      attachments: AttachmentsTable;
      academy_content: AcademyContentTable;
      accounts: AccountsTable;
      cost_centers: CostCentersTable;
      journal_entries: JournalEntriesTable;
      journal_lines: JournalLinesTable;
      accounting_periods: AccountingPeriodsTable;
      custody_accounts: CustodyAccountsTable;
      custody_movements: CustodyMovementsTable;
      payment_requests: PaymentRequestsTable;
      payment_request_lines: PaymentRequestLinesTable;
      payment_request_fundings: PaymentRequestFundingsTable;
      buyers: BuyersTable;
      sales: SalesTable;
      harvest_days: HarvestDaysTable;
      sale_collections: SaleCollectionsTable;
      plan_operation_assignees: PlanOperationAssigneesTable;
      plan_operation_templates: PlanOperationTemplatesTable;
      pest_traps: PestTrapsTable;
      pest_trap_catches: PestTrapCatchesTable;
      pest_incidents: PestIncidentsTable;
      labor_logs: LaborLogsTable;
      plan_labor_requirements: WithLaborPersonId<
        Tables["plan_labor_requirements"]
      >;
      site_content: SiteContentTable;
      site_enquiries: SiteEnquiriesTable;
      offshoot_movements: OffshootMovementsTable;
      offshoot_valuation: OffshootValuationTable;
      data_authority_status: DataAuthorityStatusTable;
      reconciliation_batches: ReconciliationBatchesTable;
      reconciliation_evidence_items: ReconciliationEvidenceItemsTable;
      reconciliation_batch_rows: ReconciliationBatchRowsTable;
      payroll_runs: PayrollRunsTable;
      payroll_run_lines: PayrollRunLinesTable;
      marketing_contact: MarketingContactTable;
      marketing_contact_activity: MarketingContactActivityTable;
      marketing_record: MarketingRecordTable;
      marketing_import_run: MarketingImportRunTable;
      marketing_workspace_control: MarketingWorkspaceControlTable;
    };
    Functions: Public["Functions"] &
      StructFunctions &
      CustodyFunctions &
      OperationTemplateFunctions &
      OwnerPnlFunctions &
      OwnerHomeFunctions &
      AccountantHomeFunctions &
      ManagerHomeFunctions &
      AgronomistHomeFunctions &
      SupervisorHomeFunctions &
      StorekeeperHomeFunctions &
      InventorySnapshotFunctions &
      PayrollSnapshotFunctions &
      CostCenterSummaryFunctions &
      ExpenseRegisterSummaryFunctions &
      MonthCloseSummaryFunctions &
      WeatherFunctions &
      PestScoutingFunctions &
      SignoffFunctions &
      SiteContentFunctions &
      SiteEnquiriesFunctions &
      OffshootFunctions &
      DataAuthorityFunctions &
      RevenueFunctions &
      ScaleFunctions &
      HarvestFunctions &
      ReconciliationFunctions &
      PayrollFunctions &
      MarketingFunctions;
  };
};

export type { Json };
