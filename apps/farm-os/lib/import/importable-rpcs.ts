/**
 * The canonical list of write-RPCs that SHOULD be importable via a template (spec IMP-9).
 * Every entry must have a registered descriptor — the convention test fails otherwise.
 * Grow this list (and add the matching descriptor) as each input's template ships.
 */
export const IMPORTABLE_RPCS: readonly string[] = ["fn_save_sector", "fn_save_hawsha"];
