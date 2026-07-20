-- 0057: correct three false claims that are live in published course content.
--
-- These are not cosmetic. Before real money, content that misstates custody and
-- risk is the thing a user relies on when deciding to deposit:
--
--   1. Course 2 (DeFi) tells users LockedIn splits deposits across Kamino AND
--      Marginfi "for diversification", and that this mitigates smart-contract
--      risk. The v2 program CPIs Kamino only — vault_v2.rs requires
--      p.kamino_program == KLEND_PROGRAM_ID and rejects anything else. There is
--      no diversification, so the risk lesson understates concentration risk.
--   2. Course 1 tells users that if LockedIn's site goes offline their funds are
--      "safe and accessible" through another interface. A normal claim needs an
--      ed25519 completion voucher signed by the ops key; no third-party
--      interface can mint one. The only unattended exit is force_return_v2,
--      callable 180 days after lock start (caps.rs FORCE_RETURN_AFTER_SECS =
--      15_552_000), and it settles with user_yield_bps = 0 — principal returns,
--      ALL yield goes to the community pot.
--   3. Unqualified return figures ("Earns 3-8% APY") are hedged.
--
-- METHOD — this migration is written against the failure modes of 0051/0054:
--
--   (a) 0054 found the catalog serves lesson payloads from lesson.published_
--       lessons (content/repository.mjs listModuleLessons) while getLessonPayload
--       serves lesson.published_lesson_payloads. Every text fix below is applied
--       to BOTH, plus lesson.lesson_blocks so re-publishing cannot resurrect it.
--   (b) Many 0051 patterns were written in SQL-source syntax
--       (jsonb_build_array('a','b'), trailing "$$)," etc). That text never exists
--       in the stored jsonb, so those replacements silently matched nothing —
--       the df-4 flow diagram is still un-fixed in the DB for exactly this
--       reason, and is repaired here. Patterns below are the STORED form: plain
--       prose, newlines as the two characters \n, and jsonb's "key": "value"
--       spacing where an id anchor is needed to disambiguate a short string.
--   (c) Every graded answer that changes also gets lesson.questions.correct_answer,
--       lesson.question_options.option_text AND the payload option text updated
--       together — grading is a normalized text match, so an option that drifts
--       from the key marks the right answer wrong (the 0054 bug).
--   (d) The block ends with a loud verification: residual matches raise an
--       exception, and the touched MCQs are re-checked for key/option
--       agreement. A silent no-op is impossible — see FAILURE POLICY.
--
-- Corrective only: no rows are dropped, no ids or block/question structure
-- change, so enrollments and in-flight attempts are unaffected.
--
-- FAILURE POLICY — why some checks WARN instead of RAISE (post-fix audit)
--
-- This file lives in backend/sql/, so scripts/migrate.mjs executes it
-- unattended on every deploy. As first written, EVERY verification failure was
-- `raise exception`, which aborts the migration and therefore the deploy. Two
-- of those checks (required-pattern-never-matched, and total-no-op) assert
-- something about UPSTREAM CONTENT, not about this migration: their patterns
-- are calibrated against a database built by replaying 0001..0055. Any later
-- content edit or reseed can legitimately reword that prose, at which point an
-- unrelated deploy — a hotfix, say — dies on a stale string match. That is a
-- landmine in the deploy path, and the failure it produces is not the failure
-- anyone is shipping.
--
-- It was NOT moved to backend/sql/deferred/ (the repo's convention for
-- must-not-auto-run migrations, see deferred/drop_legacy_columns.sql), for two
-- reasons. First, it is already committed and may already be recorded in
-- lesson.schema_migrations on prod; removing it from sql/ would then trip the
-- runner's recorded-but-missing-from-disk check and hard-fail the very deploy
-- this is meant to unblock. Second, the false claims it corrects are seeded by
-- migrations 0024/0025/0051, so any database rebuilt by replaying the chain
-- reintroduces them — a deferred file would leave every fresh/staging database
-- serving false custody and risk copy until someone remembered to run it.
--
-- So the checks are split by what they actually prove, and NOTHING is silently
-- weakened — every softened check still shouts and, critically, still leaves a
-- durable, queryable record:
--
--   HARD FAIL (raise exception) — these can only be caused by a bug in THIS
--   file, never by upstream drift, so blocking is correct:
--     * a pattern that matched and whose text SURVIVED the replace;
--     * a graded key with no matching row in lesson.question_options (the
--       UPDATEs above set key and option together, by id, unconditionally —
--       disagreement here means this migration is internally broken).
--
--   WARN + RECORD (raise warning + a row in lesson.content_fix_reports) —
--   these are assertions about upstream content that may have legitimately
--   drifted:
--     * required patterns that matched nothing;
--     * a total no-op against a populated catalog;
--     * a graded key absent from the published payload text.
--   These are NOT ignorable: `select * from lesson.content_fix_reports where
--   unresolved_count > 0` is the operator check, and it is a documented step
--   in docs/mainnet-deploy-runbook.md (§11a). A non-empty result means false
--   content may still be live and the patterns need rewriting against the
--   current stored jsonb — the same investigation the exception demanded,
--   without holding a deploy hostage to it.

