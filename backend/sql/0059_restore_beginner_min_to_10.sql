-- 0059: restore the beginner course minimum deposit to 10 USDC (reverse 0033).
--
-- This is a real UX/correctness fix before mainnet beta, not cosmetics. The
-- on-chain floor is $10 everywhere that enforces it: BETA caps min = $10
-- (programs/locked_in/src/caps.rs, 10_000_000), the mainnet init default
-- CAP_MIN = $10 (scripts/deploy/init-mainnet-vault.mjs), and the v2 deposit
-- form MIN_UI = $10. The lone outlier is the course API lockPolicy: 0033 set
-- lesson.courses.min_principal_amount_usdc = 5 for beginner courses. A user
-- shown "$5" by that policy then hits BelowMinPrincipal on-chain at $10 — a
-- false minimum and a broken deposit. Bringing the policy back to $10 makes
-- the number the user sees the number the chain accepts.
--
-- METHOD — mirror 0033's exact WHERE so only the rows it changed are touched
-- (beginner rows currently at 5). Additive/corrective: no drops. Idempotent —
-- if 0033 was never applied here there is simply nothing at 5 to move, the
-- UPDATE matches zero rows, and the verification passes. A second run is a
-- no-op for the same reason.

do $mig$
declare
  v_moved   integer;
  v_residual integer;
begin
  update lesson.courses
     set min_principal_amount_usdc = 10
   where difficulty = 'beginner'
     and min_principal_amount_usdc = 5;
  get diagnostics v_moved = row_count;

  -- No beginner course may still advertise a sub-$10 minimum the chain rejects.
  select count(*) into v_residual
    from lesson.courses
   where difficulty = 'beginner'
     and min_principal_amount_usdc = 5;

  if v_residual > 0 then
    raise exception
      '0059: % beginner course(s) still at min_principal_amount_usdc = 5 after update — course API would show a sub-$10 minimum the chain rejects (BelowMinPrincipal).',
      v_residual;
  end if;

  raise notice
    '0059: OK — restored % beginner course(s) to min_principal_amount_usdc = 10; 0 remain at 5.',
    v_moved;
end
$mig$;
