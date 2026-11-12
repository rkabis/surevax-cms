-- 0011_cash_drawer_branch_invariant.sql: forward migration for the branch-wide
-- open-drawer invariant used by the runtime Review Center recovery workflow.
--
-- This migration intentionally does not choose or close duplicate Open rows.
-- If an existing database contains more than one Open drawer for a branch,
-- CREATE UNIQUE INDEX fails and requires an accountable, audited correction
-- before deployment can continue.

SET LOCAL lock_timeout = '5s';

DROP INDEX IF EXISTS cash_drawer_sessions_one_open_per_user_branch;

CREATE UNIQUE INDEX IF NOT EXISTS cash_drawer_sessions_one_open_per_branch
  ON cash_drawer_sessions (tenant_id, branch_id)
  WHERE state = 'Open';
