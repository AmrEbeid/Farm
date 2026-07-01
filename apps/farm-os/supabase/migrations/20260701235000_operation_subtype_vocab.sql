-- Farm OS — operation vocabulary: constrain plan_operations.subtype to the real Egyptian
-- date-palm operation set (FAO Y4360E + Egyptian APC + agronomy research), and add a
-- harvest_stage sub-field for ripening stage (خلال/رطب/تمر).
--
-- THE GAP. plan_operations.subtype is `text` with NO CHECK (migration 0006) — unlike
-- plan_operations.status, which 0058 already constrained to its known vocabulary for exactly
-- this reason. Today only 5 Arabic labels exist in lib/labels.ts SUBTYPE_AR (fertilization/
-- irrigation/spraying/pollination/inspection) and the only write paths are the OperationBuilder
-- UI (components/OperationBuilder.tsx, a fixed <select>) and the two authoring RPCs
-- (fn_add_plan_operation / fn_add_plan_operation_multi) — but neither the RPCs nor a direct-REST
-- insert range-check the value, so an arbitrary/typo'd subtype can be written. Downstream,
-- lib/budget-check.ts and the /budget/[planId]/check page key off subtype === 'fertilization'
-- specifically, so an unconstrained value is also a correctness risk for anything that branches
-- on subtype, not just cosmetic.
--
-- THE FIX. CHECK subtype against the full real-world vocabulary: the 5 already-offered values
-- plus the ~10 operations the UI never offered (pruning/dethorning, offshoot management, pollen
-- collection, bunch limiting, thinning, bunch tilting, bagging, pest scouting, harvest,
-- post-harvest). 'spraying' is KEPT as the key for pesticide/control application (back-compat —
-- existing rows and the current UI both use it; renaming was judged not worth breaking existing
-- data for). The UI-facing vocabulary is centralized in lib/labels.ts SUBTYPE_AR so a new subtype
-- gets its Arabic label in one place (mirrors the 0058 status pattern and the #289 pollination fix).
--
-- Every subtype the app has EVER been able to write is one of the 5 pre-existing values (the
-- OperationBuilder <select> and the RPCs' free-text pass-through are the only write paths; there
-- is no bulk-import or other producer of plan_operations.subtype). A fresh CHECK against a
-- superset of those 5 values therefore cannot fail to validate against real data — same shape of
-- argument the 0058 status CHECK made, though (unlike 0058) this migration does NOT independently
-- re-probe prod: apply after confirming with `select distinct subtype from plan_operations` that
-- no out-of-vocabulary value exists (expected: none, since the UI never offered one).
--
-- HARVEST STAGE. A harvest operation needs to record which ripening stage it's harvesting:
-- خلال (Khalal, unripe/hard) / رطب (Rutab, soft-ripe) / تمر (Tamar, fully ripe/dried). Modeled as
-- a separate nullable column (not a value folded into subtype) so it composes with the existing
-- subtype vocabulary and stays queryable on its own. A plain value-set CHECK is enough — cross-
-- column enforcement (harvest_stage only when subtype='harvest') is deliberately NOT added here
-- (over-engineering for the current need; the column is simply null for non-harvest ops).

alter table public.plan_operations
  add constraint plan_operations_subtype_valid
  check (subtype is null or subtype in (
    -- pre-existing (offered by the UI today; kept verbatim for back-compat)
    'fertilization', 'irrigation', 'spraying', 'pollination', 'inspection',
    -- newly modeled real-world date-palm operations
    'pruning_dethorning', 'offshoot_mgmt', 'pollen_collection', 'bunch_limiting', 'thinning',
    'bunch_tilting', 'bagging', 'pest_scouting', 'harvest', 'post_harvest'
  ));

alter table public.plan_operations
  add column if not exists harvest_stage text;

alter table public.plan_operations
  add constraint plan_operations_harvest_stage_valid
  check (harvest_stage is null or harvest_stage in ('khalal', 'rutab', 'tamar'));
