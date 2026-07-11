-- 0052: fix the 5 quiz options still referencing deleted Fuel/Ichor.
-- 0051 matched options by UUID, but option ids are generated per-environment, so
-- those updates missed on prod (and would miss on any fresh DB). Match by
-- option_text instead — deterministic and idempotent. This also re-aligns the
-- correct option with questions.correct_answer (0051 already updated the answer).
do $mig$
begin
  update lesson.question_options
     set option_text = $r1$Principal is your locked USDC, always returned; yield is the interest it earns, forfeited only if you lapse$r1$
   where option_text = $f1$Both are counters, but Ichor can be redeemed for USDC while Fuel cannot$f1$;

  update lesson.question_options
     set option_text = $r2$Yield is worth more money than your principal$r2$
   where option_text = $f2$Fuel is worth more money than Ichor$f2$;

  update lesson.question_options
     set option_text = $r3$The smart contract returns your principal plus the yield it earned to your wallet$r3$
   where option_text = $f3$The smart contract burns your Ichor counter and sends USDC to your wallet$f3$;

  update lesson.question_options
     set option_text = $r4$Your yield is converted to SOL and then to USDC$r4$
   where option_text = $f4$Ichor is converted to SOL and then to USDC$f4$;

  update lesson.question_options
     set option_text = $r5$Tokens are sent to you from LockedIn's own funds$r5$
   where option_text = $f5$Ichor tokens are sent directly to your wallet$f5$;
end
$mig$;
