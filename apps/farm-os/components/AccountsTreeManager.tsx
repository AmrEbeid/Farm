"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { egp, num } from "@/lib/money";
import { Alert, Button, ConfirmDialog, Field, Input, Tag, useToast } from "@/components/ui";
import { useSubmit } from "@/components/useSubmit";
import {
  archiveAccount,
  mergeAccounts,
  saveAccount,
  type AccountKind,
  type AccountType,
  type NormalBalance,
} from "@/app/(app)/finance/accounts/actions";

export interface AccountNode {
  id: string;
  code: string;
  nameAr: string;
  accountType: AccountType;
  normalBalance: NormalBalance;
  parentId: string | null;
  kind: AccountKind | null;
  isSystem: boolean;
  sortOrder: number | null;
  active: boolean;
  debit: number;
  credit: number;
  balance: number;
}

type FormState =
  | { mode: "add-root"; parent: null; editing: null }
  | { mode: "add-child"; parent: AccountNode; editing: null }
  | { mode: "edit"; parent: null; editing: AccountNode };

const TYPE_AR: Record<AccountType, string> = {
  asset: "أصل",
  liability: "التزام",
  equity: "حقوق ملكية",
  revenue: "إيراد",
  expense: "مصروف",
};

const BALANCE_AR: Record<NormalBalance, string> = {
  debit: "مدين",
  credit: "دائن",
};

const KIND_AR: Record<AccountKind, string> = {
  operating: "تشغيلي",
  drawing: "مسحوبات",
  capex: "رأسمالي",
};

const KIND_FOR_TYPE: Record<AccountType, AccountKind[]> = {
  asset: ["capex"],
  liability: [],
  equity: ["drawing"],
  revenue: [],
  expense: ["operating"],
};

const SELECT_CLASS = "w-full rounded-md px-3 py-2 text-sm";
const SELECT_STYLE = { border: "1px solid var(--line)", background: "var(--surface)" } as const;

function sortAccounts(a: AccountNode, b: AccountNode): number {
  return (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999) || a.code.localeCompare(b.code, "ar");
}

function buildTree(nodes: AccountNode[]): Map<string | null, AccountNode[]> {
  const children = new Map<string | null, AccountNode[]>();
  for (const node of [...nodes].sort(sortAccounts)) {
    const key = node.parentId;
    children.set(key, [...(children.get(key) ?? []), node]);
  }
  return children;
}

