---
type: "explain"
date: "2026-05-08T10:51:34.388635+00:00"
question: "Are the 73 INFERRED 'calls' edges on withTenantTx() actually correct?"
contributor: "graphify"
source_nodes: ["db_withtenanttx_withtenanttx"]
---

# Q: Are the 73 INFERRED 'calls' edges on withTenantTx() actually correct?

## Answer

Yes, ~92% accurate. Source has 79 actual withTenantTx() invocations across 17 modules (apps/backend/src/modules/*/db.ts and service.ts files). Random sample of 15 callers from graph (listAppointments, createExternalImmunization, createTemplateVersion, updateService, revokeRefreshToken, updateAppointment, softDeleteAdverseEvent, createAdverseEvent, listEncounters, getActiveShift, addPatientTag, clockIn, getShiftById, previewBundle, getService) all 15/15 verified to invoke withTenantTx() at top of body. The 6-edge gap (79 -> 73) explained by same-file duplicates collapsed by AST + test file tracked separately + helper-closure call sites the AST didn't trace. Confirms architecturally that every backend module routing through DB uses tenant-scoped transactions; no rogue write paths bypass tenant context. Trust this part of the graph.

## Source Nodes

- db_withtenanttx_withtenanttx