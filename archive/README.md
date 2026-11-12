# Archive

Historical and superseded documentation for SureVax CMS.

---

## Quick Use (No Deep Reading)

- You do **not** need to read every archive file.
- Start with **file title** and, if needed, the **first 3-10 lines** only.
- Use folder bucket + filename to decide relevance.
- For implementation decisions, always use `../docs/ai-context/` first.

---

## Directory Structure (Re-bucketed)

```
archive/
├── README.md
├── 01-planning-docs/                    # Archived planning/product docs now superseded
├── 02-schema-and-data/                  # Single schema bucket with source + versions + analysis
│   ├── canonical-source/
│   ├── versions/
│   └── analysis/
├── 03-policies-and-compliance/          # Archived policy/compliance docs
├── 04-proposals-and-research/           # Archived proposals and research references
├── 05-architecture-decisions/           # Historical design/decision rationale
├── 06-tech-stack-iterations/            # Superseded stack drafts
```

---

## Schema Bucket Layout

`02-schema-and-data/` is the **only** schema-related bucket:

- `canonical-source/`
  - Main schema source docs that were later superseded by `docs/ai-context/01-DATA-AND-COMPLIANCE.md`.
- `versions/`
  - Snapshot schema versions (`database-schema-v2`, `database-schema-v3`).
- `analysis/`
  - Legacy schema comparisons, modularity notes, and verification artifacts.

---

## Buckets (What Each One Means)

- `01-planning-docs`
  - Archived planning and feature docs (quick start, roadmap, structure, stories, UI guide).
  - Superseded by `docs/ai-context/`.

- `02-schema-and-data`
  - Consolidated schema area (source docs + old versions + analysis).
  - Use this single bucket for any schema-history lookup.

- `03-policies-and-compliance`
  - Archived dependency, deployment, and compliance source docs.
  - Use `docs/ai-context/04` and `docs/ai-context/05` for active guidance.

- `04-proposals-and-research`
  - Project proposals, milestone pricing docs, and external research references.

- `05-architecture-decisions`
  - Past architecture deliberations and comparisons.
  - Useful for context, not for current implementation rules.

- `06-tech-stack-iterations`
  - Deprecated stack proposals and intermediate versions.

---

## Archive Rules

- Do not use archived files as implementation source.
- Do not reintroduce superseded architecture decisions from this directory.
- Keep files for traceability and audit history only.

---

## Where to Work Now

- `../docs/ai-context/_INDEX.md` (router)
- `../docs/ai-context/00-SYSTEM-CORE.md` through `../docs/ai-context/06-PRODUCT-WORKFLOWS.md`
- `../README.md` (project entry point)
- `../TODO.md` (living task list)

---

**Last Updated**: 2026-03-22
