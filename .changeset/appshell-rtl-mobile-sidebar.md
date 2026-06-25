---
"@amrebeid/ui": patch
---

Fix: the AppShell mobile off-canvas sidebar peeked ~90px on-screen in RTL. The closed drawer
re-anchored to the wrong edge (`inset-inline-end` double-flips the already-logical
`inset-inline-start`), leaving it partly visible and pushing field/mobile content. Now only the
physical `translateX` sign is flipped for RTL, so the closed drawer sits fully off-screen — no
horizontal overflow on mobile/field views.
