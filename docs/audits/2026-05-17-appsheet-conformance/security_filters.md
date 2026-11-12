# Security Filters (per table)

**Sign-in:** Required (Google auth). "Allow all signed-in users" = OFF.

| Table | Access | Filter |
|---|---|---|
| AdminEmails | as app creator | none |
| Branch | as app creator | `=OR([b_BranchEmail] = USEREMAIL(), IN(USEREMAIL(), AdminEmails[Email]), [b_AllowAccess])` |
| BranchReport | as app creator | `=OR(IN(USEREMAIL(), [br_BranchRef][b_BranchEmail]), IN(USEREMAIL(), AdminEmails[Email]))` |
| CashBalanceLog | as app creator | `=OR([cbl_BranchRef].[b_BranchEmail] = USEREMAIL(), IN(USEREMAIL(), AdminEmails[Email]))` |
| DataRequests | as app creator | none |
| Discount | as app creator | none |
| Immunization | as app creator | `=OR(IN(USEREMAIL(), SELECT(Branch[b_BranchEmail], IN([Row ID], [_THISROW].[i_PatientRef].[p_Branch]))), IN(USEREMAIL(), AdminEmails[Email]), IN(TRUE, SELECT(Branch[b_AllowAccess], IN([Row ID], [_THISROW].[i_PatientRef].[p_Branch]))))` |
| ImmunizationBundle | as app creator | none |
| InventoryLog | as app creator | `=OR([il_BranchRefTo].[b_BranchEmail] = USEREMAIL(), IN(USEREMAIL(), AdminEmails[Email]))` |
| Nurse | as app creator | `=OR(IN(USEREMAIL(), [n_BranchRef][b_BranchEmail]), IN(USEREMAIL(), AdminEmails[Email]))` |
| NurseShift | as app creator | `=OR(USEREMAIL() = [ns_BranchEmail], IN(USEREMAIL(), AdminEmails[Email]))` |
| Patient | as app creator | `=OR(IN(USEREMAIL(), [p_Branch][b_BranchEmail]), IN(USEREMAIL(), AdminEmails[Email]), IN(TRUE, [p_Branch][b_AllowAccess]))` |
| Remarks | as app creator | none |
| TimeLog | as app creator | none |
| Transaction | as app creator | none |
| Vaccine | as app creator | none |

## Role model summary

There is **no formal role table**. AppSheet's "security roles" feature isn't used. The de-facto permission model:

1. **Admin tier:** users whose email is in `AdminEmails` table → see all rows everywhere
2. **Branch nurse tier:** users whose email matches `[b_BranchEmail]` of a Branch → see Patient/Immunization/Transaction/etc. rows scoped to their branch via `[p_Branch] → Branch[b_BranchEmail]`
3. **Allow-list override:** Branches with `[b_AllowAccess] = TRUE` are visible to everyone (likely cross-branch shared resources)
4. **Filter-less tables** (DataRequests, Discount, ImmunizationBundle, Remarks, TimeLog, Transaction, Vaccine, AdminEmails) — every authenticated user sees all rows. **⚠️ Notably Transaction has no filter — financial data leaks across branches.**

## Migration implications

- Replace email-string-matching with proper user_id FK + RBAC role table
- Address the **Transaction filter gap** — likely a bug; branch users can see other branches' financial transactions
- Consolidate the 8+ repeated `IN(USEREMAIL(), AdminEmails[Email])` checks into a single `is_admin(user)` helper
