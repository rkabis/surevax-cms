# Approved Migration Augmentations

## Purpose

Use an augmentation when a frozen source pack supports a safe fact that is
missing from the current AppSheet rows—for example, a nurse-deleted
immunization recovered from the clinic ledger or a regimen slot that must be
scheduled. Augmentations are additions to the canonical event ledger. They are
never edits to the exported workbook and never direct database commands.

## Supported facts

| Kind                      | Human meaning                                                         | Minimum support                                                                                                  |
| ------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `local_administration`    | The patient received the listed service at the workbook-title clinic. | Selected tracker row; unique patient match; exact time; no attributable refusal/deposit/future/cancelled remark. |
| `external_administration` | The dose occurred outside SureVax.                                    | Explicit outside-clinic evidence, or E33's remarks-checked ARV dose-1 owner assumption. Unknown facts stay null. |
| `scheduled_dose`          | A future or overdue slot belongs to an established course.            | Existing standing-order identity and explicit or template-derived date. It is not payment or administration.     |

Whole-course expansion remains pending because it must use the target standing
order template rather than append orphan scheduled rows.

## Required audit fields

Each entry carries a never-reused augmentation ID; approving person and time;
patient legacy ID; workbook-title branch where applicable; service and dose;
reason and rationale; file/revision/sheet/row evidence; and the SHA-256 hash of
the complete frozen source pack. Patient, branch, service and standing-order
IDs must resolve against the transformed frozen plan. Name-only patient
matching is not accepted.

The full sidecar contains PHI and must stay outside Git. Git may contain only
synthetic fixtures and documentation. A future loader will mirror compact
provenance onto the target row and retain the full hashed sidecar as the run
artifact.

## Unknown external dose 1

For a first local ARV dose 2 or later:

1. Inspect attributable AppSheet Remarks, immunization remarks and clinic-ledger
   remarks.
2. If a remark contradicts prior dose 1, create no dose; emit a P1 record
   blocker.
3. If outside dose 1 is explicit, retain only the details actually stated.
4. If no contradiction exists, E33 permits an external dose-1 canonical fact
   with unknown date, facility, brand and route.

The canonical target now represents this without a fabricated date:
`patient_external_immunizations.administered_date` remains null while
`administered_date_precision="Unknown"`; a linked external clinical order uses
`completed_at_unknown=true`. The writer must still resolve a unique patient,
course, service and dose slot. Ambiguous linkage is P1 and creates no target
row.

## Example (synthetic)

```json
{
  "schemaVersion": 1,
  "runId": "CUTOVER-RUN-001",
  "frozenSourceHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "entries": [
    {
      "kind": "scheduled_dose",
      "augmentationId": "AUG-SYNTHETIC-001",
      "disposition": "approved",
      "approvedBy": "app-owner",
      "approvedAt": "2026-08-16T10:00:00+08:00",
      "reasonCode": "MISSING_SCHEDULE_SLOT",
      "rationale": "Template-derived next slot from the verified course anchor.",
      "match": {
        "patientLegacyId": "PAT-SYNTHETIC",
        "branchLegacyId": "Cubao",
        "rule": "workbook_title_branch",
        "confidence": "owner_approved"
      },
      "evidence": [
        {
          "source": "manual_sales_tracker",
          "fileId": "DRIVE-FILE-ID",
          "revisionId": "REVISION-ID",
          "workbookTitle": "Manual Sales Tracker - Cubao",
          "workbookBranchLegacyId": "Cubao",
          "sheet": "Manual Sales 2026",
          "rowNumber": 19,
          "rowHash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        }
      ],
      "serviceId": "ARVPEP_ID",
      "doseNumber": 3,
      "patientStandingOrderLegacyId": "PSO-SYNTHETIC",
      "scheduledAt": "2026-08-20T09:00:00+08:00",
      "scheduleBasis": "template_derived"
    }
  ]
}
```

The executable validators are
`apps/backend/src/modules/data_migration/sourceEnvelope.ts` and
`apps/backend/src/modules/data_migration/manualAugmentations.ts`.