function flattenTree(children: Map<string | null, AccountNode[]>): { node: AccountNode; depth: number }[] {
  const rows: { node: AccountNode; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const node of children.get(parentId) ?? []) {
      rows.push({ node, depth });
      walk(node.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

function isLeaf(node: AccountNode, children: Map<string | null, AccountNode[]>): boolean {
  return !(children.get(node.id) ?? []).some((child) => child.active);
}

function descendantIds(node: AccountNode, children: Map<string | null, AccountNode[]>): Set<string> {
  const ids = new Set<string>();
  const walk = (parentId: string) => {
    for (const child of children.get(parentId) ?? []) {
      ids.add(child.id);
      walk(child.id);
    }
  };
  walk(node.id);
  return ids;
}

function isAccountKind(value: string): value is AccountKind {
  return value === "operating" || value === "drawing" || value === "capex";
}

/** Interactive chart-of-accounts tree. System accounts render rename-only; all
 * structural writes go through the audited database RPCs. */
export function AccountsTreeManager({ nodes }: { nodes: AccountNode[] }) {
  const router = useRouter();
  const toast = useToast();
  const children = useMemo(() => buildTree(nodes), [nodes]);
  const rendered = useMemo(() => flattenTree(children), [children]);
  const [form, setForm] = useState<FormState | null>(null);
  const [mergeSource, setMergeSource] = useState<AccountNode | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<AccountNode | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const { pending: archivePending, submit: submitArchive } = useSubmit();

  const activeCount = nodes.filter((node) => node.active).length;
  const archivedCount = nodes.length - activeCount;

  async function confirmArchive() {
    if (!archiveTarget) return;
    setArchiveError(null);
    const result = await submitArchive(() => archiveAccount(archiveTarget.id));
    if (!result.ok) {
      setArchiveError(result.error ?? "تعذّرت الأرشفة");
      return;
    }
    toast.ok("تمت أرشفة الحساب");
    setArchiveTarget(null);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2 text-sm" style={{ color: "var(--ink-muted)" }}>
          <span>{num(activeCount)} حساب نشط</span>
          {archivedCount > 0 && <span>{num(archivedCount)} مؤرشف</span>}
        </div>
        <Button variant="ghost" onClick={() => setForm({ mode: "add-root", parent: null, editing: null })}>
          + حساب رئيسي
        </Button>
      </div>

      {archiveError && <Alert tone="danger" title={archiveError} />}

      {form && (
        <AccountForm
          key={`${form.mode}:${form.parent?.id ?? form.editing?.id ?? "root"}`}
          state={form}
          nodes={nodes}
          childMap={children}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            toast.ok("تم حفظ الحساب");
            router.refresh();
          }}
        />
      )}

      {mergeSource && (
        <MergeForm
          key={mergeSource.id}
          source={mergeSource}
          nodes={nodes}
          childMap={children}
          onClose={() => setMergeSource(null)}
          onMerged={() => {
            setMergeSource(null);
            toast.ok("تم دمج الحساب");
            router.refresh();
          }}
        />
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-separate border-spacing-0 text-sm">
          <thead>
            <tr style={{ color: "var(--ink-muted)" }}>
              <th className="border-b p-2 text-start" style={{ borderColor: "var(--line)" }}>
                الحساب
              </th>
              <th className="border-b p-2 text-start" style={{ borderColor: "var(--line)" }}>
                النوع
              </th>
              <th className="border-b p-2 text-start" style={{ borderColor: "var(--line)" }}>
                التصنيف
              </th>
              <th className="border-b p-2 text-end" style={{ borderColor: "var(--line)" }}>
                مدين
              </th>
              <th className="border-b p-2 text-end" style={{ borderColor: "var(--line)" }}>
                دائن
              </th>
              <th className="border-b p-2 text-end" style={{ borderColor: "var(--line)" }}>
                الرصيد
              </th>
              <th className="border-b p-2 text-end" style={{ borderColor: "var(--line)" }}>
                إجراء
              </th>
            </tr>
          </thead>
          <tbody>
            {rendered.map(({ node, depth }) => {
              const leaf = isLeaf(node, children);
              const canArchive = node.active && !node.isSystem;
              const canMerge = canArchive && leaf;
              return (
                <tr key={node.id} style={{ opacity: node.active ? 1 : 0.55 }}>
                  <td className="border-b p-2 align-top" style={{ borderColor: "var(--line)" }}>
                    <div className="flex min-w-0 items-start gap-2" style={{ paddingInlineStart: depth * 18 }}>
                      <code className="mt-0.5 shrink-0 tabular-nums text-xs" style={{ color: "var(--ink-muted)" }}>
                        {node.code}
                      </code>
                      <div className="min-w-0">
                        <div className="font-semibold" style={{ color: "var(--ink)" }}>
                          {node.nameAr}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {node.isSystem && <Tag tone="ok">نظامي</Tag>}
                          {!node.active && <Tag tone="danger">مؤرشف</Tag>}
                          {leaf && node.active && <Tag tone="neutral">فرعي</Tag>}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="border-b p-2 align-top" style={{ borderColor: "var(--line)" }}>
                    {TYPE_AR[node.accountType]}
                    <span className="ms-1 text-xs" style={{ color: "var(--ink-muted)" }}>
                      {BALANCE_AR[node.normalBalance]}
                    </span>
                  </td>
                  <td className="border-b p-2 align-top" style={{ borderColor: "var(--line)" }}>
                    {node.kind ? <Tag tone="warning">{KIND_AR[node.kind]}</Tag> : "—"}
                  </td>
                  <td className="border-b p-2 text-end align-top tabular-nums" style={{ borderColor: "var(--line)" }}>
                    {egp(node.debit)}
                  </td>
                  <td className="border-b p-2 text-end align-top tabular-nums" style={{ borderColor: "var(--line)" }}>
                    {egp(node.credit)}
                  </td>
                  <td className="border-b p-2 text-end align-top font-semibold tabular-nums" style={{ borderColor: "var(--line)" }}>
                    {egp(node.balance)}
                  </td>
                  <td className="border-b p-2 align-top" style={{ borderColor: "var(--line)" }}>
                    <div className="flex flex-wrap justify-end gap-1">
                      {node.active && (
                        <Button
                          variant="ghost"
                          onClick={() => setForm({ mode: "add-child", parent: node, editing: null })}
                        >
                          + فرع
                        </Button>
                      )}
                      <Button variant="ghost" onClick={() => setForm({ mode: "edit", parent: null, editing: node })}>
                        تعديل
                      </Button>
                      {canMerge && (
                        <Button variant="ghost" onClick={() => setMergeSource(node)}>
                          دمج
                        </Button>
                      )}
                      {canArchive && (
                        <Button variant="ghost" onClick={() => setArchiveTarget(node)}>
                          أرشفة
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={archiveTarget !== null}
        onClose={() => setArchiveTarget(null)}
        onConfirm={confirmArchive}
        loading={archivePending}
        tone="danger"
        title="أرشفة الحساب"
        description={
          archiveTarget
            ? `سيتم أرشفة «${archiveTarget.nameAr}» وفروعه غير النظامية بدون حذف القيود القديمة.`
            : ""
        }
        confirmLabel="أرشفة"
        cancelLabel="إلغاء"
        closeLabel="إغلاق"
      />
    </div>
  );
}

function AccountForm({
  state,
  nodes,
  childMap,
  onClose,
  onSaved,
}: {
  state: FormState;
  nodes: AccountNode[];
  childMap: Map<string | null, AccountNode[]>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = state.editing;
  const fixedParent = state.mode === "add-child" ? state.parent : null;
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const descendants = editing ? descendantIds(editing, childMap) : new Set<string>();
  const hasActiveChildren = editing ? !isLeaf(editing, childMap) : false;
  const [parentId, setParentId] = useState<string | null>(fixedParent?.id ?? editing?.parentId ?? null);
  const [code, setCode] = useState(editing?.code ?? "");
  const [nameAr, setNameAr] = useState(editing?.nameAr ?? "");
  const [accountType, setAccountType] = useState<AccountType>(
    editing?.accountType ?? fixedParent?.accountType ?? "expense",
  );
  const [normalBalance, setNormalBalance] = useState<NormalBalance>(
    editing?.normalBalance ?? fixedParent?.normalBalance ?? "debit",
  );
  const [kind, setKind] = useState<AccountKind | "">(editing?.kind ?? fixedParent?.kind ?? "");
  const [sortOrder, setSortOrder] = useState(editing?.sortOrder == null ? "" : String(editing.sortOrder));
  const [msg, setMsg] = useState<string | null>(null);
  const { pending, submit } = useSubmit();

  const effectiveParent = parentId ? nodeById.get(parentId) ?? null : null;
  const parentLocksShape = Boolean(effectiveParent);
  const shapeLocked = Boolean(editing?.isSystem || parentLocksShape || hasActiveChildren);
  const parentKind = effectiveParent?.kind ?? null;
  const allowedKinds = KIND_FOR_TYPE[accountType];
  const effectiveKind = parentKind ?? (isAccountKind(kind) ? kind : null);
  const canChooseKind = !editing?.isSystem && !effectiveParent && allowedKinds.length > 0;
  const parentOptions = nodes.filter((node) => {
    if (!node.active) return false;
    if (editing && (node.id === editing.id || descendants.has(node.id))) return false;
    return node.accountType === accountType;
  });

  const title =
    state.mode === "edit"
      ? `تعديل: ${editing?.nameAr ?? ""}`
      : state.mode === "add-child"
        ? `حساب فرعي تحت: ${state.parent.nameAr}`
        : "حساب رئيسي جديد";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const result = await submit(() =>
      saveAccount({
        id: editing?.id ?? null,
        parentId,
        code,
        nameAr,
        accountType,
        normalBalance,
        kind: effectiveKind,
        sortOrder: sortOrder.trim() === "" ? null : Number(sortOrder),
        active: editing?.active ?? true,
      }),
    );
    if (result.ok) onSaved();
    else setMsg(result.error ?? "تعذّر حفظ الحساب");
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-3 rounded-md p-3"
      style={{ border: "1px solid var(--line)", background: "var(--surface-2)" }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong style={{ color: "var(--ink)" }}>{title}</strong>
        <Button type="button" variant="ghost" onClick={onClose}>
          إغلاق
        </Button>
      </div>
      {msg && <Alert tone="danger" title={msg} />}
      {editing?.isSystem && (
        <Alert tone="info" title="هذا حساب نظامي؛ يمكن تعديل الاسم فقط، ولا يمكن تغيير الكود أو الموضع." />
      )}
      {hasActiveChildren && !editing?.isSystem && (
        <Alert tone="info" title="هذا الحساب له فروع نشطة؛ غيّر الاسم أو الكود فقط، أو انقل الفروع أولًا." />
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <Field label="الكود" id="account-code">
          <Input
            id="account-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            disabled={editing?.isSystem}
            required
          />
        </Field>
        <Field label="اسم الحساب" id="account-name">
          <Input id="account-name" value={nameAr} onChange={(e) => setNameAr(e.target.value)} required />
        </Field>
        <Field label="الحساب الأب" id="account-parent">
          {fixedParent ? (
            <Input id="account-parent" value={`${fixedParent.code} — ${fixedParent.nameAr}`} disabled />
          ) : (
            <select
              id="account-parent"
              className={SELECT_CLASS}
              style={SELECT_STYLE}
              value={parentId ?? ""}
              disabled={editing?.isSystem || hasActiveChildren}
              onChange={(e) => setParentId(e.target.value || null)}
            >
              <option value="">— حساب رئيسي —</option>
              {parentOptions.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.code} — {node.nameAr}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="ترتيب العرض" id="account-sort">
          <Input
            id="account-sort"
            type="number"
            inputMode="numeric"
            min={0}
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
            disabled={editing?.isSystem}
          />
        </Field>
        <Field label="نوع الحساب" id="account-type">
          <select
            id="account-type"
            className={SELECT_CLASS}
            style={SELECT_STYLE}
            value={accountType}
            disabled={shapeLocked}
            onChange={(e) => {
              const next = e.target.value as AccountType;
              setAccountType(next);
              setKind("");
              setParentId(null);
            }}
          >
            <option value="asset">أصل</option>
            <option value="liability">التزام</option>
            <option value="equity">حقوق ملكية</option>
            <option value="revenue">إيراد</option>
            <option value="expense">مصروف</option>
          </select>
        </Field>
        <Field label="الرصيد الطبيعي" id="account-balance">
          <select
            id="account-balance"
            className={SELECT_CLASS}
            style={SELECT_STYLE}
            value={normalBalance}
            disabled={shapeLocked}
            onChange={(e) => setNormalBalance(e.target.value as NormalBalance)}
          >
            <option value="debit">مدين</option>
            <option value="credit">دائن</option>
          </select>
        </Field>
        <Field label="تصنيف الربط بالمصروفات" id="account-kind">
          <select
            id="account-kind"
            className={SELECT_CLASS}
            style={SELECT_STYLE}
            value={effectiveKind ?? ""}
            disabled={!canChooseKind || shapeLocked}
            onChange={(e) => setKind(e.target.value as AccountKind | "")}
          >
            <option value="">— بدون —</option>
            {allowedKinds.map((value) => (
              <option key={value} value={value}>
                {KIND_AR[value]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "جارٍ الحفظ…" : "حفظ الحساب"}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          إلغاء
        </Button>
      </div>
    </form>
  );
}

function MergeForm({
  source,
  nodes,
  childMap,
  onClose,
  onMerged,
}: {
  source: AccountNode;
  nodes: AccountNode[];
  childMap: Map<string | null, AccountNode[]>;
  onClose: () => void;
  onMerged: () => void;
}) {
  const candidates = nodes.filter(
    (node) =>
      node.id !== source.id &&
      node.active &&
      node.accountType === source.accountType &&
      node.kind === source.kind &&
      isLeaf(node, childMap),
  );
  const [targetId, setTargetId] = useState(candidates[0]?.id ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const { pending, submit } = useSubmit();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const result = await submit(() => mergeAccounts(source.id, targetId));
    if (result.ok) onMerged();
    else setMsg(result.error ?? "تعذّر دمج الحسابين");
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-3 rounded-md p-3"
      style={{ border: "1px solid var(--line)", background: "var(--surface-2)" }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong style={{ color: "var(--ink)" }}>دمج الحساب: {source.nameAr}</strong>
        <Button type="button" variant="ghost" onClick={onClose}>
          إغلاق
        </Button>
      </div>
      {msg && <Alert tone="danger" title={msg} />}
      <Alert
        tone="warning"
        title="سيتم نقل المصروفات والقيود من الحساب المصدر إلى الحساب الهدف ثم أرشفة المصدر."
      />
      {candidates.length === 0 ? (
        <p style={{ color: "var(--ink-muted)" }}>لا يوجد حساب فرعي نشط مناسب للدمج معه.</p>
      ) : (
        <>
          <Field label="الحساب الهدف" id="merge-target">
            <select
              id="merge-target"
              className={SELECT_CLASS}
              style={SELECT_STYLE}
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              required
            >
              {candidates.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.code} — {node.nameAr}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex gap-2">
            <Button type="submit" disabled={pending || !targetId}>
              {pending ? "جارٍ الدمج…" : "دمج الحساب"}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              إلغاء
            </Button>
          </div>
        </>
      )}
    </form>
  );
}
