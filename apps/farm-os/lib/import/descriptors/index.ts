/**
 * Registers every import descriptor on load. Import this module once on the server
 * (the import route does) so `getDescriptor`/`listDescriptors` are populated. Add new
 * inputs here — and to IMPORTABLE_RPCS in ../importable-rpcs.ts so the convention test
 * fails until the descriptor exists.
 */
import { registerDescriptor } from "../registry";
import { sectorsDescriptor } from "./sectors";
import { hawshatDescriptor } from "./hawshat";
import { linesDescriptor } from "./lines";
import { accountsDescriptor } from "./accounts";
import { costCentersDescriptor } from "./cost-centers";
import { offshootMovementsDescriptor } from "./offshoot-movements";
import { buyersDescriptor } from "./buyers";
import { salesDescriptor } from "./sales";
import { suppliersDescriptor } from "./suppliers";
import { inventoryItemsDescriptor } from "./inventory-items";
import { expensesDescriptor } from "./expenses";

export const ALL_DESCRIPTORS = [
  sectorsDescriptor,
  hawshatDescriptor,
  linesDescriptor,
  accountsDescriptor,
  costCentersDescriptor,
  offshootMovementsDescriptor,
  buyersDescriptor,
  salesDescriptor,
  suppliersDescriptor,
  inventoryItemsDescriptor,
  expensesDescriptor,
];

for (const d of ALL_DESCRIPTORS) registerDescriptor(d);