do $mig$
declare
  v_tables text[] := array[
    'lesson.lesson_blocks',
    'lesson.published_lesson_payloads',
    'lesson.published_lessons'
  ];
  v_tbl text;
  r record;
  n bigint;
  v_content_rows bigint;
  v_pre_total bigint;
  v_post_total bigint;
  v_sentinel bigint;
  v_zero text;
  v_residual text;
  v_mcq_bad text;
  v_mcq_payload_bad text;
  v_unresolved int := 0;
  v_report text := '';
begin
  -- Durable home for the soft-failure findings (see FAILURE POLICY above). A
  -- warning scrolls past in a deploy log; a row does not.
  create table if not exists lesson.content_fix_reports (
    id bigserial primary key,
    migration text not null,
    ran_at timestamptz not null default now(),
    unresolved_count integer not null,
    detail text not null
  );

  -- required = this exact text was observed in the stored jsonb of a database
  -- built by replaying 0001..0055, so a zero hit means the pattern is wrong.
  -- optional = an older wording that a later seed/migration already superseded;
  -- carried defensively for databases that never took that path.
  create temporary table _c0057 (
    seq serial primary key,
    find text not null,
    repl text not null,
    required boolean not null default true,
    pre_hits bigint not null default 0,
    post_hits bigint not null default 0
  ) on commit drop;

  ---------------------------------------------------------------------------
  -- Claim 1 — LockedIn deposits into Kamino only, and does not diversify
  ---------------------------------------------------------------------------
  insert into _c0057 (find, repl) values

  -- course 1 protocol card
  ($f$Lending (Kamino, Marginfi)$f$,
   $r$Lending (Kamino)$r$),

  -- df-2: where the yield comes from
  ($f$Your locked USDC is deposited into lending protocols like Kamino and Marginfi on Solana. Here's the chain:$f$,
   $r$Your locked USDC is deposited into Kamino, a lending protocol on Solana. Kamino is the only venue LockedIn uses. Here's the chain:$r$),

  ($f$Your locked USDC is deposited into lending protocols like Kamino and Marginfi on Solana. You lock USDC in LockedIn$f$,
   $r$Your locked USDC is deposited into Kamino, the only lending protocol LockedIn uses. You lock USDC in LockedIn$r$),

  ($f$LockedIn's smart contract deposits your USDC into Kamino/Marginfi → Borrowers borrow your USDC and pay interest$f$,
   $r$LockedIn's smart contract deposits your USDC into Kamino → Borrowers borrow your USDC and pay interest$r$),

  ($f$LockedIn deposits into Kamino/Marginfi → Borrowers pay interest$f$,
   $r$LockedIn deposits into Kamino → Borrowers pay interest$r$),

  ($f$Your locked USDC is deposited into lending protocols (Kamino/Marginfi) earning yield.$f$,
   $r$Your locked USDC is deposited into Kamino — one lending protocol, not several — where it earns yield.$r$),

  -- df-3: is the yield real
  ($f$Your USDC is lent out through Kamino/Marginfi, and borrowers pay real interest.$f$,
   $r$Your USDC is lent out through Kamino, and borrowers pay real interest.$r$),

  ($f$Pool deposited into DeFi lending (Kamino/Marginfi) → Earns 3-8% APY from borrowers$f$,
   $r$Pool deposited into Kamino's USDC lending market → Earns a variable rate set by borrower demand (recently in the 3-8% range, never promised)$r$),

  -- df-4: the protocols lesson
  ($f$Meet Kamino and Marginfi$f$,
   $r$Meet Kamino$r$),

  ($f$Your locked USDC is currently deposited in real DeFi protocols on Solana. These aren't abstractions — they're live smart contracts managing billions of dollars. Let's meet them.$f$,
   $r$Your locked USDC is currently deposited in one real DeFi protocol on Solana: Kamino. It isn't an abstraction — it's a live smart contract managing billions of dollars. Let's meet it.$r$),

  ($f$Your locked USDC is currently deposited in real DeFi protocols on Solana. Kamino is a lending and liquidity platform$f$,
   $r$Your locked USDC is currently deposited in exactly one real DeFi protocol on Solana. Kamino is a lending and liquidity platform$r$),

  -- df-4-block-2, long form: the whole "why two protocols" section is false
  ($f$Marginfi\n\nWhat It Is: Marginfi is another lending and borrowing protocol on Solana. It was one of the first major lending platforms in the Solana ecosystem.\n\nWhat It Does: Same core function as Kamino — accepts deposits, lends to borrowers, distributes interest. Think of it as a second automated bank branch.\n\nWhy Use Two Protocols? Diversification. Same reason you wouldn't put all your savings in one bank. By splitting deposits across Kamino and Marginfi, LockedIn:\n- Reduces risk (if one protocol has an issue, not everything is affected)\n- Can optimize for the best rates (shift deposits toward whichever protocol offers higher APY)\n- Avoids concentration (putting too much into one pool can lower rates)$f$,
   $r$Only Kamino\n\nYou may have read elsewhere that LockedIn spreads deposits across several lending protocols. It does not. The on-chain program hard-codes the Kamino Lend program address and rejects a deposit routed anywhere else, so there is exactly one lending venue holding your USDC.\n\nWhy one protocol? Verifiability. One venue means one contract to audit, one rate to read, and one on-chain address you can check yourself.\n\nWhat that costs you — say it plainly:\n- No diversification. If Kamino has a problem, every locked deposit is exposed.\n- No rate shopping. You earn whatever the Kamino USDC market happens to pay.\n- Concentration is real, and it is the single biggest risk in the next lesson.$r$),

  ($f$Analogy: Two Baskets — $f$,
   $r$Analogy: One Basket, Watched Closely. You have heard $r$),

  ($f$Your USDC is spread across multiple protocols so that no single point of failure can affect everything.$f$,
   $r$Your USDC is not spread across multiple protocols. It sits in a single audited lending market, which means Kamino is a single point of failure for every deposit — a real risk, covered honestly in the next lesson.$r$),

  -- df-4-block-2, short form
  ($f$Marginfi is another lending protocol on Solana. Why two? Diversification — don't put all your eggs in one basket. LockedIn reduces risk, optimizes rates, and avoids concentration.$f$,
   $r$LockedIn uses Kamino and only Kamino — the on-chain program rejects any other lending venue. That means no diversification: if Kamino has a problem, every locked deposit is exposed. One protocol is easier to verify, but it concentrates risk instead of spreading it.$r$),

  -- df-4-block-4 flow diagram. 0051 tried to fix this diagram's tail but wrote
  -- its pattern in SQL-source syntax (trailing "$$)," and "  ),"), which never
  -- exists in stored jsonb — so it silently matched nothing and the diagram
  -- still shows a MARGINFI pool and a Jupiter payout hop that do not exist.
  -- This pattern is the stored form, verified against a replayed database.
  ($f$How It All Fits Together:\n\n                    YOUR LOCKED USDC\n                          │\n                LockedIn Smart Contract\n                     │         │\n                ┌────┘         └────┐\n                ▼                   ▼\n           ┌─────────┐       ┌───────────┐\n           │  KAMINO  │       │ MARGINFI  │\n           │ Lending  │       │ Lending   │\n           │  Pool    │       │  Pool     │\n           └────┬─────┘       └────┬──────┘\n                │                   │\n                └──────┐   ┌───────┘\n                       ▼   ▼\n                 Yield flows back\n                       │\n                LockedIn Smart Contract\n                │              │\n          LockedIn fee    the Community Pot\n          (10-20%)             │\n                          Your Yield\n                               │\n                       Jupiter (swap layer)\n                               │\n                          USDC payout$f$,
   $r$How It All Fits Together:\n\n                    YOUR LOCKED USDC\n                          │\n                LockedIn Smart Contract\n                          │\n                          ▼\n                    ┌───────────┐\n                    │  KAMINO   │\n                    │  Lending  │\n                    │   Pool    │\n                    └─────┬─────┘\n                          │\n                   Yield flows back\n                          │\n                LockedIn Smart Contract\n                │                    │\n         You finish            You lapse, or the\n         the course            180-day force-return\n                │                    │\n        Principal + yield     Principal to your wallet,\n         to your wallet        yield to the community pot$r$),

  -- df-4 recaps
  ($f$Quick Recap: Kamino and Marginfi are lending protocols on Solana — your USDC is deposited there to earn yield. Using two protocols = diversification (don't put all eggs in one basket). Jupiter is a swap aggregator — finds the best rates when tokens need to be exchanged.$f$,
   $r$Quick Recap: Kamino is the one lending protocol on Solana where your USDC is deposited to earn yield — LockedIn uses no other venue, and the program rejects one. One protocol means no diversification: Kamino is a single point of failure. Jupiter is a swap aggregator that finds the best rates on Solana generally — your lock does not route through it.$r$),

  ($f$Quick Recap: Kamino and Marginfi are lending protocols — your USDC earns yield there. Two protocols = diversification. Jupiter handles swaps.$f$,
   $r$Quick Recap: Kamino is the single lending protocol where your USDC earns yield. One protocol means no diversification — Kamino is a single point of failure. Jupiter is a Solana swap aggregator; your lock does not route through it.$r$),

  -- df-5: the risk lesson, which currently claims a mitigation that does not exist
  ($f$However, well-established protocols (Kamino, Marginfi) have undergone multiple security audits. They've been running for years with hundreds of millions of dollars — battle-tested. LockedIn mitigates this by using only established, audited protocols and diversifying across multiple protocols.$f$,
   $r$However, Kamino has undergone multiple security audits and has been running for years with hundreds of millions of dollars — battle-tested. LockedIn reduces this risk by using a single established, audited protocol, but it does NOT diversify: all locked USDC sits in Kamino, so a Kamino exploit would affect every deposit. Audits reduce risk; they never remove it.$r$),

  ($f$LockedIn diversifies across protocols to capture the best available rates.$f$,
   $r$LockedIn does not shop between protocols — you earn whatever the Kamino USDC market pays, and that rate moves.$r$),

  ($f$The five risks: 1) Smart contract risk (bugs/exploits — most significant, mitigated by audits and diversification).$f$,
   $r$The five risks: 1) Smart contract risk (bugs/exploits — most significant, reduced by audits but NOT by diversification: every deposit sits in Kamino).$r$),

  ($f$LockedIn mitigates this by using established, audited protocols and diversifying.$f$,
   $r$LockedIn reduces this by using a single established, audited protocol — Kamino — but it does not diversify, so a Kamino exploit would affect every deposit.$r$),

  ($f$LockedIn mitigates risks by using audited protocols and diversifying across them.$f$,
   $r$LockedIn uses one audited protocol, Kamino, and does not diversify across protocols.$r$),

  ($f$LockedIn mitigates with audited protocols and diversification.$f$,
   $r$LockedIn uses one audited protocol, Kamino, and does not diversify.$r$),

  -- df-8 wrap-up
  ($f$The protocols your USDC is in (Kamino, Marginfi, Jupiter).$f$,
   $r$The protocol your USDC is in (Kamino) — and why there is only one.$r$),

  ($f$Let your USDC earn yield through the managed protocols.$f$,
   $r$Let your USDC earn yield through Kamino.$r$),

  -- df-4-q1 is a GRADED question built on the false premise; prompt, key and
  -- all three on-screen options move together (see the lesson.questions and
  -- lesson.question_options updates below).
  ($f$Why does LockedIn split your USDC across multiple DeFi protocols instead of using just one?$f$,
   $r$Which DeFi lending protocols does LockedIn deposit your locked USDC into?$r$),

  ($f$df-4-q1-opt-1", "text": "It's cheaper$f$,
   $r$df-4-q1-opt-1", "text": "Kamino and Marginfi, split for diversification$r$),

  ($f$To diversify risk and optimize for the best rates$f$,
   $r$Kamino only — the program rejects any other lending protocol$r$),

  ($f$Because each protocol holds a different type of USDC$f$,
   $r$Whichever protocol is paying the highest rate that week$r$),

  ---------------------------------------------------------------------------
  -- Claim 2 — your funds are NOT freely reachable from another interface
  ---------------------------------------------------------------------------

  -- bw-5-block-4 (0025 rich-blocks rewrite) — the live wording of the promise
  ($f$When the unlock date arrives, you can claim your funds through another app. The smart contract doesn't need us.$f$,
   $r$But a normal claim needs a completion voucher signed by LockedIn's operator key, so another app cannot simply pay you out. What the contract guarantees on its own is a force-return 180 days after your lock starts: **your principal comes back to your wallet, and the earned yield goes to the community pot**.$r$),

  -- bw-5-q1 is a GRADED question whose key states the false claim
  ($f$It stays in the smart contract on the blockchain — safe and accessible$f$,
   $r$Your principal comes back via the 180-day force-return — but the yield is forfeited$r$);

  ---------------------------------------------------------------------------
  -- Optional: the 0024-era course-1 wordings. 0025 reseeded lessons bw-3 and
  -- bw-5 with different prose, so on a database that replayed every migration
  -- these strings are already gone. They are kept so a database that somehow
  -- still serves the 0024 blocks is corrected too — a zero hit here is expected
  -- and is NOT treated as a failed pattern.
  ---------------------------------------------------------------------------
  insert into _c0057 (find, repl, required) values

  ($f$Even if LockedIn's website went offline, the smart contract would still be running on Solana. Your funds would still be safe and accessible — you'd just need to interact with the contract through a different interface.$f$,
   $r$Even if LockedIn's website went offline, the smart contract would still be running on Solana — but you could not simply claim from another app. A normal claim requires a completion voucher signed by LockedIn's operator key, and no third-party interface can produce one. What the contract guarantees without LockedIn is a force-return that anyone may call 180 days after your lock starts: it sends your principal back to your wallet and forfeits ALL of the earned yield to the community pot. Your principal is protected by code. Your yield depends on LockedIn still being there to sign.$r$, false),

  ($f$The Unlock — When your lock period ends, the contract releases your USDC plus any accrued yield. No approval needed. No waiting period beyond what you agreed to.$f$,
   $r$The Unlock — When you finish the course, the contract returns your USDC plus the yield it earned. This claim is not fully unattended: it needs a completion voucher signed by LockedIn's operator key. If LockedIn ever stopped signing, anyone can trigger a force-return 180 days after your lock starts — your principal goes back to your wallet and the yield goes to the community pot.$r$, false),

  ($f$Your money is never trapped in an app.$f$,
   $r$Your wallet is never trapped in an app — though funds you have already locked in LockedIn's contract still come out on that contract's terms, not the app's.$r$, false);

  ---------------------------------------------------------------------------
  -- Apply
  ---------------------------------------------------------------------------
  select count(*) into v_content_rows from lesson.published_lesson_payloads;

  -- Sampled BEFORE any update: this is what distinguishes an idempotent re-run
  -- (corrected copy already on disk) from a first run whose patterns are wrong.
  -- Sampling it afterwards would always be non-zero and would mask exactly the
  -- silent no-op this migration exists to prevent.
  select count(*) into v_sentinel
    from lesson.published_lessons
   where position($s$the program rejects any other lending protocol$s$ in payload::text) > 0;

  foreach v_tbl in array v_tables loop
    for r in select seq, find from _c0057 order by seq loop
      execute format('select count(*) from %s where position($1 in payload::text) > 0', v_tbl)
        into n using r.find;
      update _c0057 set pre_hits = pre_hits + n where seq = r.seq;
    end loop;
  end loop;

  foreach v_tbl in array v_tables loop
    for r in select seq, find, repl from _c0057 order by seq loop
      execute format(
        'update %s set payload = replace(payload::text, $1, $2)::jsonb where position($1 in payload::text) > 0',
        v_tbl
      ) using r.find, r.repl;
    end loop;
  end loop;

  -- Graded keys and on-screen options, kept in lockstep with the payload text
  -- replaced above. Grading is a normalized text match, so these must agree.
  update lesson.questions
     set prompt = $qp$Which DeFi lending protocols does LockedIn deposit your locked USDC into?$qp$,
         correct_answer = $qc$Kamino only — the program rejects any other lending protocol$qc$
   where id = 'df-4-q1';

  update lesson.question_options
     set option_text = $o1$Kamino and Marginfi, split for diversification$o1$
   where question_id = 'df-4-q1' and option_order = 1;
  update lesson.question_options
     set option_text = $o2$Kamino only — the program rejects any other lending protocol$o2$
   where question_id = 'df-4-q1' and option_order = 2;
  update lesson.question_options
     set option_text = $o3$Whichever protocol is paying the highest rate that week$o3$
   where question_id = 'df-4-q1' and option_order = 3;

  update lesson.questions
     set correct_answer = $qc$Your principal comes back via the 180-day force-return — but the yield is forfeited$qc$
   where id = 'bw-5-q1';

  update lesson.question_options
     set option_text = $o4$Your principal comes back via the 180-day force-return — but the yield is forfeited$o4$
   where question_id = 'bw-5-q1' and option_order = 3;

  ---------------------------------------------------------------------------
  -- Verification — loud by construction
  ---------------------------------------------------------------------------
  foreach v_tbl in array v_tables loop
    for r in select seq, find from _c0057 order by seq loop
      execute format('select count(*) from %s where position($1 in payload::text) > 0', v_tbl)
        into n using r.find;
      update _c0057 set post_hits = post_hits + n where seq = r.seq;
    end loop;
  end loop;

  select coalesce(sum(pre_hits), 0), coalesce(sum(post_hits), 0)
    into v_pre_total, v_post_total from _c0057;

  raise notice '0057: % content rows, % pattern hits before, % after, % pre-existing corrected rows',
    v_content_rows, v_pre_total, v_post_total, v_sentinel;

  select string_agg(format('  #%s "%s"', seq, left(find, 70)), E'\n' order by seq)
    into v_zero from _c0057 where required and pre_hits = 0;
  if v_zero is not null then
    if v_sentinel > 0 then
      -- Corrected copy already present: this is a re-run, not a broken pattern.
      raise notice E'0057: re-run — % required patterns already corrected.',
        (select count(*) from _c0057 where required and pre_hits = 0);
    else
      -- WARN + RECORD, not abort: a required pattern missing its target means
      -- the stored jsonb no longer looks like this text (the 0051 failure), and
      -- the false claim may still be live in some other wording. That needs a
      -- human — but the content is equally broken with or without this deploy,
      -- so blocking the deploy fixes nothing and blocks unrelated hotfixes.
      v_unresolved := v_unresolved
        + (select count(*)::int from _c0057 where required and pre_hits = 0);
      v_report := v_report
        || format(
             E'%s required pattern(s) matched NOTHING — the fix may have silently done nothing (the 0051 failure). Rewrite them against the current stored jsonb:\n%s\n',
             (select count(*) from _c0057 where required and pre_hits = 0), v_zero);
      raise warning E'0057: % required patterns matched NOTHING. The stored jsonb does not contain this text, so the fix may have silently done nothing (the 0051 failure). Recorded in lesson.content_fix_reports — correct the patterns:\n%',
        (select count(*) from _c0057 where required and pre_hits = 0), v_zero;
    end if;
  end if;

  -- HARD FAIL: a pattern that matched and is STILL there means the replace
  -- above did not do what it says. That is a bug in this file — it cannot be
  -- caused by upstream drift (an unmatched pattern has pre = post = 0) — and it
  -- means a false claim we believe we corrected is still being served.
  select string_agg(format('  #%s post=%s "%s"', seq, post_hits, left(find, 70)), E'\n' order by seq)
    into v_residual from _c0057 where post_hits > 0;
  if v_residual is not null then
    raise exception E'0057: false claims SURVIVED the migration:\n%', v_residual;
  end if;

  -- A total no-op against a populated catalog means the patterns are wrong.
  -- Tolerated only when the corrected copy is already present (re-run).
  -- WARN + RECORD for the same reason as the required-pattern check above.
  if v_content_rows > 0 and v_pre_total = 0 and v_sentinel = 0 then
    v_unresolved := v_unresolved + 1;
    v_report := v_report
      || format(
           E'NO-OP: %s lesson payload rows exist but no pattern matched and the corrected copy is absent — the stored jsonb does not look like these patterns.\n',
           v_content_rows);
    raise warning '0057: NO-OP — % lesson payload rows exist but no pattern matched and the corrected copy is absent. The stored jsonb does not look like these patterns. Recorded in lesson.content_fix_reports; fix the patterns.', v_content_rows;
  end if;

  -- The two graded questions must agree with their on-screen options in every
  -- table that serves them. This is the 0054 failure, checked directly.
  --
  -- HARD FAIL half: lesson.questions vs lesson.question_options. Both sides are
  -- set by the unconditional by-id UPDATEs above, so a mismatch here is this
  -- file being internally wrong — nothing upstream can cause it.
  select string_agg(format('  %s / %s', src, qid), E'\n')
    into v_mcq_bad
    from (
      select 'question_options' as src, q.id as qid
        from lesson.questions q
       where q.id in ('df-4-q1', 'bw-5-q1')
         and not exists (
           select 1 from lesson.question_options o
            where o.question_id = q.id and o.option_text = q.correct_answer
         )
    ) bad;

  if v_mcq_bad is not null then
    raise exception E'0057: graded key has no matching option row — learners would be marked wrong for the right answer:\n%', v_mcq_bad;
  end if;

  -- WARN + RECORD half: the published payloads. These depend on the text
  -- patterns above having matched, so drifted content lands here rather than in
  -- the hard failure. Still a real learner-facing bug — hence the record.
  select string_agg(format('  %s / %s', src, qid), E'\n')
    into v_mcq_payload_bad
    from (
      select 'published_lessons' as src, q.id as qid
        from lesson.questions q
        join lesson.published_lessons pl
          on position(format('"id": "%s"', q.id) in pl.payload::text) > 0
       where q.id in ('df-4-q1', 'bw-5-q1')
         and position(q.correct_answer in pl.payload::text) = 0
      union all
      select 'published_lesson_payloads' as src, q.id
        from lesson.questions q
        join lesson.published_lesson_payloads plp
          on position(format('"id": "%s"', q.id) in plp.payload::text) > 0
       where q.id in ('df-4-q1', 'bw-5-q1')
         and position(q.correct_answer in plp.payload::text) = 0
    ) bad;

  if v_mcq_payload_bad is not null then
    v_unresolved := v_unresolved + 1;
    v_report := v_report
      || format(
           E'Graded key absent from the published payload text — learners would be marked wrong for the right answer:\n%s\n',
           v_mcq_payload_bad);
    raise warning E'0057: graded key absent from the published payload text — learners would be marked wrong for the right answer. Recorded in lesson.content_fix_reports:\n%',
      v_mcq_payload_bad;
  end if;

  -- One row per run, always — an absent row is itself a signal that this
  -- migration never executed here.
  insert into lesson.content_fix_reports (migration, unresolved_count, detail)
  values (
    '0057_fix_false_content_claims',
    v_unresolved,
    case
      when v_unresolved = 0 then format(
        'OK — %s false-claim occurrences corrected across %s; graded keys verified.',
        v_pre_total, array_to_string(v_tables, ', '))
      else v_report
    end
  );

  if v_unresolved > 0 then
    raise warning '0057: % unresolved finding(s) recorded in lesson.content_fix_reports. False content may still be live — see docs/mainnet-deploy-runbook.md §11a.',
      v_unresolved;
  else
    raise notice '0057: OK — % false-claim occurrences corrected across %; graded keys verified.',
      v_pre_total, array_to_string(v_tables, ', ');
  end if;
end
$mig$;
