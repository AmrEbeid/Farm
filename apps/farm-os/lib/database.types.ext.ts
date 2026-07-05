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
type WithArchived<T extends { Row: object; Insert: object; Update: object; Relationships: unknown }> = {
  Row: T["Row"] & { archived: boolean };
  Insert: T["Insert"] & { archived?: boolean };
  Update: T["Update"] & { archived?: boolean };
  Relationships: T["Relationships"];
};

/** Relative operation scheduling (2026-07-01, migration 20260701350000): add the optional
 *  "depends on another operation" columns to the generated plan_operations table entry. Both
 *  nullable — most operations leave them unset and behave exactly as before. */
type WithDependsOn<T extends { Row: object; Insert: object; Update: object; Relationships: unknown }> = {
  Row: T["Row"] & { depends_on_op_id: string | null; depends_on_offset_days: number | null };
  Insert: T["Insert"] & { depends_on_op_id?: string | null; depends_on_offset_days?: number | null };
  Update: T["Update"] & { depends_on_op_id?: string | null; depends_on_offset_days?: number | null };
  Relationships: T["Relationships"];
};

/** Add the operation-vocabulary harvest_stage column (migration 20260701230000) to
 *  plan_operations, preserving its relationships. */
type WithHarvestStage<T extends { Row: object; Insert: object; Update: object; Relationships: unknown }> = {
  Row: T["Row"] & { harvest_stage: string | null };
  Insert: T["Insert"] & { harvest_stage?: string | null };
  Update: T["Update"] & { harvest_stage?: string | null };
  Relationships: T["Relationships"];
};

/** Add the soil-test-driven irrigation record-keeping columns (migration 20260701330000) to
 *  plan_operations, preserving its relationships. */
type WithIrrigationBasis<T extends { Row: object; Insert: object; Update: object; Relationships: unknown }> = {
  Row: T["Row"] & { irrigation_basis: string | null; soil_moisture_reading: string | null };
  Insert: T["Insert"] & { irrigation_basis?: string | null; soil_moisture_reading?: string | null };
  Update: T["Update"] & { irrigation_basis?: string | null; soil_moisture_reading?: string | null };
  Relationships: T["Relationships"];
};

/** Add the labor-cost-basis person_id FK (migration 20260701250000) to an existing table entry. */
type WithLaborPersonId<T extends { Row: object; Insert: object; Update: object; Relationships: unknown }> = {
  Row: T["Row"] & { person_id: string | null };
  Insert: T["Insert"] & { person_id?: string | null };
  Update: T["Update"] & { person_id?: string | null };
  Relationships: T["Relationships"];
};

/** Add the pesticide-application compliance fields (migration 20260701320000) to
 *  plan_material_requirements, preserving its relationships. */
