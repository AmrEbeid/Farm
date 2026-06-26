// Generated Supabase types — DO NOT EDIT BY HAND.
//
// Source: prod schema, project veezkmytervjnpxcrbkw, public schema.
// Generated: 2026-06-25
//
// Regenerate via the Supabase CLI:
//   supabase gen types typescript --project-id veezkmytervjnpxcrbkw --schema public > apps/farm-os/lib/database.types.ts
// or via the Supabase MCP tool `generate_typescript_types` (project_id veezkmytervjnpxcrbkw).

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      assets: {
        Row: {
          archived: boolean
          hawsha_id: string | null
          health_status: string | null
          id: string
          id_tag: string | null
          line_id: string | null
          name: string | null
          org_id: string
          parent_id: string | null
          planting_date: string | null
          sector_id: string | null
          sex: string | null
          status: string
          type: string
          variety: string | null
        }
        Insert: {
          archived?: boolean
          hawsha_id?: string | null
          health_status?: string | null
          id?: string
          id_tag?: string | null
          line_id?: string | null
          name?: string | null
          org_id: string
          parent_id?: string | null
          planting_date?: string | null
          sector_id?: string | null
          sex?: string | null
          status?: string
          type?: string
          variety?: string | null
        }
        Update: {
          archived?: boolean
          hawsha_id?: string | null
          health_status?: string | null
          id?: string
          id_tag?: string | null
          line_id?: string | null
          name?: string | null
          org_id?: string
          parent_id?: string | null
          planting_date?: string | null
          sector_id?: string | null
          sex?: string | null
          status?: string
          type?: string
          variety?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assets_hawsha_id_fkey"
            columns: ["hawsha_id"]
            isOneToOne: false
            referencedRelation: "hawshat"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organization"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_sector_id_fkey"
            columns: ["sector_id"]
            isOneToOne: false
            referencedRelation: "sectors"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_user_id: string | null
          after: Json | null
          before: Json | null
          entity_id: string | null
          entity_type: string
          id: number
          occurred_at: string
          org_id: string
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          after?: Json | null
          before?: Json | null
          entity_id?: string | null
          entity_type: string
          id?: never
          occurred_at?: string
          org_id: string
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          after?: Json | null
          before?: Json | null
          entity_id?: string | null
          entity_type?: string
          id?: never
          occurred_at?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organization"
            referencedColumns: ["id"]
          },
        ]
      }
      budget_lines: {
        Row: {
          actual: number
          approved: number
          budget_id: string
          category: string | null
          committed: number
          id: string
          org_id: string
          planned: number
        }
        Insert: {
          actual?: number
          approved?: number
          budget_id: string
          category?: string | null
          committed?: number
          id?: string
          org_id: string
          planned?: number
        }
        Update: {
          actual?: number
          approved?: number
          budget_id?: string
          category?: string | null
          committed?: number
          id?: string
          org_id?: string
          planned?: number
        }
        Relationships: [
          {
            foreignKeyName: "budget_lines_budget_id_fkey"
            columns: ["budget_id"]
            isOneToOne: false
            referencedRelation: "budgets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_lines_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organization"
            referencedColumns: ["id"]
          },
        ]
      }
      budgets: {
        Row: {
          actual: number
          approved: number
          category: string | null
          committed: number
          id: string
          name: string | null
          org_id: string
          period: string | null
          planned: number
          scope_id: string | null
          scope_type: string | null
          status: string | null
        }
        Insert: {
          actual?: number
          approved?: number
          category?: string | null
          committed?: number
          id?: string
          name?: string | null
          org_id: string
          period?: string | null
          planned?: number
          scope_id?: string | null
          scope_type?: string | null
          status?: string | null
        }
        Update: {
          actual?: number
          approved?: number
          category?: string | null
          committed?: number
          id?: string
          name?: string | null
          org_id?: string
          period?: string | null
          planned?: number
          scope_id?: string | null
          scope_type?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "budgets_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organization"
            referencedColumns: ["id"]
          },
        ]
      }
      event_assets: {
        Row: {
          asset_id: string
          event_id: string
          org_id: string
        }
        Insert: {
          asset_id: string
          event_id: string
          org_id: string
        }
        Update: {
          asset_id?: string
          event_id?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_assets_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_assets_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organization"
            referencedColumns: ["id"]
          },
        ]
      }
      event_attachments: {
        Row: {
          checksum: string | null
          event_id: string
          id: string
          kind: string | null
          org_id: string
          storage_path: string | null
        }
        Insert: {
          checksum?: string | null
          event_id: string
          id?: string
          kind?: string | null
          org_id: string
          storage_path?: string | null
        }
        Update: {
          checksum?: string | null
          event_id?: string
          id?: string
          kind?: string | null
          org_id?: string
          storage_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_attachments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organization"
            referencedColumns: ["id"]
          },
        ]
      }
      event_followups: {
        Row: {
          assigned_to_person_id: string | null
          due_at: string | null
          event_id: string
          id: string
          note: string | null
          org_id: string
          status: string | null
        }
        Insert: {
          assigned_to_person_id?: string | null
          due_at?: string | null
          event_id: string
          id?: string
          note?: string | null
          org_id: string
          status?: string | null
        }
        Update: {
          assigned_to_person_id?: string | null
          due_at?: string | null
          event_id?: string
          id?: string
          note?: string | null
          org_id?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_followups_assigned_to_person_id_fkey"
            columns: ["assigned_to_person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_followups_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organization"
            referencedColumns: ["id"]
          },
        ]
      }
      event_locations: {
        Row: {
          event_id: string
          farm_id: string | null
          hawsha_id: string | null
          id: string
          line_id: string | null
          org_id: string
          sector_id: string | null
        }
        Insert: {
          event_id: string
          farm_id?: string | null
          hawsha_id?: string | null
          id?: string
          line_id?: string | null
          org_id: string
          sector_id?: string | null
        }
        Update: {
          event_id?: string
          farm_id?: string | null
          hawsha_id?: string | null
          id?: string
          line_id?: string | null
          org_id?: string
          sector_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_locations_farm_id_fkey"
            columns: ["farm_id"]
            isOneToOne: false
            referencedRelation: "farms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_locations_hawsha_id_fkey"
            columns: ["hawsha_id"]
            isOneToOne: false
            referencedRelation: "hawshat"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_locations_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_locations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organization"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_locations_sector_id_fkey"
            columns: ["sector_id"]
            isOneToOne: false
            referencedRelation: "sectors"
            referencedColumns: ["id"]
          },
        ]
      }
      event_status_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          event_id: string
          id: string
          org_id: string
          status: string | null
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          event_id: string
          id?: string
          org_id: string
          status?: string | null
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          event_id?: string
          id?: string
          org_id?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_status_history_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organization"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          approved_by: string | null
          category: string | null
          date: string | null
          description: string | null
          event_id: string | null
          farm_id: string | null
          hawsha_id: string | null
          id: string
          org_id: string
          payment_method: string | null
          plan_id: string | null
          qty: number | null
          recorded_by: string | null
          sector_id: string | null
          status: string | null
          supplier_id: string | null
          total: number | null
          unit: string | null
          unit_price: number | null
        }
        Insert: {
          approved_by?: string | null
          category?: string | null
          date?: string | null
          description?: string | null
          event_id?: string | null
          farm_id?: string | null
          hawsha_id?: string | null
          id?: string
          org_id: string
          payment_method?: string | null
          plan_id?: string | null
          qty?: number | null
          recorded_by?: string | null
          sector_id?: string | null
          status?: string | null
          supplier_id?: string | null
          total?: number | null
          unit?: string | null
          unit_price?: number | null
        }
        Update: {
          approved_by?: string | null
          category?: string | null
          date?: string | null
          description?: string | null
          event_id?: string | null
          farm_id?: string | null
          hawsha_id?: string | null
          id?: string
          org_id?: string
          payment_method?: string | null
          plan_id?: string | null
          qty?: number | null
          recorded_by?: string | null
          sector_id?: string | null
          status?: string | null
          supplier_id?: string | null
          total?: number | null
          unit?: string | null
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_farm_id_fkey"
            columns: ["farm_id"]
            isOneToOne: false
            referencedRelation: "farms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_hawsha_id_fkey"
            columns: ["hawsha_id"]
            isOneToOne: false
            referencedRelation: "hawshat"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organization"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_sector_id_fkey"
            columns: ["sector_id"]
            isOneToOne: false
            referencedRelation: "sectors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      farm_event: {
        Row: {
          assigned_to_person_id: string | null
          created_by: string | null
          data: Json
          enterprise_id: string | null
          id: string
          notes: string | null
          occurred_at: string
          org_id: string
          performed_by_person_id: string | null
          plan_id: string | null
          planned_at: string | null
          season_id: string | null
          status: string
          subtype: string | null
          type: string
        }
        Insert: {
          assigned_to_person_id?: string | null
          created_by?: string | null
          data?: Json
          enterprise_id?: string | null
          id?: string
          notes?: string | null
          occurred_at: string
          org_id: string
          performed_by_person_id?: string | null
          plan_id?: string | null
          planned_at?: string | null
          season_id?: string | null
          status?: string
          subtype?: string | null
          type: string
        }
        Update: {
          assigned_to_person_id?: string | null
          created_by?: string | null
          data?: Json
          enterprise_id?: string | null
          id?: string
          notes?: string | null
          occurred_at?: string
          org_id?: string
          performed_by_person_id?: string | null
          plan_id?: string | null
          planned_at?: string | null
          season_id?: string | null
          status?: string
          subtype?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "farm_event_assigned_to_person_id_fkey"
            columns: ["assigned_to_person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "farm_event_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organization"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "farm_event_performed_by_person_id_fkey"
            columns: ["performed_by_person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      farm_event_2025_07: {
        Row: {
          assigned_to_person_id: string | null
          created_by: string | null
          data: Json
          enterprise_id: string | null
          id: string
          notes: string | null
          occurred_at: string
          org_id: string
          performed_by_person_id: string | null
          plan_id: string | null
          planned_at: string | null
          season_id: string | null
          status: string
          subtype: string | null
          type: string
        }
        Insert: {
          assigned_to_person_id?: string | null
          created_by?: string | null
          data?: Json
          enterprise_id?: string | null
          id?: string
          notes?: string | null
          occurred_at: string
          org_id: string
          performed_by_person_id?: string | null
          plan_id?: string | null
          planned_at?: string | null
          season_id?: string | null
          status?: string
          subtype?: string | null
          type: string
        }
        Update: {
          assigned_to_person_id?: string | null
          created_by?: string | null
          data?: Json
          enterprise_id?: string | null
          id?: string
          notes?: string | null
          occurred_at?: string
          org_id?: string
          performed_by_person_id?: string | null
          plan_id?: string | null
          planned_at?: string | null
          season_id?: string | null
          status?: string
          subtype?: string | null
          type?: string
        }
        Relationships: []
      }
      farm_event_2025_08: {
        Row: {
          assigned_to_person_id: string | null
          created_by: string | null
          data: Json
          enterprise_id: string | null
          id: string
          notes: string | null
          occurred_at: string
          org_id: string
          performed_by_person_id: string | null
          plan_id: string | null
          planned_at: string | null
          season_id: string | null
          status: string
          subtype: string | null
          type: string
        }
        Insert: {
          assigned_to_person_id?: string | null
          created_by?: string | null
          data?: Json
          enterprise_id?: string | null
          id?: string
          notes?: string | null
          occurred_at: string
          org_id: string
          performed_by_person_id?: string | null
          plan_id?: string | null
          planned_at?: string | null
          season_id?: string | null
          status?: string
          subtype?: string | null
          type: string
        }
        Update: {
          assigned_to_person_id?: string | null
          created_by?: string | null
          data?: Json
          enterprise_id?: string | null
          id?: string
          notes?: string | null
          occurred_at?: string
          org_id?: string
          performed_by_person_id?: string | null
          plan_id?: string | null
          planned_at?: string | null
          season_id?: string | null
          status?: string
          subtype?: string | null
          type?: string
        }
        Relationships: []
      }
      farm_event_default: {
        Row: {
          assigned_to_person_id: string | null
          created_by: string | null
          data: Json
          enterprise_id: string | null
          id: string
          notes: string | null
          occurred_at: string
          org_id: string
          performed_by_person_id: string | null
          plan_id: string | null
          planned_at: string | null
          season_id: string | null
          status: string
          subtype: string | null
          type: string
        }
        Insert: {
          assigned_to_person_id?: string | null
          created_by?: string | null
          data?: Json
          enterprise_id?: string | null
          id?: string
          notes?: string | null
          occurred_at: string
          org_id: string
          performed_by_person_id?: string | null
          plan_id?: string | null
          planned_at?: string | null
          season_id?: string | null
          status?: string
          subtype?: string | null
          type: string
        }
        Update: {
          assigned_to_person_id?: string | null
          created_by?: string | null
          data?: Json
          enterprise_id?: string | null
          id?: string
          notes?: string | null
          occurred_at?: string
          org_id?: string
          performed_by_person_id?: string | null
          plan_id?: string | null
          planned_at?: string | null
          season_id?: string | null
          status?: string
          subtype?: string | null
          type?: string
        }
        Relationships: []
      }
      farms: {
        Row: {
          area_feddan: number | null
          code: string
          id: string
          main_crop: string | null
          manager_person_id: string | null
          name: string
          notes: string | null
          org_id: string
          owner_person_id: string | null
        }
        Insert: {
          area_feddan?: number | null
          code: string
          id?: string
          main_crop?: string | null
          manager_person_id?: string | null
          name: string
          notes?: string | null
          org_id: string
          owner_person_id?: string | null
        }
        Update: {
          area_feddan?: number | null
          code?: string
          id?: string
          main_crop?: string | null
          manager_person_id?: string | null
          name?: string
          notes?: string | null
          org_id?: string
          owner_person_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "farms_manager_person_id_fkey"
            columns: ["manager_person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "farms_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organization"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "farms_owner_person_id_fkey"
            columns: ["owner_person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      hawshat: {
        Row: {
          area_qirat: number | null
          code: string
          id: string
          name: string
          notes: string | null
          org_id: string
          palm_count_barhi: number | null
          palm_count_male: number | null
          planting_date: string | null
          row_count: number | null
          sector_id: string
        }
        Insert: {
          area_qirat?: number | null
          code: string
          id?: string
          name: string
          notes?: string | null
          org_id: string
          palm_count_barhi?: number | null
          palm_count_male?: number | null
          planting_date?: string | null
          row_count?: number | null
          sector_id: string
        }
        Update: {
          area_qirat?: number | null
          code?: string
          id?: string
          name?: string
          notes?: string | null
          org_id?: string
          palm_count_barhi?: number | null
          palm_count_male?: number | null
          planting_date?: string | null
          row_count?: number | null
          sector_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hawshat_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organization"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hawshat_sector_id_fkey"
            columns: ["sector_id"]
            isOneToOne: false
            referencedRelation: "sectors"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_bin: {
        Row: {
          item_id: string
          location: string
          on_hand: number
          ordered: number
          org_id: string
          projected: number
          reserved: number
        }
        Insert: {
          item_id: string
          location?: string
          on_hand?: number
          ordered?: number
          org_id: string
          projected?: number
          reserved?: number
        }
        Update: {
          item_id?: string
          location?: string
          on_hand?: number
          ordered?: number
          org_id?: string
          projected?: number
          reserved?: number
        }
        Relationships: [
          {
            foreignKeyName: "inventory_bin_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_bin_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organization"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_items: {
        Row: {
          category: string | null
          criticality: string | null
          expiry_tracked: boolean
          id: string
          lead_time_days: number | null
          max_stock: number | null
          min_stock: number | null
          name: string
          org_id: string
          pack_size: number | null
          preferred_supplier_id: string | null
          reorder_point: number | null
          reorder_qty: number | null
          safety_stock: number | null
          unit: string | null
        }
        Insert: {
          category?: string | null
          criticality?: string | null
          expiry_tracked?: boolean
          id?: string
          lead_time_days?: number | null
          max_stock?: number | null
          min_stock?: number | null
          name: string
          org_id: string
          pack_size?: number | null
          preferred_supplier_id?: string | null
          reorder_point?: number | null
          reorder_qty?: number | null
          safety_stock?: number | null
          unit?: string | null
        }
        Update: {
          category?: string | null
          criticality?: string | null
          expiry_tracked?: boolean
          id?: string
          lead_time_days?: number | null
          max_stock?: number | null
          min_stock?: number | null
          name?: string
          org_id?: string
          pack_size?: number | null
          preferred_supplier_id?: string | null
          reorder_point?: number | null
          reorder_qty?: number | null
          safety_stock?: number | null
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_items_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organization"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_preferred_supplier_id_fkey"
            columns: ["preferred_supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_movements: {
        Row: {
          batch_no: string | null
          event_id: string | null
          expiry_date: string | null
          id: string
          item_id: string
          location: string
          occurred_at: string
          org_id: string
          plan_id: string | null
          qty: number
          supplier_id: string | null
          type: string
          unit: string | null
          unit_cost: number | null
        }
        Insert: {
          batch_no?: string | null
          event_id?: string | null
          expiry_date?: string | null
          id?: string
          item_id: string
          location?: string
          occurred_at?: string
          org_id: string
          plan_id?: string | null
          qty: number
          supplier_id?: string | null
          type: string
          unit?: string | null
          unit_cost?: number | null
        }
        Update: {
          batch_no?: string | null
          event_id?: string | null
          expiry_date?: string | null
          id?: string
          item_id?: string
          location?: string
          occurred_at?: string
          org_id?: string
          plan_id?: string | null
          qty?: number
          supplier_id?: string | null
          type?: string
          unit?: string | null
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organization"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      lines: {
        Row: {
          direction: string | null
          hawsha_id: string
          id: string
          line_code: string | null
          line_no: number
          notes: string | null
          org_id: string
          palm_count: number | null
        }
        Insert: {
          direction?: string | null
          hawsha_id: string
          id?: string
          line_code?: string | null
          line_no: number
          notes?: string | null
          org_id: string
          palm_count?: number | null
        }
        Update: {
          direction?: string | null
          hawsha_id?: string
          id?: string
          line_code?: string | null
          line_no?: number
          notes?: string | null
          org_id?: string
          palm_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "lines_hawsha_id_fkey"
            columns: ["hawsha_id"]
            isOneToOne: false
            referencedRelation: "hawshat"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lines_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organization"
            referencedColumns: ["id"]
          },
        ]
      }
      organization: {
        Row: {
          area_unit: string
          created_at: string
          currency: string
          fiscal_year_start: string | null
          id: string
          locale: string
          name: string
          settings: Json
        }
        Insert: {
          area_unit?: string
          created_at?: string
          currency?: string
          fiscal_year_start?: string | null
          id?: string
          locale?: string
          name: string
          settings?: Json
        }
        Update: {
          area_unit?: string
          created_at?: string
          currency?: string
          fiscal_year_start?: string | null
          id?: string
          locale?: string
          name?: string
          settings?: Json
        }
        Relationships: []
      }
      organization_member: {
        Row: {
          created_at: string
          org_id: string
          role: string
          scope: Json
          user_id: string
        }
        Insert: {
          created_at?: string
          org_id: string
          role: string
          scope?: Json
          user_id: string
        }
        Update: {
          created_at?: string
          org_id?: string
          role?: string
          scope?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_member_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organization"
            referencedColumns: ["id"]
          },
        ]
      }
      palm_status_history: {
        Row: {
          asset_id: string
          changed_at: string
          changed_by: string | null
          health_status: string | null
          id: string
          org_id: string
          reason: string | null
          status: string | null
        }
        Insert: {
          asset_id: string
          changed_at?: string
          changed_by?: string | null
          health_status?: string | null
          id?: string
          org_id: string
          reason?: string | null
          status?: string | null
        }
        Update: {
          asset_id?: string
          changed_at?: string
          changed_by?: string | null
          health_status?: string | null
          id?: string
          org_id?: string
          reason?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "palm_status_history_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "palm_status_history_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organization"
            referencedColumns: ["id"]
          },
        ]
      }
      people: {
        Row: {
          active: boolean
          created_at: string
          email: string | null
          employment_type: string | null
          id: string
          name: string
          org_id: string
          phone: string | null
          position: string | null
          rate: number | null
          reports_to_person_id: string | null
          user_id: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          email?: string | null
          employment_type?: string | null
          id?: string
          name: string
          org_id: string
          phone?: string | null
          position?: string | null
          rate?: number | null
          reports_to_person_id?: string | null
          user_id?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          email?: string | null
          employment_type?: string | null
          id?: string
          name?: string
          org_id?: string
          phone?: string | null
          position?: string | null
          rate?: number | null
          reports_to_person_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "people_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organization"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "people_reports_to_person_id_fkey"
            columns: ["reports_to_person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_checks: {
        Row: {
          detail: Json | null
          id: string
          kind: string
          org_id: string
          plan_id: string
          result: string | null
        }
        Insert: {
          detail?: Json | null
          id?: string
          kind: string
          org_id: string
          plan_id: string
          result?: string | null
        }
        Update: {
          detail?: Json | null
          id?: string
          kind?: string
          org_id?: string
          plan_id?: string
          result?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plan_checks_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organization"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_checks_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_labor_requirements: {
        Row: {
          count: number | null
          days: number | null
          id: string
          org_id: string
          person_or_team: string | null
          plan_op_id: string
        }
        Insert: {
          count?: number | null
          days?: number | null
          id?: string
          org_id: string
          person_or_team?: string | null
          plan_op_id: string
        }
        Update: {
          count?: number | null
          days?: number | null
          id?: string
          org_id?: string
          person_or_team?: string | null
          plan_op_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_labor_requirements_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organization"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_labor_requirements_plan_op_id_fkey"
            columns: ["plan_op_id"]
            isOneToOne: false
            referencedRelation: "plan_operations"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_material_requirements: {
        Row: {
          id: string
          item_id: string
          org_id: string
          plan_op_id: string
          qty: number | null
          unit: string | null
        }
        Insert: {
          id?: string
          item_id: string
          org_id: string
          plan_op_id: string
          qty?: number | null
          unit?: string | null
        }
        Update: {
          id?: string
          item_id?: string
          org_id?: string
          plan_op_id?: string
          qty?: number | null
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plan_material_requirements_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_material_requirements_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organization"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_material_requirements_plan_op_id_fkey"
            columns: ["plan_op_id"]
            isOneToOne: false
            referencedRelation: "plan_operations"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_operations: {
        Row: {
          approval_needed: boolean
          est_cost: number | null
          id: string
          org_id: string
          plan_id: string
          planned_at: string | null
          priority: number | null
          responsible_person_id: string | null
          status: string
          subtype: string | null
          target_id: string | null
          target_type: string | null
        }
        Insert: {
          approval_needed?: boolean
          est_cost?: number | null
          id?: string
          org_id: string
          plan_id: string
          planned_at?: string | null
          priority?: number | null
          responsible_person_id?: string | null
          status?: string
          subtype?: string | null
          target_id?: string | null
          target_type?: string | null
        }
        Update: {
          approval_needed?: boolean
          est_cost?: number | null
          id?: string
          org_id?: string
          plan_id?: string
          planned_at?: string | null
          priority?: number | null
          responsible_person_id?: string | null
          status?: string
          subtype?: string | null
          target_id?: string | null
          target_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plan_operations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organization"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_operations_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_operations_responsible_person_id_fkey"
            columns: ["responsible_person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          id: string
          org_id: string
          period_end: string | null
          period_start: string | null
          scope_id: string | null
          scope_type: string | null
          status: string
          type: string | null
        }
        Insert: {
          id?: string
          org_id: string
          period_end?: string | null
          period_start?: string | null
          scope_id?: string | null
          scope_type?: string | null
          status?: string
          type?: string | null
        }
        Update: {
          id?: string
          org_id?: string
          period_end?: string | null
          period_start?: string | null
          scope_id?: string | null
          scope_type?: string | null
          status?: string
          type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plans_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organization"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_request_items: {
        Row: {
          est_cost: number | null
          id: string
          item_id: string
          org_id: string
          pr_id: string
          qty: number | null
          supplier_id: string | null
          unit: string | null
        }
        Insert: {
          est_cost?: number | null
          id?: string
          item_id: string
          org_id: string
          pr_id: string
          qty?: number | null
          supplier_id?: string | null
          unit?: string | null
        }
        Update: {
          est_cost?: number | null
          id?: string
          item_id?: string
          org_id?: string
          pr_id?: string
          qty?: number | null
          supplier_id?: string | null
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_request_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_request_items_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organization"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_request_items_pr_id_fkey"
            columns: ["pr_id"]
            isOneToOne: false
            referencedRelation: "purchase_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_request_items_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_requests: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          budget_category_id: string | null
          code: string
          event_id: string | null
          id: string
          needed_by: string | null
          org_id: string
          plan_id: string | null
          reason: string | null
          requested_by: string | null
          status: string
          version: number
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          budget_category_id?: string | null
          code: string
          event_id?: string | null
          id?: string
          needed_by?: string | null
          org_id: string
          plan_id?: string | null
          reason?: string | null
          requested_by?: string | null
          status?: string
          version?: number
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          budget_category_id?: string | null
          code?: string
          event_id?: string | null
          id?: string
          needed_by?: string | null
          org_id?: string
          plan_id?: string | null
          reason?: string | null
          requested_by?: string | null
          status?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_requests_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organization"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_requests_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      quantities: {
        Row: {
          event_id: string
          id: string
          inventory_adjustment: number | null
          label: string | null
          material_id: string | null
          measure: string | null
          org_id: string
          unit_term_id: string | null
          value_den: number | null
          value_num: number | null
        }
        Insert: {
          event_id: string
          id?: string
          inventory_adjustment?: number | null
          label?: string | null
          material_id?: string | null
          measure?: string | null
          org_id: string
          unit_term_id?: string | null
          value_den?: number | null
          value_num?: number | null
        }
        Update: {
          event_id?: string
          id?: string
          inventory_adjustment?: number | null
          label?: string | null
          material_id?: string | null
          measure?: string | null
          org_id?: string
          unit_term_id?: string | null
          value_den?: number | null
          value_num?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "quantities_material_fk"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quantities_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organization"
            referencedColumns: ["id"]
          },
        ]
      }
      responsibility_assignments: {
        Row: {
          id: string
          org_id: string
          person_id: string
          responsibility_type: string
          scope_id: string | null
          scope_type: string
        }
        Insert: {
          id?: string
          org_id: string
          person_id: string
          responsibility_type: string
          scope_id?: string | null
          scope_type: string
        }
        Update: {
          id?: string
          org_id?: string
          person_id?: string
          responsibility_type?: string
          scope_id?: string | null
          scope_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "responsibility_assignments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organization"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "responsibility_assignments_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      sectors: {
        Row: {
          area_feddan: number | null
          code: string
          crop: string | null
          farm_id: string
          id: string
          name: string
          notes: string | null
          org_id: string
          planting_date: string | null
        }
        Insert: {
          area_feddan?: number | null
          code: string
          crop?: string | null
          farm_id: string
          id?: string
          name: string
          notes?: string | null
          org_id: string
          planting_date?: string | null
        }
        Update: {
          area_feddan?: number | null
          code?: string
          crop?: string | null
          farm_id?: string
          id?: string
          name?: string
          notes?: string | null
          org_id?: string
          planting_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sectors_farm_id_fkey"
            columns: ["farm_id"]
            isOneToOne: false
            referencedRelation: "farms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sectors_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organization"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          id: string
          lead_time_days: number | null
          name: string
          org_id: string
          phone: string | null
          terms: string | null
        }
        Insert: {
          id?: string
          lead_time_days?: number | null
          name: string
          org_id: string
          phone?: string | null
          terms?: string | null
        }
        Update: {
          id?: string
          lead_time_days?: number | null
          name?: string
          org_id?: string
          phone?: string | null
          terms?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organization"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      pg_all_foreign_keys: {
        Row: {
          fk_columns: unknown[] | null
          fk_constraint_name: unknown
          fk_schema_name: unknown
          fk_table_name: unknown
          fk_table_oid: unknown
          is_deferrable: boolean | null
          is_deferred: boolean | null
          match_type: string | null
          on_delete: string | null
          on_update: string | null
          pk_columns: unknown[] | null
          pk_constraint_name: unknown
          pk_index_name: unknown
          pk_schema_name: unknown
          pk_table_name: unknown
          pk_table_oid: unknown
        }
        Relationships: []
      }
      tap_funky: {
        Row: {
          args: string | null
          is_definer: boolean | null
          is_strict: boolean | null
          is_visible: boolean | null
          kind: unknown
          langoid: unknown
          name: unknown
          oid: unknown
          owner: unknown
          returns: string | null
          returns_set: boolean | null
          schema: unknown
          volatility: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _cleanup: { Args: never; Returns: boolean }
      _contract_on: { Args: { "": string }; Returns: unknown }
      _currtest: { Args: never; Returns: number }
      _db_privs: { Args: never; Returns: unknown[] }
      _extensions: { Args: never; Returns: unknown[] }
      _get: { Args: { "": string }; Returns: number }
      _get_latest: { Args: { "": string }; Returns: number[] }
      _get_note: { Args: { "": string }; Returns: string }
      _is_verbose: { Args: never; Returns: boolean }
      _prokind: { Args: { p_oid: unknown }; Returns: unknown }
      _query: { Args: { "": string }; Returns: string }
      _refine_vol: { Args: { "": string }; Returns: string }
      _retval: { Args: { "": string }; Returns: string }
      _table_privs: { Args: never; Returns: unknown[] }
      _temptypes: { Args: { "": string }; Returns: string }
      _todo: { Args: never; Returns: string }
      authorize: { Args: { perm: string; p_org: string }; Returns: boolean }
      col_is_null:
        | {
            Args: {
              column_name: unknown
              description?: string
              schema_name: unknown
              table_name: unknown
            }
            Returns: string
          }
        | {
            Args: {
              column_name: unknown
              description?: string
              table_name: unknown
            }
            Returns: string
          }
      col_not_null:
        | {
            Args: {
              column_name: unknown
              description?: string
              schema_name: unknown
              table_name: unknown
            }
            Returns: string
          }
        | {
            Args: {
              column_name: unknown
              description?: string
              table_name: unknown
            }
            Returns: string
          }
      diag:
        | {
            Args: { msg: unknown }
            Returns: {
              error: true
            } & "Could not choose the best candidate function between: public.diag(msg => text), public.diag(msg => anyelement). Try renaming the parameters or the function itself in the database so function overloading can be resolved"
          }
        | {
            Args: { msg: string }
            Returns: {
              error: true
            } & "Could not choose the best candidate function between: public.diag(msg => text), public.diag(msg => anyelement). Try renaming the parameters or the function itself in the database so function overloading can be resolved"
          }
      diag_test_name: { Args: { "": string }; Returns: string }
      do_tap:
        | { Args: never; Returns: string[] }
        | { Args: { "": string }; Returns: string[] }
      fail:
        | { Args: never; Returns: string }
        | { Args: { "": string }; Returns: string }
      findfuncs: { Args: { "": string }; Returns: string[] }
      finish: { Args: { exception_on_failure?: boolean }; Returns: string[] }
      fn_bin_rebuild: {
        Args: { p_item: string; p_location?: string }
        Returns: number
      }
      fn_execute_operation: {
        Args: {
          p_actual_qty: number
          p_labor_count: number
          p_note?: string
          p_op_id: string
        }
        Returns: Json
      }
      fn_post_movement: {
        Args: {
          p_event_id?: string
          p_item: string
          p_location?: string
          p_occurred_at?: string
          p_plan_id?: string
          p_qty: number
          p_supplier_id?: string
          p_type: string
          p_unit?: string
          p_unit_cost?: number
        }
        Returns: number
      }
      fn_post_receipt: {
        Args: { p_pr_id: string }
        Returns: Json
      }
      fn_stock_coverage: {
        Args: { p_horizon_weeks?: number; p_item: string; p_location?: string }
        Returns: Json
      }
      format_type_string: { Args: { "": string }; Returns: string }
      has_unique: { Args: { "": string }; Returns: string }
      in_todo: { Args: never; Returns: boolean }
      is_empty: { Args: { "": string }; Returns: string }
      isnt_empty: { Args: { "": string }; Returns: string }
      lives_ok: { Args: { "": string }; Returns: string }
      no_plan: { Args: never; Returns: boolean[] }
      num_failed: { Args: never; Returns: number }
      os_name: { Args: never; Returns: string }
      pass:
        | { Args: never; Returns: string }
        | { Args: { "": string }; Returns: string }
      pg_version: { Args: never; Returns: string }
      pg_version_num: { Args: never; Returns: number }
      pgtap_version: { Args: never; Returns: number }
      runtests:
        | { Args: never; Returns: string[] }
        | { Args: { "": string }; Returns: string[] }
      skip:
        | { Args: { "": string }; Returns: string }
        | { Args: { how_many: number; why: string }; Returns: string }
      throws_ok: { Args: { "": string }; Returns: string }
      todo:
        | { Args: { how_many: number }; Returns: boolean[] }
        | { Args: { how_many: number; why: string }; Returns: boolean[] }
        | { Args: { why: string }; Returns: boolean[] }
        | { Args: { how_many: number; why: string }; Returns: boolean[] }
      todo_end: { Args: never; Returns: boolean[] }
      todo_start:
        | { Args: never; Returns: boolean[] }
        | { Args: { "": string }; Returns: boolean[] }
      user_org_ids: { Args: never; Returns: string[] }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      _time_trial_type: {
        a_time: number | null
      }
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
