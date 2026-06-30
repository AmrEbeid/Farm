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

type Public = Generated["public"];
type Tables = Public["Tables"];

/** Add the soft-delete flag to an existing generated table entry, preserving its relationships. */
type WithArchived<T extends { Row: object; Insert: object; Update: object; Relationships: unknown }> = {
  Row: T["Row"] & { archived: boolean };
  Insert: T["Insert"] & { archived?: boolean };
  Update: T["Update"] & { archived?: boolean };
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
  //    assignees), migrations 0090 (schema) / 0093 (RPC). p_materials/p_labor are jsonb line arrays. ──
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
    };
    Returns: Json;
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
};

// ── SPEC-0018 «العهدة وطلبات الصرف» — custody + payment requests. ──
// Augmented here until database.types.ts is regenerated from prod (then a harmless no-op).
type ExpensePaymentStatus = "paid_from_custody" | "post_paid_unpaid" | "paid_by_owner" | "cancelled";
type ExpenseKind = "operating" | "drawing" | "capex";
type PaymentRoutingColumn = "payment_status" | "paid_by" | "kind";

type CustodyAccountsTable = {
  Row: { id: string; org_id: string; holder_label: string; holder_user_id: string | null; target_float: number; active: boolean; created_at: string; created_by: string | null };
  Insert: Record<string, never>;
  Update: Record<string, never>;
  Relationships: [];
};
type CustodyMovementsTable = {
  Row: { id: string; org_id: string; custody_account_id: string; occurred_at: string; movement_type: string; amount_in: number; amount_out: number; expense_id: string | null; note: string | null; created_at: string; created_by: string | null };
  Insert: Record<string, never>;
  Update: Record<string, never>;
  Relationships: [];
};
type PaymentRequestsTable = {
  Row: { id: string; org_id: string; request_no: number; period_start: string | null; period_end: string | null; status: string; custody_account_id: string | null; note: string | null; prepared_by: string | null; approved_op_by: string | null; approved_final_by: string | null; submitted_at: string | null; approved_op_at: string | null; approved_final_at: string | null; created_at: string };
  Insert: Record<string, never>;
  Update: Record<string, never>;
  Relationships: [];
};
type PaymentRequestLinesTable = {
  Row: { id: string; org_id: string; payment_request_id: string; expense_id: string; created_at: string };
  Insert: Record<string, never>;
  Update: Record<string, never>;
  Relationships: [];
};
/** Add the SPEC-0018 payment-routing columns to the generated expenses table. */
type WithPaymentStatus<T extends { Row: object; Insert: object; Update: object; Relationships: unknown }> = {
  Row: Omit<T["Row"], PaymentRoutingColumn> & {
    payment_status: ExpensePaymentStatus | null;
    paid_by: string | null;
    kind: ExpenseKind;
  };
  Insert: Omit<T["Insert"], PaymentRoutingColumn>;
  Update: Omit<T["Update"], PaymentRoutingColumn>;
  Relationships: T["Relationships"];
};
type CustodyFunctions = {
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
  fn_set_expense_payment_status: {
    Args: { p_expense: string; p_status: ExpensePaymentStatus; p_custody_account?: string | null; p_paid_by?: string | null };
    Returns: undefined;
  };
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
};

export type Database = Omit<Generated, "public"> & {
  public: Omit<Public, "Tables" | "Functions"> & {
    Tables: Omit<Tables, "farms" | "sectors" | "hawshat" | "lines" | "expenses"> & {
      farms: WithArchived<Tables["farms"]>;
      sectors: WithArchived<Tables["sectors"]>;
      hawshat: WithArchived<Tables["hawshat"]>;
      lines: WithArchived<Tables["lines"]>;
      expenses: WithPaymentStatus<Tables["expenses"]>;
      attachments: AttachmentsTable;
      custody_accounts: CustodyAccountsTable;
      custody_movements: CustodyMovementsTable;
      payment_requests: PaymentRequestsTable;
      payment_request_lines: PaymentRequestLinesTable;
    };
    Functions: Public["Functions"] & StructFunctions & CustodyFunctions;
  };
};

export type { Json };