type WithSprayCompliance<T extends { Row: object; Insert: object; Update: object; Relationships: unknown }> = {
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
type WithOpNote<T extends { Row: object; Insert: object; Update: object; Relationships: unknown }> = {
  Row: T["Row"] & { note: string | null };
  Insert: T["Insert"] & { note?: string | null };
  Update: T["Update"] & { note?: string | null };
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
  //    migration 20260701330000 with two trailing OPTIONAL params so an irrigation op can record
  //    whether it was soil-test-driven (and the reading that justified it). Finally extended by
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
type ExpensePaymentStatus = "paid_from_custody" | "post_paid_unpaid" | "paid_by_owner" | "cancelled";
type ExpenseKind = "operating" | "drawing" | "capex";
type PaymentRoutingColumn = "payment_status" | "paid_by" | "kind";
type ExpenseDimensionColumn = "account_id" | "cost_center_id";

type CustodyAccountsTable = {
  Row: { id: string; org_id: string; holder_label: string; holder_user_id: string | null; target_float: number; active: boolean; created_at: string; created_by: string | null };
  Insert: Record<string, never>;
  Update: Record<string, never>;
  Relationships: [];
};
type CustodyMovementsTable = {
  Row: { id: string; org_id: string; custody_account_id: string; occurred_at: string; movement_type: string; amount_in: number; amount_out: number; expense_id: string | null; payment_request_id: string | null; journal_entry_id: string | null; transfer_group_id: string | null; note: string | null; created_at: string; created_by: string | null };
  Insert: Record<string, never>;
  Update: Record<string, never>;
  Relationships: [];
};
type PaymentRequestsTable = {
  Row: { id: string; org_id: string; request_no: number; period_start: string | null; period_end: string | null; status: string; custody_account_id: string | null; note: string | null; prepared_by: string | null; approved_op_by: string | null; approved_final_by: string | null; submitted_at: string | null; approved_op_at: string | null; approved_final_at: string | null; approved_post_paid_total: number | null; approved_custody_top_up: number | null; approved_net_request: number | null; created_at: string };
  Insert: Record<string, never>;
  Update: Record<string, never>;
  Relationships: [];
};
type PaymentRequestLinesTable = {
  Row: { id: string; org_id: string; payment_request_id: string; expense_id: string; paid_at: string | null; paid_by: string | null; paid_from_custody_account_id: string | null; custody_movement_id: string | null; journal_entry_id: string | null; created_at: string };
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
  Row: { id: string; org_id: string; entry_date: string; source_type: string; source_id: string; description: string | null; status: string; posted_at: string; posted_by: string | null; reversal_of: string | null; created_at: string };
  Insert: Record<string, never>;
  Update: Record<string, never>;
  Relationships: [];
};
type JournalLinesTable = {
  Row: { id: string; org_id: string; journal_entry_id: string; account_id: string; debit: number; credit: number; description: string | null; custody_account_id: string | null; custody_movement_id: string | null; expense_id: string | null; payment_request_id: string | null; cost_center_id: string | null; created_at: string };
  Insert: Record<string, never>;
  Update: Record<string, never>;
  Relationships: [];
};
type AccountingPeriodsTable = {
  Row: { id: string; org_id: string; period_start: string; period_end: string; status: string; note: string | null; locked_by: string | null; locked_at: string; reopened_by: string | null; reopened_at: string | null; created_at: string };
  Insert: Record<string, never>;
  Update: Record<string, never>;
  Relationships: [];
};
type PaymentRequestFundingsTable = {
  Row: { id: string; org_id: string; payment_request_id: string; custody_account_id: string; custody_movement_id: string | null; journal_entry_id: string | null; occurred_at: string; amount: number; note: string | null; created_at: string; created_by: string | null };
  Insert: Record<string, never>;
  Update: Record<string, never>;
  Relationships: [];
};
type BuyerType = "cash_customer" | "trader" | "company";
type SalePriceStatus = "pending" | "finalized";
type SalePaymentStatus = "unpaid" | "partially_collected" | "collected";
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
  Relationships: [];
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
type WithPaymentStatus<T extends { Row: object; Insert: object; Update: object; Relationships: unknown }> = {
  Row: Omit<T["Row"], PaymentRoutingColumn | ExpenseDimensionColumn> & {
    payment_status: ExpensePaymentStatus | null;
    paid_by: string | null;
    kind: ExpenseKind;
    account_id: string | null;
    cost_center_id: string | null;
  };
  Insert: Omit<T["Insert"], PaymentRoutingColumn | ExpenseDimensionColumn> & { account_id?: string | null; cost_center_id?: string | null };
  Update: Omit<T["Update"], PaymentRoutingColumn | ExpenseDimensionColumn> & { account_id?: string | null; cost_center_id?: string | null };
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
  fn_merge_accounts: { Args: { p_source: string; p_target: string }; Returns: Json };
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
  fn_merge_cost_centers: { Args: { p_source: string; p_target: string }; Returns: Json };
  fn_save_custody_account: {
    Args: {
      p_id: string | null;
      p_org: string | null;
      p_holder_label: string;
      p_holder_user_id?: string | null;
      p_target_float?: number;
      p_active?: boolean;
    };
    Returns: string;
  };
  fn_record_custody_movement: {
    Args: { p_account: string; p_movement_type: string; p_amount_in: number; p_amount_out: number; p_occurred_at?: string; p_expense_id?: string | null; p_note?: string | null };
    Returns: string;
  };
  fn_transfer_custody: {
    Args: { p_from_account: string; p_to_account: string; p_amount: number; p_occurred_at?: string; p_note?: string | null };
    Returns: string;
  };
  fn_set_expense_payment_status: {
    Args: { p_expense: string; p_status: ExpensePaymentStatus; p_custody_account?: string | null; p_paid_by?: string | null };
    Returns: undefined;
  };
  // Classify an expense (operating / drawing / capex) — the ONLY write path for expenses.kind (the column is
  // omitted from the expenses Insert type above, so it cannot be set by a direct insert). budget.write gated.
  fn_set_expense_kind: { Args: { p_id: string; p_kind: ExpenseKind }; Returns: Json };
  fn_custody_balance: { Args: { p_account: string }; Returns: number };
  fn_create_payment_request: {
    Args: { p_org: string; p_period_start?: string | null; p_period_end?: string | null; p_custody_account?: string | null; p_note?: string | null };
    Returns: string;
  };
  fn_add_expense_to_request: { Args: { p_request: string; p_expense: string }; Returns: string };
  fn_submit_payment_request: { Args: { p_request: string }; Returns: undefined };
  fn_approve_request_operational: { Args: { p_request: string }; Returns: undefined };
  fn_approve_request_final: { Args: { p_request: string }; Returns: undefined };
  fn_payment_request_totals: { Args: { p_request: string }; Returns: Json };
  fn_accounting_trial_balance: { Args: { p_org: string }; Returns: Json };
  fn_accounting_balance_sheet: { Args: { p_org: string; p_as_of?: string | null }; Returns: Json };
  fn_close_accounting_period: { Args: { p_org: string; p_period_start: string; p_period_end: string; p_note?: string | null }; Returns: string };
  fn_reopen_accounting_period: { Args: { p_org: string; p_period_id: string }; Returns: undefined };
  fn_custody_ledger_report: { Args: { p_org: string; p_period_start?: string | null; p_period_end?: string | null }; Returns: Json };
  fn_custody_cash_expense_report: { Args: { p_org: string; p_period_start?: string | null; p_period_end?: string | null }; Returns: Json };
  fn_unpaid_obligations_report: { Args: { p_org: string; p_as_of?: string | null }; Returns: Json };
  fn_owner_funding_report: { Args: { p_org: string; p_period_start?: string | null; p_period_end?: string | null }; Returns: Json };
  fn_record_payment_request_funding: {
    Args: { p_request: string; p_custody_account: string; p_amount: number; p_occurred_at?: string; p_note?: string | null };
    Returns: string;
  };
  fn_confirm_request_expense_paid: {
    Args: { p_request: string; p_expense: string; p_custody_account: string; p_occurred_at?: string; p_paid_by?: string | null; p_note?: string | null };
    Returns: string;
  };
  fn_close_payment_request: { Args: { p_request: string }; Returns: undefined };
};

// ── #398: who's assigned to a plan operation (migration 20260622000090). Augmented here because it
// predates the last database.types.ts regeneration. Insert/Update are intentionally Record<string,
// never> — the table is written ONLY via the gated RPCs (fn_add_plan_operation_multi to add,
// fn_unassign_plan_operation to remove); there is no direct-client-write path (mirrors CustodyAccountsTable). ──
type PlanOperationAssigneesTable = {
  Row: { id: string; org_id: string; plan_op_id: string; person_id: string; is_lead: boolean; created_at: string };
  Insert: Record<string, never>;
  Update: Record<string, never>;
  Relationships: [];
};

// ── "/finance/pnl" owner P&L period summary, migration 20260701270000. ──
// Narrowly-scoped, additive to the Stage-7 accounting framework (PR #368, still an unmerged draft) —
// NOT a replacement for `fn_accounting_pnl_summary`. finance.read gated (owner/accountant only).
type OwnerPnlFunctions = {
  fn_owner_pnl_summary: { Args: { p_org: string; p_from: string; p_to: string }; Returns: Json };
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
    },
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
    },
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
    },
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
type WithSignoff<T extends { Row: object; Insert: object; Update: object; Relationships: unknown }> = {
  Row: T["Row"] & { signed_off_by: string | null; signed_off_at: string | null };
  Insert: T["Insert"] & { signed_off_by?: string | null; signed_off_at?: string | null };
  Update: T["Update"] & { signed_off_by?: string | null; signed_off_at?: string | null };
  Relationships: T["Relationships"];
};
type SignoffFunctions = {
  fn_sign_off_plan_operation: { Args: { p_op_id: string }; Returns: Json };
};

