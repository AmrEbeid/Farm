import type { Meta, StoryObj } from "@storybook/react";
import { PalmGrid, type PalmLine } from "./PalmGrid";
import type { PalmStatus } from "./PalmCell";

const statuses: PalmStatus[] = ["healthy", "healthy", "watch", "sick", "healthy", "dead", "male", "removed"];
const labelFor: Record<PalmStatus, string> = {
  healthy: "سليمة", watch: "مراقبة", sick: "مريضة", dead: "ميتة", removed: "مُزالة", male: "ذكر",
};
const line = (id: string, label: string, n: number): PalmLine => ({
  id, label,
  cells: Array.from({ length: n }, (_, i) => {
    const status = statuses[i % statuses.length];
    return { id: `${id}-${i + 1}`, status, ariaLabel: `نخلة ${labelFor[status]}، ${label} موضع ${i + 1}` };
  }),
});

const lines: PalmLine[] = [line("L1", "خط ١", 12), line("L2", "خط ٢", 12), line("L3", "خط ٣", 12)];

const meta: Meta<typeof PalmGrid> = {
  title: "Domain/PalmGrid",
  component: PalmGrid,
  args: { lines, ariaLabel: "خريطة النخيل", onCellActivate: (c, l) => console.log("activate", c, l) },
};
export default meta;
type S = StoryObj<typeof PalmGrid>;

export const Default: S = {};
export const Selected: S = {
  args: {
    lines: lines.map((l, li) => ({
      ...l, cells: l.cells.map((c, ci) => (li === 0 && ci === 2 ? { ...c, selected: true } : c)),
    })),
  },
};
export const Gallery: S = {
  render: () => (
    <div style={{ display: "grid", gap: 16 }}>
      <PalmGrid ariaLabel="قطعة أ" lines={[line("A1", "خط ١", 20), line("A2", "خط ٢", 20)]} />
    </div>
  ),
};
