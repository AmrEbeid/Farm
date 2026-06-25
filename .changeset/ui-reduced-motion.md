---
"@amrebeid/ui": patch
---

Respect `prefers-reduced-motion: reduce`. Added a global media block in the library CSS that collapses non-essential transitions and animations to near-instant (~0.01ms) for users who have requested reduced motion, so overlays, drawers, toasts, the modal pop/fade, progress fills and hover transforms no longer slide, pop or scale. Looping indicators (button/icon-button spinners and the skeleton shimmer) are stopped entirely. Content visibility is preserved — opacity-based entrances resolve immediately rather than being suppressed. No change for default (motion-OK) users, and no component logic or visual design changed.