// ── SPEC-0006 slice 2 — `labor_logs` (ACTUAL day-to-day attendance), migration 20260701310000. ──
// Augmented here until database.types.ts is regenerated from prod (then a harmless no-op).
type LaborLogsTable = {
  Row: {
    id: string;
    org_id: string;
    person_id: string | null;
    team_name: string | null;
    work_date: string;
    hours: number;
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
    },
  ];
};

// ── Public website content (SPEC public-website), migration 20260701420000. ──
// Org-scoped marketing content for the site at `/`. Reads = RLS-scoped authenticated SELECT (+ the
// service-role admin client for the public page); writes are RPC-only (client INSERT/UPDATE/DELETE
// revoked), so Insert/Update are `never`. fn_save_site_content is owner-gated (authorize('site.write')).
type SiteContentTable = {
  Row: { id: string; org_id: string; content: Json; updated_by: string | null; updated_at: string };
  Insert: Record<string, never>;
  Update: Record<string, never>;
  Relationships: [];
};
type SiteContentFunctions = {
  fn_save_site_content: { Args: { p_org: string; p_content: Json }; Returns: Json };
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
  fn_set_enquiry_status: { Args: { p_id: string; p_status: string }; Returns: undefined };
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
    Args: { p_id: string | null; p_org: string | null; p_name: string; p_buyer_type?: BuyerType | null; p_phone?: string | null; p_active?: boolean | null };
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
    Args: { p_sale: string; p_unit_price: number };
    Returns: Json;
  };
  fn_record_sale_collection: {
    Args: { p_sale: string; p_amount: number; p_occurred_at?: string | null; p_collected_by?: string | null; p_note?: string | null };
    Returns: Json;
  };
  fn_revenue_sales_report: {
    Args: { p_org: string; p_period_start?: string | null; p_period_end?: string | null; p_as_of?: string | null };
    Returns: Json;
  };
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
    > & {
      farms: WithArchived<Tables["farms"]>;
      sectors: WithArchived<Tables["sectors"]>;
      hawshat: WithArchived<Tables["hawshat"]>;
      lines: WithArchived<Tables["lines"]>;
      expenses: WithPaymentStatus<Tables["expenses"]>;
      plan_operations: WithOpNote<WithSignoff<WithDependsOn<WithIrrigationBasis<WithHarvestStage<Tables["plan_operations"]>>>>>;
      plan_material_requirements: WithSprayCompliance<Tables["plan_material_requirements"]>;
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
      plan_labor_requirements: WithLaborPersonId<Tables["plan_labor_requirements"]>;
      site_content: SiteContentTable;
      site_enquiries: SiteEnquiriesTable;
      offshoot_movements: OffshootMovementsTable;
      offshoot_valuation: OffshootValuationTable;
    };
    Functions: Public["Functions"] & StructFunctions & CustodyFunctions & OperationTemplateFunctions & OwnerPnlFunctions & WeatherFunctions & PestScoutingFunctions & SignoffFunctions & SiteContentFunctions & SiteEnquiriesFunctions & OffshootFunctions & RevenueFunctions & ScaleFunctions & HarvestFunctions;
  };
};

export type { Json };
