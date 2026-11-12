---
type: "explain"
date: "2026-05-08T10:51:51.704233+00:00"
question: "Is parseFloat() really cross-cutting between backend cash drawer and frontend money formatting?"
contributor: "graphify"
source_nodes: ["steps_step3protocol_parsefloat"]
---

# Q: Is parseFloat() really cross-cutting between backend cash drawer and frontend money formatting?

## Answer

No, the graph mechanism is wrong but the underlying smell is real. parseFloat is a JavaScript builtin, not a user-defined symbol. AST extractor created a node at apps/frontend/src/features/arrivals/steps/Step3Protocol.tsx (first occurrence) and drew INFERRED 'calls' edges to 15 other files that ALSO call the JS builtin - treating them as if they were calling Step3Protocol's local symbol. They aren't. Each file independently invokes the JS runtime. HOWEVER: source has 42 parseFloat() invocations across 18 files. Money helpers exist (apps/frontend/src/shared/lib/money.ts and apps/backend/src/shared/utils/money.ts both export toCents/fromCents/sumMoney/multiplyMoney). Multiple call sites bypass them: PatientDetail.tsx:149 has 'parseFloat(t.netAmount)' with no money.ts import; TransactionsPage.tsx imports toCents/fromCents but ALSO uses parseFloat 4 times directly for VAT/discount/quantity; backend shifts/db.ts:150,163 bypasses its own helper. This is real architectural drift caused by the numeric->string serialization gotcha (gotchas.md). Action: centralize parseFloat money-handling through toCents/fromCents helpers across the 18 files. ~3hr mechanical PR; prevents a class of decimal precision bugs.

## Source Nodes

- steps_step3protocol_parsefloat