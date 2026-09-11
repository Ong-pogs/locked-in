-- 0060: seed Course 6 — "Swaps, DEXs & Slippage" (6 beginner lessons).
--
-- First real use of the `defi` category: every shipped course to date is
-- category 'solana', and the only two `defi` rows were the empty placeholder
-- shells. Course 2 teaches lending (how money earns); this teaches trading —
-- the other half of DeFi a user meets the moment they try to move between
-- tokens.
--
-- METHOD — this migration is written against the failure modes of 0051/0054/0057:
--
--   (a) 0057 found that lesson text lives in THREE places that must agree —
--       lesson.lesson_blocks (editorial), lesson.published_lessons (what
--       listModuleLessons serves) and lesson.published_lesson_payloads (what
--       getLessonPayload serves). 0050 and its predecessors satisfied that by
--       typing the same prose twice, which is exactly how the three drift
--       apart. Here every lesson is declared ONCE in v_spec and all three
--       destinations are derived from that single value, so drift is not
--       possible by construction rather than by proofreading.
--   (b) 0057 also had to repair graded MCQ keys that no longer matched their
--       own options. The guard below refuses to seed if any mcq's
--       correctAnswer is not literally one of that question's options, so
--       that class of bug fails the migration instead of reaching a learner.
--   (c) The published payloads are built by lesson.__seed_sanitize_questions,
--       which cannot copy correctAnswer through — the answer key gates real
--       funds and must never ship in a lesson payload (content/repository.mjs
--       sanitizeLessonPayload strips it defensively; this never adds it).
--
-- Lock policy: min_principal_amount_usdc = 10, NOT 5. 0033 lowered beginner
-- courses to 5 and 0059 put them back to 10 because the on-chain floor is $10
-- everywhere that enforces it (caps.rs BETA min = 10_000_000, the v2 deposit
-- form MIN_UI = 10). 0059 has already run, so a new course seeded at 5 would
-- re-introduce a sub-$10 advertised minimum with nothing left to correct it,
-- and the user would hit BelowMinPrincipal on deposit.
--
-- Content rules carried from 0057/0058: no claim that principal is always
-- returned, no unqualified return figures, no invented protocol behaviour.
-- Impermanent loss is described as permanent-unless-price-returns, and LP
-- yield is framed as an estimate that can lose to simply holding.
--
-- Idempotent: early-returns if its publish_release already exists; every
-- content insert is on-conflict-safe. Its own publish_release means the other
-- courses' releases are untouched (content/repository.mjs resolves published
-- rows per lesson with `distinct on (lesson_id) order by release_id desc`).

create extension if not exists pgcrypto;

-- Helper: authoring form -> published (sanitized) form. Dropped at the end of
-- this migration; the leading __seed_ marks it as migration-local.
create or replace function lesson.__seed_sanitize_questions(p_questions jsonb)
returns jsonb
language sql
immutable
as $fn$
  select coalesce(
    jsonb_agg(
      case
        when qs.q->>'type' = 'mcq' then
          jsonb_build_object(
            'id', qs.q->>'id',
            'type', qs.q->>'type',
            'prompt', qs.q->>'prompt',
            'options', (
              select jsonb_agg(
                jsonb_build_object(
                  'id', (qs.q->>'id') || '-opt-' || o.ord,
                  'text', o.val
                )
                order by o.ord
              )
              from jsonb_array_elements_text(qs.q->'options')
                with ordinality as o(val, ord)
            )
          )
        else
          jsonb_build_object(
            'id', qs.q->>'id',
            'type', qs.q->>'type',
            'prompt', qs.q->>'prompt'
          )
      end
      order by qs.ord
    ),
    '[]'::jsonb
  )
  from jsonb_array_elements(p_questions) with ordinality as qs(q, ord);
$fn$;

do $seed$
declare
  v_release_id uuid;
  v_spec       jsonb;
  v_item       record;
  v_version_id uuid;
  v_payload    jsonb;
  v_bad        text;
  v_lessons    integer := 0;
