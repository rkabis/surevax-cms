---
type: "path_query"
date: "2026-05-08T10:51:21.957880+00:00"
question: "Is the frontend Atomic Commit Pattern semantically parallel to the backend Tenant Resolution Middleware?"
contributor: "graphify"
source_nodes: ["concept_atomic_commit", "db_withtenanttx_withtenanttx"]
---

# Q: Is the frontend Atomic Commit Pattern semantically parallel to the backend Tenant Resolution Middleware?

## Answer

No. The graph's INFERRED edge is wrong on which backend node it points to. Verified by tracing source: PATTERNS.md atomic-commit-block is rendered by useArrivalAtomicCommit() (apps/frontend/src/features/arrivals/api.ts:81), which POSTs to /api/arrivals/atomic, which is wrapped in withTenantTx() (apps/backend/src/shared/db/withTenantTx.ts:24-31). The real cross-stack link is Atomic Commit Pattern -> withTenantTx(), not -> Tenant Resolution Middleware. The frontend pattern is a UX *promise* (visible 'rolls back as one' Card) that the backend transaction wrapper *delivers* via db.transaction + SET LOCAL. Frontend is NOT reimplementing safety logic.

## Source Nodes

- concept_atomic_commit
- db_withtenanttx_withtenanttx