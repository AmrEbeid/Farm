"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Field, Input, Tag, useToast } from "@/components/ui";
import { useSubmit } from "@/components/useSubmit";
import {
  saveAccount,
  archiveAccount,
  type AccountType,
  type AccountKind,
} from "@/app/(app)/finance/accounts/actions";

export interface AccountNode {
  id: string;
  code: string;
  nameAr: string;
  accountType: string;
  normalBalance: string;
  parentId: string | null;
  kind: string | null;
  isSystem: boolean;
  sortOrder: number | null;
  active: boolean;
}

const TYPE_AR: Record<string, string> = {
  asset: "أصل",
  liability: "التزام",
  equity: "حقوق ملكية",
  revenue: "إيراد",
  expense: "مصروف",
};
const KIND_AR: Record<string, string> = {
  operating: "تشغيلي",
  drawing: "مسحوبات",
  capex: "رأسمالي",
};

interface FormState {
  mode: "add-root" | "add-child" | "edit";
  parent: AccountNode | null;
  editing: AccountNode | null;
}

/** Interactive شجرة الحسابات: indented tree + add-child / rename / re-type / archive, all via the
 *  budget.write-gated RPCs. System accounts (is_system) render locked to rename-only. */
export function AccountsTreeManager({ nodes }: { nodes: AccountNode[] }) {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState<FormState | null>(null);

  // Build the parent→children index once; render depth-first so the tree reads top-down.
  const childrenOf = useMemo(() => {
    const map = new Map<string | null, AccountNode[]>();
    for (const n of nodes) {
      const key = n.parentId;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(n);
    }
    return map;
  }, [nodes]);

  const rendered: { node: AccountNode; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const n of childrenOf.get(parentId) ?? []) {
      rendered.push({ node: n, depth });
      walk(n.id, depth + 1);
    }
  };
  walk(null, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm" style={{ color: "var(--ink-muted)" }}>
          {rendered.length} حساب
        </span>
        <Button variant="ghost" onClick={() => setForm({ mode: "add-root", parent: null, editing: null })}>
          + حساب رئيسي
        </Button>
      </div>

      {form && (
        <AccountForm
          state={form}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            router.refresh();
          }}
        />
      )}

      <ul className="flex flex-col" aria-label="شجرة الحسابات">
        {rendered.map(({ node, depth }) => (
          <li
            key={node.id}
            className="flex flex-wrap items-center gap-2 border-b py-2"
            style={{
              paddingInlineStart: `${depth * 20}px`,
              borderColor: "var(--line, rgba(0,0,0,0.08))",
              opacity: node.active ? 1 : 0.5,
            }}
          >
            <code className="tabular-nums text-xs" style={{ color: "var(--ink-muted)" }}>
              {node.code}
            </code>
            <span className="font-medium" style={{ color: "var(--ink)" }}>
              {node.nameAr}
            </span>
            <Tag tone="neutral">{TYPE_AR[node.accountType] ?? node.accountType}</Tag>
            {node.kind && <Tag tone="warning">{KIND_AR[node.kind] ?? node.kind}</Tag>}
            {node.isSystem && <Tag tone="ok">نظامي</Tag>}
            {!node.active && <Tag tone="danger">مؤرشف</Tag>}
            <div className="ms-auto flex gap-1">
              <Button
                variant="ghost"
                onClick={() => setForm({ mode: "add-child", parent: node, editing: null })}
              >
                + فرع
              </Button>
              <Button variant="ghost" onClick={() => setForm({ mode: "edit", parent: null, editing: node })}>
                تعديل
              </Button>
              {!node.isSystem && node.active && (
                <ArchiveButton node={node} onDone={() => router.refresh()} toastOk={toast.ok} />
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ArchiveButton({
  node,
  onDone,
  toastOk,
}: {
  node: AccountNode;
  onDone: () => void;
  toastOk: (m: string) => void;
}) {
  const { pending, submit } = useSubmit();
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      <Button
        variant="ghost"
        disabled={pending}
        onClick={async () => {
          setErr(null);
          if (!window.confirm(`أرشفة الحساب «${node.nameAr}»؟ يمكن استرجاعه لاحقًا.`)) return;
          const r = await submit(() => archiveAccount(node.id));
          if (r.ok) {
            toastOk("تمت الأرشفة");
            onDone();
          } else setErr(r.error ?? "تعذّر");
        }}
      >
        أرشفة
      </Button>
      {err && (
        <span className="text-xs" style={{ color: "var(--danger, #b23b3b)" }}>
          {err}
        </span>
      )}
    </>
  );
}

function AccountForm({
  state,
  onClose,
  onSaved,
}: {
  state: FormState;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = state.editing;
  const [code, setCode] = useState(editing?.code ?? "");
  const [nameAr, setNameAr] = useState(editing?.nameAr ?? "");
  const [accountType, setAccountType] = useState<AccountType>(
    (editing?.accountType as AccountType) ?? (state.parent?.accountType as AccountType) ?? "expense",
  );
  const [normalBalance, setNormalBalance] = useState<"debit" | "credit">(
    (editing?.normalBalance as "debit" | "credit") ??
      (state.parent?.normalBalance as "debit" | "credit") ??
      "debit",
  );
  const [kind, setKind] = useState<AccountKind | "">((editing?.kind as AccountKind) ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const { pending, submit } = useSubmit();

  const parentId = state.mode === "add-child" ? state.parent?.id ?? null : editing?.parentId ?? null;
  const title =
    state.mode === "edit"
      ? `تعديل: ${editing?.nameAr}`
      : state.mode === "add-child"
        ? `حساب فرعي تحت: ${state.parent?.nameAr}`
        : "حساب رئيسي جديد";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const r = await submit(() =>
      saveAccount({
        id: editing?.id ?? null,
        parentId,
        code,
        nameAr,
        accountType,
        normalBalance,
        kind: accountType === "expense" && kind ? (kind as AccountKind) : null,
      }),
    );
    if (r.ok) onSaved();
    else setMsg(r.error ?? "تعذّر الحفظ");
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-3 rounded-md p-3"
      style={{ border: "1px solid var(--line, rgba(0,0,0,0.15))", background: "var(--surface-2, #f6f9f7)" }}
    >
      <div className="flex items-center justify-between">
        <strong style={{ color: "var(--ink)" }}>{title}</strong>
        <Button type="button" variant="ghost" onClick={onClose}>
          إغلاق
        </Button>
      </div>
      {msg && <Alert tone="danger" title={msg} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="الكود" id="a-code">
          <Input id="a-code" value={code} onChange={(e) => setCode(e.target.value)} required />
        </Field>
        <Field label="اسم الحساب" id="a-name">
          <Input id="a-name" value={nameAr} onChange={(e) => setNameAr(e.target.value)} required />
        </Field>
        <Field label="النوع" id="a-type">
          <select
            id="a-type"
            className="w-full rounded-md px-3 py-2 text-sm"
            style={{ border: "1px solid var(--line, rgba(0,0,0,0.15))", background: "var(--surface, #fff)" }}
            value={accountType}
            disabled={editing?.isSystem}
            onChange={(e) => setAccountType(e.target.value as AccountType)}
          >
            <option value="expense">مصروف</option>
            <option value="revenue">إيراد</option>
            <option value="asset">أصل</option>
            <option value="liability">التزام</option>
            <option value="equity">حقوق ملكية</option>
          </select>
        </Field>
        <Field label="الرصيد الطبيعي" id="a-nb">
          <select
            id="a-nb"
            className="w-full rounded-md px-3 py-2 text-sm"
            style={{ border: "1px solid var(--line, rgba(0,0,0,0.15))", background: "var(--surface, #fff)" }}
            value={normalBalance}
            disabled={editing?.isSystem}
            onChange={(e) => setNormalBalance(e.target.value as "debit" | "credit")}
          >
            <option value="debit">مدين</option>
            <option value="credit">دائن</option>
          </select>
        </Field>
        {accountType === "expense" && (
          <Field label="تصنيف المصروف" id="a-kind">
            <select
              id="a-kind"
              className="w-full rounded-md px-3 py-2 text-sm"
              style={{ border: "1px solid var(--line, rgba(0,0,0,0.15))", background: "var(--surface, #fff)" }}
              value={kind}
              onChange={(e) => setKind(e.target.value as AccountKind | "")}
            >
              <option value="">— غير محدد —</option>
              <option value="operating">تشغيلي</option>
              <option value="drawing">مسحوبات (صاحب المزرعة)</option>
              <option value="capex">رأسمالي</option>
            </select>
          </Field>
        )}
      </div>
      {editing?.isSystem && (
        <Alert tone="info" title="هذا حساب نظامي — يمكن تعديل الاسم فقط؛ النوع والموضع مثبّتان." />
      )}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "جارٍ الحفظ…" : "حفظ"}
        </Button>
      </div>
    </form>
  );
}
