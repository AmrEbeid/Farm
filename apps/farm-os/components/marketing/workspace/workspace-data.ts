import type { MarketingDashboardSnapshot, MarketingWorkspaceAggregates } from "@/lib/marketing/queries";
import type { MarketingRecordRow } from "@/components/marketing/MarketingRecordTable";
import type { MarketingContactRow, MarketingContactActivityRow } from "@/components/marketing/MarketingContactTable";
import type { Json } from "@/lib/database.types.ext";

/** Everything `WorkspaceShell`/`WorkspaceArea` need, assembled once by the server page. */
export interface MarketingWorkspaceData {
  orgId: string;
  canWrite: boolean;
  canImport: boolean;
  dashboard: MarketingDashboardSnapshot;
  records: MarketingRecordRow[];
  recordsPage: number;
  recordsPages: number;
  sourceControlValues: Record<string, Json>;
  aggregates: MarketingWorkspaceAggregates;
  exporterContacts: MarketingContactRow[];
  kuwaitContacts: MarketingContactRow[];
  selectedContacts: MarketingContactRow[];
  selectedActivity: MarketingContactActivityRow[];
  exporterContactedCount: number;
  /** Full-directory ("buyer_lead") contacted count — a cheap DB aggregate, never the 1,513 rows themselves. */
  directoryContactedCount: number;
  directory: {
    rows: MarketingContactRow[];
    activity: MarketingContactActivityRow[];
    query: string;
    category: string | null;
    includeArchived: boolean;
    page: number;
    pages: number;
    total: number;
  };
  templateDefaults: Record<string, string>;
}
