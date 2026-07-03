---
"@amrebeid/ui": minor
---

Field: add a `required` prop. It renders a decorative (aria-hidden) `*` marker on the label —
styled to match FormRow's marker — and injects the native `required` attribute onto the control
(custom child or the default input). Lets consumers stop hand-typing `*` into the label string
(which some screen readers announce as "star"). Backwards-compatible: fields that pass neither
`error` nor `required` are untouched.
