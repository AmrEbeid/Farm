export interface CurrentInventoryState {
  available: number | null;
  threshold: number;
  status: "unknown" | "reorder" | "above";
}

export function currentInventoryState(
  bins: Array<{ on_hand?: number | null; reserved?: number | null }>,
  reorderPoint: number | null,
  minStock: number | null,
): CurrentInventoryState {
  const threshold = Number(reorderPoint ?? minStock ?? 0);
  if (bins.length === 0) return { available: null, threshold, status: "unknown" };

  const available = bins.reduce(
    (sum, bin) => sum + Number(bin.on_hand ?? 0) - Number(bin.reserved ?? 0),
    0,
  );
  return { available, threshold, status: threshold > 0 && available < threshold ? "reorder" : "above" };
}