begin
  if exists (
    select 1
    from lesson.publish_releases
    where release_name = 'course6-swaps-dexs-v1'
  ) then
    raise notice 'Seed skipped: course6-swaps-dexs-v1 already exists.';
    return;
  end if;

  ---------------------------------------------------------------------------
  -- 1. Lesson specification — the single source of truth for this course.
  --    lesson.lesson_blocks, lesson.questions, lesson.question_options,
  --    lesson.published_lessons and lesson.published_lesson_payloads are ALL
  --    derived from this value below. Edit here and every destination follows.
  ---------------------------------------------------------------------------
  v_spec := jsonb_build_array(

    -- ── sw-1 ────────────────────────────────────────────────────────────
    jsonb_build_object(
      'lessonId', 'sw-1',
      'slug',     'why-a-dex-isnt-an-exchange',
      'title',    $$Why a DEX Isn't an Exchange$$,
      'order',    1,
      'sourceUrl', 'https://docs.raydium.io/raydium/protocol/concepts',
      'sourceRepo', 'raydium-io/raydium-docs',
      'sourceRef', 'protocol/concepts',
      'sourceLicense', 'Apache-2.0',
      'citationNote', 'AMM vs order book concepts adapted for beginner Course 6.',
      'blocks', jsonb_build_array(
        jsonb_build_object('id','sw-1-block-1','type','paragraph','order',1,'text',$$The Order Book, and Why It Struggles On Chain

A traditional exchange runs an order book: a live list of everyone's bids and asks. Your buy order sits there until someone's sell order matches it. It works beautifully — as long as somebody is on the other side, and as long as posting, editing and cancelling orders is nearly free.

On a blockchain, none of that is free. Every order placed and every order cancelled is a transaction that costs a fee and waits for a block. Market makers who normally requote thousands of times a second would go broke doing it on chain. Early on-chain order books were thin and expensive for exactly this reason.$$),
        jsonb_build_object('id','sw-1-block-2','type','paragraph','order',2,'text',$$The Pool Replaces the Counterparty

An AMM — automated market maker — throws the order book out. Instead of matching you with a person, it holds a liquidity pool: a smart contract stocked with two tokens, say SOL and USDC. You want SOL? You hand the pool USDC and it hands you SOL, priced by a formula rather than by a counterparty.

There is nobody to wait for. The pool quotes a price the instant you ask, at 3am, for any size, with no account and no sign-up. That availability is the whole trick — and it is why "DEX" on Solana almost always means an AMM.$$),
        jsonb_build_object('id','sw-1-block-3','type','callout','order',3,'text',$$You Never Deposit: A centralized exchange makes you send funds in, trade inside their ledger, then withdraw. A DEX swap is one transaction from your own wallet — the tokens leave and arrive in the same instruction. It is atomic: either both legs settle or the whole thing reverts and you keep what you had. You are never holding an IOU.$$,'calloutTone','info')
      ),
      'questions', jsonb_build_array(
        jsonb_build_object('id','sw-1-q1','type','mcq',
          'prompt', $$On an AMM-based DEX, who is on the other side of your trade?$$,
          'correctAnswer', $$A liquidity pool — a smart contract holding both tokens$$,
          'options', jsonb_build_array(
            $$Another trader whose order happened to match yours$$,
            $$A liquidity pool — a smart contract holding both tokens$$,
            $$The DEX company's in-house trading desk$$
          )),
        jsonb_build_object('id','sw-1-q2','type','mcq',
          'prompt', $$What does it mean that a swap is atomic?$$,
          'correctAnswer', $$Either the entire swap settles or it reverts and you keep your tokens$$,
          'options', jsonb_build_array(
            $$Either the entire swap settles or it reverts and you keep your tokens$$,
            $$Nobody else on the network can see that it happened$$,
            $$It is broken into many tiny trades spread over an hour$$
          )),
        jsonb_build_object('id','sw-1-q3','type','short_text',
          'prompt', $$Why is running an order book on chain so expensive compared with an AMM?$$,
          'correctAnswer', $$each order and cancellation costs a transaction fee$$)
      )
    ),

    -- ── sw-2 ────────────────────────────────────────────────────────────
    jsonb_build_object(
      'lessonId', 'sw-2',
      'slug',     'the-constant-product-curve',
      'title',    $$The Constant Product Curve$$,
      'order',    2,
      'sourceUrl', 'https://docs.orca.so/',
      'sourceRepo', 'orca-so/docs',
      'sourceRef', 'concepts',
      'sourceLicense', 'Apache-2.0',
      'citationNote', 'Constant product pricing adapted for beginner Course 6.',
      'blocks', jsonb_build_array(
        jsonb_build_object('id','sw-2-block-1','type','paragraph','order',1,'text',$$One Formula Runs the Whole Thing

The classic AMM pool follows a single rule: x × y = k. Multiply the amount of token X in the pool by the amount of token Y, and that number — k — must not fall.

Say a pool holds 1,000 SOL and 100,000 USDC. k is 100,000,000. The price of SOL right now is just the ratio: 100,000 ÷ 1,000 = $100. Nobody set that price. It falls out of the balances.

Now you buy. You add USDC and take SOL out. The SOL in the pool drops, the USDC rises, and because their product has to stay at k, the ratio moves — SOL just got more expensive. The pool repriced itself automatically, with no oracle and no market maker.$$),
        jsonb_build_object('id','sw-2-block-2','type','paragraph','order',2,'text',$$Depth Decides Your Price

The formula draws a curve, not a straight line, and that matters enormously once your trade gets large.

Buy 1 SOL from that 1,000-SOL pool and you barely move along the curve — you pay about $100. Buy 100 SOL from the same pool and you are taking a tenth of its entire SOL balance; by the last coin you are paying far more than $100, and your average price lands closer to $111.

Same pool, same formula. The only thing that changed is the size of your trade relative to the pool's depth. A deep pool absorbs your order quietly. A shallow one makes you pay for the privilege.$$),
        jsonb_build_object('id','sw-2-block-3','type','callout','order',3,'text',$$The Pool Cannot Be Drained: Because x × y = k approaches the axes without ever touching them, buying the last SOL out of a pool would cost infinite USDC. That is a feature — no trade, however large, can empty a pool. It just gets ruinously expensive first, which is the curve's way of telling you your order is too big for this pool.$$,'calloutTone','info')
      ),
      'questions', jsonb_build_array(
        jsonb_build_object('id','sw-2-q1','type','mcq',
          'prompt', $$In a constant product pool, what has to stay constant?$$,
          'correctAnswer', $$The product of the two token balances$$,
          'options', jsonb_build_array(
            $$The product of the two token balances$$,
            $$The price of each token$$,
            $$The number of traders using the pool$$
          )),
        jsonb_build_object('id','sw-2-q2','type','mcq',
          'prompt', $$A pool holds 1,000 SOL and 100,000 USDC. What price does it quote for SOL?$$,
          'correctAnswer', $$About $100 — the ratio of the two balances$$,
          'options', jsonb_build_array(
            $$About $100 — the ratio of the two balances$$,
            $$Whatever the largest centralized exchange is quoting$$,
            $$About $1,000 — the SOL balance itself$$
          )),
        jsonb_build_object('id','sw-2-q3','type','short_text',
          'prompt', $$Why does buying 100 SOL from a pool cost more per coin than buying 1 SOL?$$,
          'correctAnswer', $$a bigger trade moves further along the curve$$)
      )
    ),

    -- ── sw-3 ────────────────────────────────────────────────────────────
    jsonb_build_object(
      'lessonId', 'sw-3',
      'slug',     'slippage-vs-price-impact',
      'title',    $$Slippage vs Price Impact$$,
      'order',    3,
      'sourceUrl', 'https://station.jup.ag/guides/general/faq',
      'sourceRepo', 'jup-ag/space-station',
      'sourceRef', 'guides/general',
      'sourceLicense', 'Apache-2.0',
      'citationNote', 'Slippage and price impact concepts adapted for beginner Course 6.',
      'blocks', jsonb_build_array(
        jsonb_build_object('id','sw-3-block-1','type','paragraph','order',1,'text',$$Two Different Things Everyone Calls Slippage

Price impact is what YOUR trade does to the price. It is the move along the curve from the last lesson, it is fully knowable before you sign, and the swap screen shows it to you as a percentage. Big trade in a shallow pool, big price impact.

Slippage is what everybody ELSE does to the price in the gap between you pressing confirm and your transaction landing. Blocks take time. Other people trade in that window. The price you were quoted is not the price you are guaranteed.

One is caused by you and is predictable. The other is caused by the world and is not.$$),
        jsonb_build_object('id','sw-3-block-2','type','paragraph','order',2,'text',$$What the Slippage Tolerance Setting Actually Does

That "1%" box on the swap screen is not a fee and not a target. It is a limit attached to your transaction: if I would end up receiving more than 1% less than quoted, cancel the whole thing.

Set it too tight and your swap fails on the smallest wobble — you lose the network fee and try again. Set it too loose and you have announced that you will accept a far worse price than quoted, which is an invitation we come back to in the last lesson.

For a deep pool in calm conditions, a few tenths of a percent is plenty. Thin pools and violent markets need more room.$$),
        jsonb_build_object('id','sw-3-block-3','type','callout','order',3,'text',$$A Failed Swap Is the Setting Working: When a swap reverts for exceeding slippage tolerance, nothing was taken and no tokens moved — you paid only the network fee. That revert is the protection doing precisely its job: refusing a fill worse than the limit you set. Widening the tolerance until swaps stop failing is treating the alarm as the problem.$$,'calloutTone','info')
      ),
      'questions', jsonb_build_array(
        jsonb_build_object('id','sw-3-q1','type','mcq',
          'prompt', $$What is price impact?$$,
          'correctAnswer', $$The price move your own trade causes by travelling along the pool's curve$$,
          'options', jsonb_build_array(
            $$The price move your own trade causes by travelling along the pool's curve$$,
            $$The fee the DEX charges for using it$$,
            $$The price change caused by other people's trades while you wait$$
          )),
        jsonb_build_object('id','sw-3-q2','type','mcq',
          'prompt', $$What does setting slippage tolerance to 1% do?$$,
          'correctAnswer', $$It cancels the swap if you would receive more than 1% less than quoted$$,
          'options', jsonb_build_array(
            $$It cancels the swap if you would receive more than 1% less than quoted$$,
            $$It charges you a 1% fee on the trade$$,
            $$It guarantees you a price 1% better than quoted$$
          )),
        jsonb_build_object('id','sw-3-q3','type','short_text',
          'prompt', $$Your swap reverted for exceeding slippage tolerance. What did that cost you?$$,
          'correctAnswer', $$only the network fee$$)
      )
    ),

    -- ── sw-4 ────────────────────────────────────────────────────────────
    jsonb_build_object(
      'lessonId', 'sw-4',
      'slug',     'liquidity-providing-and-impermanent-loss',
      'title',    $$Being the Pool — LP Tokens & Impermanent Loss$$,
      'order',    4,
      'sourceUrl', 'https://spl.solana.com/token-swap',
      'sourceRepo', 'solana-labs/solana-program-library',
      'sourceRef', 'token-swap',
      'sourceLicense', 'Apache-2.0',
      'citationNote', 'Liquidity provision and impermanent loss adapted for beginner Course 6.',
      'blocks', jsonb_build_array(
        jsonb_build_object('id','sw-4-block-1','type','paragraph','order',1,'text',$$Somebody Had to Put the Tokens There

Every pool you trade against was stocked by liquidity providers — ordinary users who deposited both tokens in the pool's current ratio. In return they receive LP tokens: a receipt representing their share of the pool.

Traders pay a fee on every swap, commonly around 0.25% to 0.30%, and that fee stays in the pool. So the pool grows slightly with each trade, and every LP token becomes redeemable for a little more than before. Burn your LP tokens and you withdraw your share, fees included.$$),
        jsonb_build_object('id','sw-4-block-2','type','paragraph','order',2,'text',$$Impermanent Loss, Honestly

Here is the part the yield numbers do not show you. When one token's price moves, arbitrage traders rebalance the pool — buying the cheap side until the pool's ratio matches the outside market. That rebalancing is automatic, and it always leaves you holding more of the token that fell and less of the token that rose.

The result: withdrawing after a large price move returns less value than if you had simply held the two tokens in your wallet and done nothing. That gap is called impermanent loss, and the name misleads — it is only "impermanent" if the price happens to wander back to where it started. If it does not, the loss is entirely permanent.

Fees earned can outweigh it. They also might not. Providing liquidity is a real position with real risk, not a savings account.$$),
        jsonb_build_object('id','sw-4-block-3','type','callout','order',3,'text',$$The Honest Comparison: The benchmark for an LP position is not "did my balance go up" — it is "did I end up with more than if I had just held both tokens?" A pool advertising a high rate on a volatile pair can still leave you behind that benchmark. Judge liquidity provision against holding, and treat any advertised yield as an estimate, never a promise.$$,'calloutTone','info')
      ),
      'questions', jsonb_build_array(
        jsonb_build_object('id','sw-4-q1','type','mcq',
          'prompt', $$What do you receive for depositing tokens into a liquidity pool?$$,
          'correctAnswer', $$LP tokens — a receipt for your share of the pool$$,
          'options', jsonb_build_array(
            $$LP tokens — a receipt for your share of the pool$$,
            $$A fixed interest payment from the DEX$$,
            $$An NFT proving you own the pool$$
          )),
        jsonb_build_object('id','sw-4-q2','type','mcq',
          'prompt', $$What is impermanent loss?$$,
          'correctAnswer', $$Ending up with less value than if you had simply held both tokens$$,
          'options', jsonb_build_array(
            $$Ending up with less value than if you had simply held both tokens$$,
            $$A fee the pool charges liquidity providers to withdraw$$,
            $$Tokens that are permanently locked and cannot be recovered$$
          )),
        jsonb_build_object('id','sw-4-q3','type','short_text',
          'prompt', $$What should you compare an LP position's result against to judge it fairly?$$,
          'correctAnswer', $$just holding both tokens$$)
      )
    ),

    -- ── sw-5 ────────────────────────────────────────────────────────────
    jsonb_build_object(
      'lessonId', 'sw-5',
      'slug',     'routing-and-aggregators',
      'title',    $$Routing & Aggregators — Why Your Trade Gets Split$$,
      'order',    5,
      'sourceUrl', 'https://station.jup.ag/docs/',
      'sourceRepo', 'jup-ag/space-station',
      'sourceRef', 'docs',
      'sourceLicense', 'Apache-2.0',
      'citationNote', 'Routing and aggregation concepts adapted for beginner Course 6.',
      'blocks', jsonb_build_array(
        jsonb_build_object('id','sw-5-block-1','type','paragraph','order',1,'text',$$There Is Not One Pool

Solana hosts many DEXes — Orca, Raydium, Meteora and others — and each can run several pools for the very same pair, with different depths and different fees. There is no single "SOL/USDC price"; at any instant there are dozens of slightly different ones.

Worse, the pair you actually want may not exist. Swapping one obscure token for another obscure token? Quite possibly no pool holds both. But a path might: token A to SOL, then SOL to token B. Two hops, still one transaction.$$),
        jsonb_build_object('id','sw-5-block-2','type','paragraph','order',2,'text',$$What an Aggregator Does For You

An aggregator such as Jupiter sits above all of them. Ask it for a swap and it searches the routes: direct pools, two- and three-hop paths, and — for larger orders — splitting your trade across several pools at once so that no single pool absorbs the whole price impact.

That last part matters more than it sounds. Remember the curve: a 100-SOL order into one pool travels a long way along it. The same order split four ways across four pools barely moves any of them, and you keep much more of the quoted price.

The cost is complexity. More hops means more accounts touched and a slightly higher network fee. On anything but the smallest trade, the better route wins comfortably.$$),
        jsonb_build_object('id','sw-5-block-3','type','callout','order',3,'text',$$Route Quality Is Price: Two apps quoting the same pair can hand you meaningfully different amounts purely because one found a better path. When you compare swap venues you are comparing routing engines as much as anything else — the pools underneath are largely the same public pools.$$,'calloutTone','info')
      ),
      'questions', jsonb_build_array(
        jsonb_build_object('id','sw-5-q1','type','mcq',
          'prompt', $$Why can an aggregator get you a better price on a large swap?$$,
          'correctAnswer', $$It splits the order across several pools so no single pool takes the full price impact$$,
          'options', jsonb_build_array(
            $$It splits the order across several pools so no single pool takes the full price impact$$,
            $$It waits until the price improves before submitting$$,
            $$It removes the network fee entirely$$
          )),
        jsonb_build_object('id','sw-5-q2','type','mcq',
          'prompt', $$You want to swap token A for token B, but no pool holds both. What can a router do?$$,
          'correctAnswer', $$Route through an intermediate token — A to SOL, then SOL to B$$,
          'options', jsonb_build_array(
            $$Route through an intermediate token — A to SOL, then SOL to B$$,
            $$Create a brand new pool for you automatically$$,
            $$Nothing — the swap is impossible$$
          )),
        jsonb_build_object('id','sw-5-q3','type','short_text',
          'prompt', $$What is a multi-hop route?$$,
          'correctAnswer', $$a swap through an intermediate token$$)
      )
    ),

    -- ── sw-6 ────────────────────────────────────────────────────────────
    jsonb_build_object(
      'lessonId', 'sw-6',
      'slug',     'mev-and-sandwich-attacks',
      'title',    $$MEV & Sandwich Attacks — Why Tolerance Is a Security Setting$$,
      'order',    6,
      'sourceUrl', 'https://solana.com/docs/core/transactions',
      'sourceRepo', 'solana-labs/solana',
      'sourceRef', 'docs/core/transactions',
      'sourceLicense', 'Apache-2.0',
      'citationNote', 'Transaction ordering and MEV concepts adapted for beginner Course 6.',
      'blocks', jsonb_build_array(
        jsonb_build_object('id','sw-6-block-1','type','paragraph','order',1,'text',$$Your Pending Trade Is Public

A transaction you sign does not land instantly. It travels to validators and waits to be included in a block. In that window it is visible — and it states exactly what you intend to buy, how much of it, and the worst price you are willing to accept.

Sophisticated bots watch that flow constantly. Extracting profit from the ordering of transactions has a name: MEV, or maximal extractable value. Not all of it is hostile — arbitrage between pools is MEV, and it is the thing keeping pool prices honest. But one form is aimed squarely at you.$$),
        jsonb_build_object('id','sw-6-block-2','type','paragraph','order',2,'text',$$The Sandwich

A bot spots your pending buy. It buys the same token first, pushing the price up along the curve. Your trade then executes at that worse price, pushing it up further. The bot immediately sells into your buy and pockets the difference. Your order is the filling in the sandwich.

Notice what made it possible: your slippage tolerance. It is a public statement of how much worse than quoted you will accept. A 1% tolerance caps what a bot can extract at roughly 1%. A 20% tolerance — the kind people set to stop swaps failing — tells the bot it may take up to 20%, and it will take very nearly all of it.

The defences are practical. Keep the tolerance as tight as the pool allows, prefer deep pools where the same attack costs a bot far more to mount, and use a swap app that supports private transaction submission so bots never see your order waiting.$$),
        jsonb_build_object('id','sw-6-block-3','type','callout','order',3,'text',$$Tolerance Is a Security Setting: The slippage box is the one number that decides your worst case. Nothing else on the swap screen protects you as directly. Raising it to force a stubborn swap through is the same as raising the ceiling on what a sandwich bot is permitted to take — set it deliberately, not by trial and error.$$,'calloutTone','info')
      ),
      'questions', jsonb_build_array(
        jsonb_build_object('id','sw-6-q1','type','mcq',
          'prompt', $$In a sandwich attack, what does the bot do?$$,
          'correctAnswer', $$Buys just before your trade and sells just after, profiting from the price it pushed$$,
          'options', jsonb_build_array(
            $$Buys just before your trade and sells just after, profiting from the price it pushed$$,
            $$Steals the tokens directly out of your wallet$$,
            $$Cancels your transaction before it reaches a validator$$
          )),
        jsonb_build_object('id','sw-6-q2','type','mcq',
          'prompt', $$Why does a very high slippage tolerance make a sandwich attack worse?$$,
          'correctAnswer', $$It tells bots how much worse than quoted you will accept, so they take up to that much$$,
          'options', jsonb_build_array(
            $$It tells bots how much worse than quoted you will accept, so they take up to that much$$,
            $$It makes your transaction take longer to confirm$$,
            $$It increases the network fee you pay$$
          )),
        jsonb_build_object('id','sw-6-q3','type','short_text',
          'prompt', $$Which setting most directly caps how much a sandwich bot can take from your trade?$$,
          'correctAnswer', $$slippage tolerance$$)
      )
    )
  );

  ---------------------------------------------------------------------------
  -- 2. Guards — refuse to seed malformed content (METHOD (b) above).
  ---------------------------------------------------------------------------

  -- Every mcq's correct answer must be one of its own options, or grading is
  -- unwinnable. `?` tests membership of a top-level string in a jsonb array.
  select string_agg(q->>'id', ', ')
    into v_bad
    from jsonb_array_elements(v_spec) as l,
         lateral jsonb_array_elements(l->'questions') as q
   where q->>'type' = 'mcq'
     and not ((q->'options') ? (q->>'correctAnswer'));

  if v_bad is not null then
    raise exception
      '0060: mcq correctAnswer is not among its own options for question(s): % — grading would be unwinnable.',
      v_bad;
  end if;

  -- Short-text answers are graded by keyword match against the answer key, so
  -- an empty key would accept anything.
  select string_agg(q->>'id', ', ')
    into v_bad
    from jsonb_array_elements(v_spec) as l,
         lateral jsonb_array_elements(l->'questions') as q
   where coalesce(q->>'correctAnswer', '') = '';

  if v_bad is not null then
    raise exception '0060: question(s) % have an empty correctAnswer.', v_bad;
  end if;

  ---------------------------------------------------------------------------
  -- 3. Course
  ---------------------------------------------------------------------------
  insert into lesson.courses (
    id, slug, title, description, category, difficulty, estimated_minutes,
    min_principal_amount_usdc, max_principal_amount_usdc, demo_principal_amount_usdc,
    min_lock_duration_days, max_lock_duration_days
  ) values (
    'swaps-and-dexs',
    'swaps-dexs-and-slippage',
    'Swaps, DEXs & Slippage',
    'How trading actually works on Solana — why a DEX is a pool and not an order book, what really sets your price, the difference between slippage and price impact, and why your tolerance setting is the one that protects you.',
    'defi',
    'beginner',
    45,
    10,   -- see header: 0059 restored the beginner floor to the on-chain $10
    100,
    1,
    10,
    30
  )
  on conflict (id) do update set
    title = excluded.title,
    description = excluded.description,
    category = excluded.category,
    difficulty = excluded.difficulty,
    estimated_minutes = excluded.estimated_minutes,
    min_principal_amount_usdc = excluded.min_principal_amount_usdc,
    max_principal_amount_usdc = excluded.max_principal_amount_usdc,
    demo_principal_amount_usdc = excluded.demo_principal_amount_usdc,
    min_lock_duration_days = excluded.min_lock_duration_days,
    max_lock_duration_days = excluded.max_lock_duration_days,
    updated_at = now();

  ---------------------------------------------------------------------------
  -- 4. Module
  ---------------------------------------------------------------------------
  insert into lesson.modules (
    id, slug, title, description, difficulty, estimated_minutes
  ) values (
    'swaps-and-dexs-module-core',
    'swaps-and-dexs-core',
    'Swaps, DEXs & Slippage Core',
    'Core module for Course 6: Swaps, DEXs & Slippage.',
    'beginner',
    45
  )
  on conflict (id) do update set
    title = excluded.title,
    description = excluded.description,
    difficulty = excluded.difficulty,
    estimated_minutes = excluded.estimated_minutes,
    updated_at = now();

  insert into lesson.course_modules (course_id, module_id, module_order, is_required) values
    ('swaps-and-dexs', 'swaps-and-dexs-module-core', 1, true)
  on conflict (course_id, module_id) do update set
    module_order = excluded.module_order,
    is_required = excluded.is_required;

  ---------------------------------------------------------------------------
  -- 5. Lessons + module wiring (derived from v_spec)
  ---------------------------------------------------------------------------
  insert into lesson.lessons (id, slug, title)
  select l->>'lessonId', l->>'slug', l->>'title'
    from jsonb_array_elements(v_spec) as l
  on conflict (id) do update set
    title = excluded.title,
    updated_at = now();

  insert into lesson.module_lessons (module_id, lesson_id, lesson_order, is_required)
  select 'swaps-and-dexs-module-core', l->>'lessonId', (l->>'order')::int, true
    from jsonb_array_elements(v_spec) as l
  on conflict (module_id, lesson_id) do update set
    lesson_order = excluded.lesson_order,
    is_required = excluded.is_required;

  ---------------------------------------------------------------------------
  -- 6. Publish release (this course's own — other courses are untouched)
  ---------------------------------------------------------------------------
  insert into lesson.publish_releases (release_name, notes, created_by)
  values (
    'course6-swaps-dexs-v1',
    'Course 6: Swaps, DEXs & Slippage — 6 beginner lessons covering AMMs vs order books, constant product pricing, slippage vs price impact, liquidity provision and impermanent loss, routing and aggregators, and MEV/sandwich defence.',
    'seed-script'
  )
  returning id into v_release_id;

  ---------------------------------------------------------------------------
  -- 7. Per-lesson: version, blocks, questions, options, attribution, payloads.
  --    Every destination below reads from v_spec, so lesson.lesson_blocks and
  --    the two published tables cannot disagree (METHOD (a) above).
  ---------------------------------------------------------------------------
  for v_item in
    select value as l from jsonb_array_elements(v_spec) order by (value->>'order')::int
  loop
    insert into lesson.lesson_versions (
      lesson_id, version, state, release_id, changelog, source_fingerprint, created_by, published_at
    ) values (
      v_item.l->>'lessonId',
      1,
      'published',
      v_release_id,
      'Initial lesson: ' || (v_item.l->>'title') || '.',
      md5((v_item.l->>'lessonId') || '-v1'),
      'seed-script',
      now()
    )
    returning id into v_version_id;

    -- Editorial blocks
    insert into lesson.lesson_blocks (lesson_version_id, block_order, block_type, payload)
    select v_version_id, (b->>'order')::int, b->>'type', b
      from jsonb_array_elements(v_item.l->'blocks') as b;

    -- Graded questions (answer key stays here, never in a payload)
    insert into lesson.questions (
      id, lesson_version_id, question_order, question_type, prompt, correct_answer, metadata
    )
    select q->>'id', v_version_id, t.ord::int, q->>'type', q->>'prompt', q->>'correctAnswer', '{}'::jsonb
      from jsonb_array_elements(v_item.l->'questions') with ordinality as t(q, ord);

    -- MCQ options, in the same order the payload will render them
    insert into lesson.question_options (question_id, option_order, option_text)
    select q->>'id', o.ord::int, o.val
      from jsonb_array_elements(v_item.l->'questions') as q,
           lateral jsonb_array_elements_text(q->'options') with ordinality as o(val, ord)
     where q->>'type' = 'mcq';

    insert into lesson.source_attributions (
      lesson_version_id, source_url, source_repo, source_ref, source_license, citation_note
    ) values (
      v_version_id,
      v_item.l->>'sourceUrl',
      v_item.l->>'sourceRepo',
      v_item.l->>'sourceRef',
      v_item.l->>'sourceLicense',
      v_item.l->>'citationNote'
    );

    -- Published payload: same blocks, sanitized questions, no answer key.
    v_payload := jsonb_build_object(
      'id',        v_item.l->>'lessonId',
      'courseId',  'swaps-and-dexs',
      'moduleId',  'swaps-and-dexs-module-core',
      'title',     v_item.l->>'title',
      'order',     (v_item.l->>'order')::int,
      'version',   1,
      'releaseId', v_release_id::text,
      'blocks',    v_item.l->'blocks',
      'questions', lesson.__seed_sanitize_questions(v_item.l->'questions')
    );

    -- Belt and braces: the answer key must not have survived into the payload.
    if v_payload::text like '%correctAnswer%' then
      raise exception
        '0060: lesson % payload contains correctAnswer — the answer key would ship to the client.',
        v_item.l->>'lessonId';
    end if;

    insert into lesson.published_lessons (
      release_id, lesson_id, module_id, lesson_version_id, lesson_order, payload
    ) values (
      v_release_id,
      v_item.l->>'lessonId',
      'swaps-and-dexs-module-core',
      v_version_id,
      (v_item.l->>'order')::int,
      v_payload
    );

    insert into lesson.published_lesson_payloads (release_id, lesson_id, payload, content_hash)
    values (v_release_id, v_item.l->>'lessonId', v_payload, md5(v_payload::text));

    v_lessons := v_lessons + 1;
  end loop;

  ---------------------------------------------------------------------------
  -- 8. Published module
  ---------------------------------------------------------------------------
  insert into lesson.published_modules (release_id, course_id, module_id, module_order, payload)
  values (
    v_release_id,
    'swaps-and-dexs',
    'swaps-and-dexs-module-core',
    1,
    jsonb_build_object(
      'id', 'swaps-and-dexs-module-core',
      'courseId', 'swaps-and-dexs',
      'slug', 'swaps-and-dexs-core',
      'title', 'Swaps, DEXs & Slippage Core',
      'description', 'Core module for Course 6: Swaps, DEXs & Slippage.',
      'order', 1,
      'difficulty', 'beginner',
      'totalLessons', v_lessons,
      'estimatedMinutes', 45
    )
  );

  ---------------------------------------------------------------------------
  -- 9. Self-verification — the seed must have produced what it claimed.
  ---------------------------------------------------------------------------
  if v_lessons <> 6 then
    raise exception '0060: expected to publish 6 lessons, published %.', v_lessons;
  end if;

  if (select count(*) from lesson.published_lessons where release_id = v_release_id) <> 6 then
    raise exception '0060: published_lessons row count does not match the 6 seeded lessons.';
  end if;

  if (select count(*) from lesson.published_lesson_payloads where release_id = v_release_id) <> 6 then
    raise exception '0060: published_lesson_payloads row count does not match the 6 seeded lessons.';
  end if;

  -- Each MCQ must have exactly the 3 options it declared, in the DB.
  if exists (
    select 1
      from lesson.questions q
      join lesson.lesson_versions lv on lv.id = q.lesson_version_id
     where lv.release_id = v_release_id
       and q.question_type = 'mcq'
       and (select count(*) from lesson.question_options o where o.question_id = q.id) <> 3
  ) then
    raise exception '0060: an mcq did not land exactly 3 options.';
  end if;

  -- And its stored answer key must still match one of its stored options.
  if exists (
    select 1
      from lesson.questions q
      join lesson.lesson_versions lv on lv.id = q.lesson_version_id
     where lv.release_id = v_release_id
       and q.question_type = 'mcq'
       and not exists (
         select 1 from lesson.question_options o
          where o.question_id = q.id and o.option_text = q.correct_answer
       )
  ) then
    raise exception '0060: a stored mcq answer key does not match any of its stored options.';
  end if;

  raise notice 'Course 6 Swaps, DEXs & Slippage release complete. Release ID: %, lessons: %.',
    v_release_id, v_lessons;
end;
$seed$;

drop function if exists lesson.__seed_sanitize_questions(jsonb);
