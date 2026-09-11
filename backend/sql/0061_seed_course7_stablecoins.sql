-- 0061: seed Course 7 — "Stablecoins & Money On Chain" (6 beginner lessons).
--
-- First real use of the `web3` category. This course grounds the asset users
-- actually lock on this platform: every deposit, every yield figure and every
-- claim is denominated in USDC, and until now nothing in the catalog explained
-- what that token is, who stands behind it, or how it can fail.
--
-- METHOD — identical to 0060, and written against the same failure modes
-- (0051/0054/0057):
--
--   (a) Each lesson is declared ONCE in v_spec; lesson.lesson_blocks,
--       lesson.published_lessons and lesson.published_lesson_payloads are all
--       derived from that single value, so the three cannot drift apart.
--   (b) A guard refuses the seed if any mcq's correctAnswer is not literally
--       one of that question's own options — the 0057 repair bug, made
--       impossible rather than proofread.
--   (c) Published payloads are built by lesson.__seed_sanitize_questions,
--       which has no path to copy correctAnswer through, plus an explicit
--       post-build assertion that the answer key did not leak.
--
-- Lock policy: min_principal_amount_usdc = 10, matching the on-chain floor
-- restored by 0059 (caps.rs BETA min = 10_000_000, v2 deposit form MIN_UI =
-- 10). Seeding 5 here would re-introduce the false sub-$10 minimum 0059 fixed.
--
-- Content rules carried from 0057/0058, and they bite hard in this course:
-- the depeg lesson states plainly that USDC's 2023 recovery depended on an
-- external decision and is not a promise about next time; the fiat-backed
-- lesson names issuer/bank counterparty risk and freeze capability outright;
-- attestation is distinguished from audit; and nothing claims a stablecoin is
-- insured, risk-free, or guaranteed to hold its peg.
--
-- Idempotent: early-returns if its publish_release already exists. Its own
-- publish_release leaves every other course untouched.

create extension if not exists pgcrypto;

-- Helper: authoring form -> published (sanitized) form. Created and dropped by
-- this migration (0060 drops its own copy), so the two are independent.
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
    where release_name = 'course7-stablecoins-v1'
  ) then
    raise notice 'Seed skipped: course7-stablecoins-v1 already exists.';
    return;
  end if;

  ---------------------------------------------------------------------------
  -- 1. Lesson specification — the single source of truth for this course.
  ---------------------------------------------------------------------------
  v_spec := jsonb_build_array(

    -- ── sc-1 ────────────────────────────────────────────────────────────
    jsonb_build_object(
      'lessonId', 'sc-1',
      'slug',     'what-stable-actually-means',
      'title',    $$What "Stable" Actually Means$$,
      'order',    1,
      'sourceUrl', 'https://www.circle.com/usdc',
      'sourceRepo', 'circlefin/stablecoin-evm',
      'sourceRef', 'docs',
      'sourceLicense', 'Apache-2.0',
      'citationNote', 'Stablecoin peg concepts adapted for beginner Course 7.',
      'blocks', jsonb_build_array(
        jsonb_build_object('id','sc-1-block-1','type','paragraph','order',1,'text',$$A Price That Someone Defends

A stablecoin is a token designed to hold a steady value — almost always one US dollar. USDC, USDT, PYUSD: all aiming at 1.00 dollars.

But nothing in the code forces that. A token cannot decree its own price any more than a share certificate can. The peg holds because of a mechanism outside the token: someone stands ready to swap it for a real dollar, or a system stands ready to buy it when it dips. Remove that mechanism and the "stable" part evaporates immediately.

So the useful question is never "is this a stablecoin?" It is "what exactly is defending this peg, and who is doing the defending?"$$),
        jsonb_build_object('id','sc-1-block-2','type','paragraph','order',2,'text',$$Why Anyone Wants One

Crypto without stablecoins is exhausting. Every price is quoted in a volatile asset, every transfer is a bet on that asset's next hour, and nobody can quote you a stable price for anything.

A stablecoin makes a chain usable as money. You can hold value without holding volatility, price goods, settle debts, and — crucially for lending and trading — share a unit of account everyone agrees on. It is why the largest markets on almost every chain are stablecoin pairs, and why the money you lock on this platform is USDC rather than SOL.$$),
        jsonb_build_object('id','sc-1-block-3','type','callout','order',3,'text',$$Stable Is a Design Goal, Not a Guarantee: "Stablecoin" describes what a token is trying to do, not what it is certain to achieve. Every one of them can trade below a dollar, and some have gone to zero. The rest of this course is about telling apart the designs where that is a brief wobble from the designs where it is fatal.$$,'calloutTone','warning')
      ),
      'questions', jsonb_build_array(
        jsonb_build_object('id','sc-1-q1','type','mcq',
          'prompt', $$What actually makes a stablecoin hold its price?$$,
          'correctAnswer', $$A mechanism outside the token — someone redeeming or defending it$$,
          'options', jsonb_build_array(
            $$A mechanism outside the token — someone redeeming or defending it$$,
            $$Code inside the token that fixes its price at one dollar$$,
            $$A rule enforced by the blockchain itself$$
          )),
        jsonb_build_object('id','sc-1-q2','type','mcq',
          'prompt', $$Why are stablecoins so widely used across DeFi?$$,
          'correctAnswer', $$They let you hold and price value without holding volatility$$,
          'options', jsonb_build_array(
            $$They let you hold and price value without holding volatility$$,
            $$They pay a guaranteed rate of interest$$,
            $$They are the only tokens that can be sent between wallets$$
          )),
        jsonb_build_object('id','sc-1-q3','type','short_text',
          'prompt', $$What is the question you should ask about any stablecoin's peg?$$,
          'correctAnswer', $$what mechanism defends it$$)
      )
    ),

    -- ── sc-2 ────────────────────────────────────────────────────────────
    jsonb_build_object(
      'lessonId', 'sc-2',
      'slug',     'who-backs-usdc',
      'title',    $$Who Backs USDC$$,
      'order',    2,
      'sourceUrl', 'https://www.circle.com/transparency',
      'sourceRepo', 'circlefin/stablecoin-evm',
      'sourceRef', 'transparency',
      'sourceLicense', 'Apache-2.0',
      'citationNote', 'USDC reserve and redemption model adapted for beginner Course 7.',
      'blocks', jsonb_build_array(
        jsonb_build_object('id','sc-2-block-1','type','paragraph','order',1,'text',$$One Token, One Dollar, Held Somewhere Real

USDC is issued by Circle, a regulated US company, and the model is deliberately boring. You give Circle a dollar, Circle mints one USDC and sends it to you. You return one USDC, Circle burns it and wires you a dollar. Supply expands and contracts with real deposits.

Those dollars are not stacked in a vault as cash. They are held as reserves — largely short-dated US Treasury bills and cash at banks — in accounts kept separate from Circle's own corporate money. Circle publishes monthly attestation reports from an independent accounting firm stating what the reserves held and what they were worth.$$),
        jsonb_build_object('id','sc-2-block-2','type','paragraph','order',2,'text',$$What This Buys, and What It Costs

The upside is the strongest peg mechanism available. If USDC trades at 0.99 dollars, anyone who can redeem with Circle buys it cheap and redeems it for a full dollar, and that arbitrage pushes the price back up. The peg is defended by the profit motive of everyone who can reach the redemption window.

The cost is that you are trusting a company and its banks. Circle can freeze specific addresses, and has done so at law enforcement request. If its reserves were mismanaged or its banks failed, the token would follow them down. That is a real, concentrated counterparty risk rather than a theoretical one — and it is precisely the trade you accept in exchange for the sturdiest peg on offer.$$),
        jsonb_build_object('id','sc-2-block-3','type','callout','order',3,'text',$$Attestation Is Not the Same as Audit: A monthly attestation is an accountant confirming a snapshot of what the reserves held on a particular date. That is meaningful, and it is public — and it is a narrower exercise than a full audit of the company. Read reserve reports as strong evidence rather than as a guarantee, and check that the one you are reading is recent.$$,'calloutTone','info')
      ),
      'questions', jsonb_build_array(
        jsonb_build_object('id','sc-2-q1','type','mcq',
          'prompt', $$How does a new USDC come into existence?$$,
          'correctAnswer', $$Someone gives Circle a dollar and Circle mints one USDC$$,
          'options', jsonb_build_array(
            $$Someone gives Circle a dollar and Circle mints one USDC$$,
            $$Validators mint it as a reward for producing blocks$$,
            $$It is created automatically whenever SOL is staked$$
          )),
        jsonb_build_object('id','sc-2-q2','type','mcq',
          'prompt', $$USDC is trading at 0.99 dollars. What pushes it back toward one dollar?$$,
          'correctAnswer', $$Arbitrage — buying it cheap and redeeming it with Circle for a full dollar$$,
          'options', jsonb_build_array(
            $$Arbitrage — buying it cheap and redeeming it with Circle for a full dollar$$,
            $$The Solana network automatically corrects the price$$,
            $$Nothing — it stays at 0.99 dollars permanently$$
          )),
        jsonb_build_object('id','sc-2-q3','type','short_text',
          'prompt', $$What is the main risk you take on with a fiat-backed stablecoin like USDC?$$,
          'correctAnswer', $$trusting the issuer and its banks$$)
      )
    ),

    -- ── sc-3 ────────────────────────────────────────────────────────────
    jsonb_build_object(
      'lessonId', 'sc-3',
      'slug',     'the-three-stablecoin-designs',
      'title',    $$The Three Designs — Fiat, Crypto & Algorithmic$$,
      'order',    3,
      'sourceUrl', 'https://docs.makerdao.com/',
      'sourceRepo', 'makerdao/docs',
      'sourceRef', 'docs',
      'sourceLicense', 'Apache-2.0',
      'citationNote', 'Collateralization models adapted for beginner Course 7.',
      'blocks', jsonb_build_array(
        jsonb_build_object('id','sc-3-block-1','type','paragraph','order',1,'text',$$Design One: Fiat-Backed

This is USDC and USDT. Every token is matched by roughly a dollar of real-world reserves held by a company and redeemable through that company. It is simple, it is capital-efficient — one dollar in, one token out — and it has the strongest peg record of the three.

The trade is centralization. A company mints, a company redeems, a company can freeze, and regulators can reach all of it.$$),
        jsonb_build_object('id','sc-3-block-2','type','paragraph','order',2,'text',$$Design Two: Crypto-Backed

Here the collateral lives on chain and anyone can inspect it. You lock crypto in a smart contract and mint stablecoins against it. Because that collateral swings in value, these systems are overcollateralized — locking perhaps 150 dollars of crypto to mint 100 dollars of stablecoin. If your collateral falls too close to your debt, the contract liquidates it automatically to keep the system solvent.

Nobody needs a bank, and you can verify the backing yourself. The costs are capital efficiency — a dollar of stablecoin ties up more than a dollar — and a dependence on those liquidations actually clearing while markets are moving fast.

Design Three: Algorithmic

No meaningful collateral at all. The peg is defended by a mechanism, typically minting and burning a second volatile "sister" token to absorb changes in supply and demand. It is elegant on paper and needs no reserves whatsoever. It is also the design that has failed most spectacularly, which is the subject of the next lesson.$$),
        jsonb_build_object('id','sc-3-block-3','type','callout','order',3,'text',$$Pick Your Trust: Fiat-backed asks you to trust a company. Crypto-backed asks you to trust code and market liquidations. Algorithmic asks you to trust that demand keeps arriving. The first two have durable track records at scale; the third's flagship went to zero in about a week.$$,'calloutTone','warning')
      ),
      'questions', jsonb_build_array(
        jsonb_build_object('id','sc-3-q1','type','mcq',
          'prompt', $$Why are crypto-backed stablecoins overcollateralized?$$,
          'correctAnswer', $$The collateral is volatile, so the extra cushion keeps the system solvent$$,
          'options', jsonb_build_array(
            $$The collateral is volatile, so the extra cushion keeps the system solvent$$,
            $$Regulators require a fixed extra percentage$$,
            $$It makes the stablecoin cheaper to mint$$
          )),
        jsonb_build_object('id','sc-3-q2','type','mcq',
          'prompt', $$What backs a purely algorithmic stablecoin?$$,
          'correctAnswer', $$Essentially nothing — a minting mechanism and continued demand$$,
          'options', jsonb_build_array(
            $$Essentially nothing — a minting mechanism and continued demand$$,
            $$Gold held by the issuing foundation$$,
            $$An equal amount of Bitcoin held in reserve$$
          )),
        jsonb_build_object('id','sc-3-q3','type','short_text',
          'prompt', $$What does a fiat-backed stablecoin ask you to trust?$$,
          'correctAnswer', $$a company and its reserves$$)
      )
    ),

    -- ── sc-4 ────────────────────────────────────────────────────────────
    jsonb_build_object(
      'lessonId', 'sc-4',
      'slug',     'when-pegs-break',
      'title',    $$When Pegs Break — UST and the USDC Weekend$$,
      'order',    4,
      'sourceUrl', 'https://www.circle.com/blog/an-update-on-usdc-and-silicon-valley-bank',
      'sourceRepo', 'circlefin/stablecoin-evm',
      'sourceRef', 'transparency',
      'sourceLicense', 'Apache-2.0',
      'citationNote', 'Depeg case studies adapted for beginner Course 7.',
      'blocks', jsonb_build_array(
        jsonb_build_object('id','sc-4-block-1','type','paragraph','order',1,'text',$$UST and the Death Spiral

In May 2022, TerraUSD (UST) was the third-largest stablecoin, worth roughly 18 billion dollars. It was algorithmic: you could always burn one dollar of UST for one dollar's worth of its sister token LUNA, and the reverse. Much of the demand came from a protocol paying around 20% on UST deposits.

Then UST slipped below a dollar. Holders did the rational thing and burned UST for LUNA — which minted enormous quantities of new LUNA and crushed its price. Cheaper LUNA meant the backstop was worth less, so more holders fled, so still more LUNA was minted. The mechanism designed to defend the peg was now the thing destroying it.

Within about a week UST was worth cents and LUNA was worth essentially nothing. Tens of billions of dollars evaporated. The design did not have a bad month; it had a feedback loop pointed in the wrong direction.$$),
        jsonb_build_object('id','sc-4-block-2','type','paragraph','order',2,'text',$$USDC's Very Different Weekend

In March 2023, Silicon Valley Bank failed — and Circle had roughly 3.3 billion dollars of USDC reserves sitting in it. The news broke on a Friday night, with redemptions closed for the weekend and no way to know whether that money was recoverable. USDC fell to about 0.87 dollars.

On the Monday, US regulators guaranteed the bank's deposits. The reserves were whole, redemptions reopened, and USDC traded back near one dollar within days.

The contrast is the entire lesson. UST broke because its peg mechanism consumed itself, and nothing could have stopped it. USDC broke because the market doubted whether one bank still held one slice of the reserves — a doubt that a fact could settle. Same headline, completely different failure.$$),
        jsonb_build_object('id','sc-4-block-3','type','callout','order',3,'text',$$Read the Cause, Not the Chart: Both events show a token trading below a dollar. Only one of them was survivable. When a stablecoin depegs, the question is whether the thing backing it is still intact — and note that USDC's recovery depended on an external decision going a particular way. A depeg resolving well once is not a promise that the next one will.$$,'calloutTone','warning')
      ),
      'questions', jsonb_build_array(
        jsonb_build_object('id','sc-4-q1','type','mcq',
          'prompt', $$Why did UST's collapse accelerate instead of stabilizing?$$,
          'correctAnswer', $$Burning UST minted more LUNA, crushing the price of the very thing backing it$$,
          'options', jsonb_build_array(
            $$Burning UST minted more LUNA, crushing the price of the very thing backing it$$,
            $$Its bank reserves were frozen by regulators$$,
            $$The Terra blockchain ran out of block space$$
          )),
        jsonb_build_object('id','sc-4-q2','type','mcq',
          'prompt', $$What caused USDC to fall to about 0.87 dollars in March 2023?$$,
          'correctAnswer', $$Part of its reserves sat in a bank that failed, with redemptions closed for the weekend$$,
          'options', jsonb_build_array(
            $$Part of its reserves sat in a bank that failed, with redemptions closed for the weekend$$,
            $$Circle had never held any reserves at all$$,
            $$Its algorithmic mechanism entered a death spiral$$
          )),
        jsonb_build_object('id','sc-4-q3','type','short_text',
          'prompt', $$A stablecoin has depegged. What is the key question to ask about it?$$,
          'correctAnswer', $$whether the backing is still intact$$)
      )
    ),

    -- ── sc-5 ────────────────────────────────────────────────────────────
    jsonb_build_object(
      'lessonId', 'sc-5',
      'slug',     'on-ramps-and-off-ramps',
      'title',    $$On-Ramps & Off-Ramps — Crossing the Edge$$,
      'order',    5,
      'sourceUrl', 'https://solana.com/docs/intro/wallets',
      'sourceRepo', 'solana-labs/solana',
      'sourceRef', 'docs/intro',
      'sourceLicense', 'Apache-2.0',
      'citationNote', 'On-ramp and transfer-safety practice adapted for beginner Course 7.',
      'blocks', jsonb_build_array(
        jsonb_build_object('id','sc-5-block-1','type','paragraph','order',1,'text',$$The Hard Part Is the Edge

Moving value between two wallets is trivial. Moving it between a bank account and a wallet is the part involving paperwork, waiting, and somebody's compliance department.

That crossing is an on-ramp going in and an off-ramp coming out. The usual routes are a centralized exchange, where you deposit by bank transfer or card and withdraw the stablecoin to your own wallet; or a card provider embedded directly in an app, which buys the token and delivers it to your wallet in a single flow.

Both require identity verification, because both touch the regulated banking system. This is the point at which crypto stops being anonymous, and it is unavoidable at the edges.$$),
        jsonb_build_object('id','sc-5-block-2','type','paragraph','order',2,'text',$$Costs, and the Mistake That Cannot Be Undone

Ramps are where fees hide. Card purchases carry the steepest spread, bank transfers are usually the cheapest and the slowest, and the exchange rate you are quoted often already contains a margin. Compare the amount that actually lands in your wallet, not the advertised fee.

Two mistakes matter far more than cost. The first is withdrawing on the wrong network: the same ticker exists on many chains, and tokens sent to a Solana address over the wrong network are generally not recoverable. The second is assuming a transfer can be reversed. Once a stablecoin transfer confirms on chain, no support desk can undo it. Check the network, and check the first and last characters of the address, before confirming anything.$$),
        jsonb_build_object('id','sc-5-block-3','type','callout','order',3,'text',$$The Habit Worth Building: On any new address, any new exchange, or any new network, send a small test amount first and wait for it to arrive. The fee on a test transfer is trivial. The cost of discovering a wrong network with your whole balance is the whole balance.$$,'calloutTone','warning')
      ),
      'questions', jsonb_build_array(
        jsonb_build_object('id','sc-5-q1','type','mcq',
          'prompt', $$What is an off-ramp?$$,
          'correctAnswer', $$Converting crypto back into money in a bank account$$,
          'options', jsonb_build_array(
            $$Converting crypto back into money in a bank account$$,
            $$Moving tokens between two wallets you own$$,
            $$Swapping one stablecoin for another on a DEX$$
          )),
        jsonb_build_object('id','sc-5-q2','type','mcq',
          'prompt', $$You withdraw USDC to a Solana address but select the wrong network. What usually happens?$$,
          'correctAnswer', $$The funds are generally unrecoverable$$,
          'options', jsonb_build_array(
            $$The funds are generally unrecoverable$$,
            $$The network detects the error and refunds you$$,
            $$They arrive as normal, just more slowly$$
          )),
        jsonb_build_object('id','sc-5-q3','type','short_text',
          'prompt', $$What should you do before sending a large amount to a new address?$$,
          'correctAnswer', $$send a small test transfer first$$)
      )
    ),

    -- ── sc-6 ────────────────────────────────────────────────────────────
    jsonb_build_object(
      'lessonId', 'sc-6',
      'slug',     'money-that-moves-like-email',
      'title',    $$Money That Moves Like Email$$,
      'order',    6,
      'sourceUrl', 'https://solana.com/docs/core/transactions',
      'sourceRepo', 'solana-labs/solana',
      'sourceRef', 'docs/core/transactions',
      'sourceLicense', 'Apache-2.0',
      'citationNote', 'Settlement finality concepts adapted for beginner Course 7.',
      'blocks', jsonb_build_array(
        jsonb_build_object('id','sc-6-block-1','type','paragraph','order',1,'text',$$Settlement, Not Messaging

A conventional international transfer is a chain of messages between banks, each keeping its own ledger and reconciling later. That is why it takes days, why it stops at weekends, and why the fee is what it is.

A stablecoin transfer on Solana is different in kind. There is one ledger, and when your transaction confirms — typically in under a second, for a fraction of a cent — the value has moved. There is no clearing, no settlement window, no pending state waiting to be reconciled on Monday. Final is final, at 2am, on a public holiday, across any border.$$),
        jsonb_build_object('id','sc-6-block-2','type','paragraph','order',2,'text',$$Where This Genuinely Wins, and Where It Does Not

The clear wins are exactly where the old system is worst: remittances through expensive corridors, paying contractors across borders, businesses settling with each other outside banking hours, and people in high-inflation economies holding dollars without needing a US bank account.

The honest limits are just as real. You still need the ramps from the last lesson to touch actual cash, and those keep bank hours and bank rules. The irreversibility that makes settlement final also means a mistaken payment has no recourse. And holding dollars means holding dollar risk — a stablecoin protects you from crypto volatility, not from inflation and not from the issuer.

What has actually changed is narrow and significant: the transfer step went from days and percentages to seconds and fractions of a cent. The edges around it are still ordinary finance.$$),
        jsonb_build_object('id','sc-6-block-3','type','callout','order',3,'text',$$What You Are Actually Holding: A stablecoin in your wallet is a claim, not a deposit. It is not a bank account, it carries no deposit insurance, and it pays you nothing by simply sitting there. It is a fast, borderless, self-custodied way to hold and move dollar value — and understanding exactly that is what makes it a tool rather than a gamble.$$,'calloutTone','info')
      ),
      'questions', jsonb_build_array(
        jsonb_build_object('id','sc-6-q1','type','mcq',
          'prompt', $$What is the main structural difference between a stablecoin transfer and a bank wire?$$,
          'correctAnswer', $$One shared ledger settles it immediately; banks exchange messages and reconcile later$$,
          'options', jsonb_build_array(
            $$One shared ledger settles it immediately; banks exchange messages and reconcile later$$,
            $$Bank wires are cheaper but slower to arrive$$,
            $$Stablecoin transfers are reversible for 24 hours$$
          )),
        jsonb_build_object('id','sc-6-q2','type','mcq',
          'prompt', $$Which of these is a genuine limitation of stablecoin payments?$$,
          'correctAnswer', $$A mistaken transfer is final and cannot be reversed$$,
          'options', jsonb_build_array(
            $$A mistaken transfer is final and cannot be reversed$$,
            $$They cannot be sent outside your own country$$,
            $$They take several business days to settle$$
          )),
        jsonb_build_object('id','sc-6-q3','type','short_text',
          'prompt', $$A stablecoin shields you from crypto volatility. What does it NOT shield you from?$$,
          'correctAnswer', $$inflation and issuer risk$$)
      )
    )
  );

  ---------------------------------------------------------------------------
  -- 2. Guards — refuse to seed malformed content.
  ---------------------------------------------------------------------------
  select string_agg(q->>'id', ', ')
    into v_bad
    from jsonb_array_elements(v_spec) as l,
         lateral jsonb_array_elements(l->'questions') as q
   where q->>'type' = 'mcq'
     and not ((q->'options') ? (q->>'correctAnswer'));

  if v_bad is not null then
    raise exception
      '0061: mcq correctAnswer is not among its own options for question(s): % — grading would be unwinnable.',
      v_bad;
  end if;

  select string_agg(q->>'id', ', ')
    into v_bad
    from jsonb_array_elements(v_spec) as l,
         lateral jsonb_array_elements(l->'questions') as q
   where coalesce(q->>'correctAnswer', '') = '';

  if v_bad is not null then
    raise exception '0061: question(s) % have an empty correctAnswer.', v_bad;
  end if;

  ---------------------------------------------------------------------------
  -- 3. Course
  ---------------------------------------------------------------------------
  insert into lesson.courses (
    id, slug, title, description, category, difficulty, estimated_minutes,
    min_principal_amount_usdc, max_principal_amount_usdc, demo_principal_amount_usdc,
    min_lock_duration_days, max_lock_duration_days
  ) values (
    'stablecoins-money-on-chain',
    'stablecoins-and-money-on-chain',
    'Stablecoins & Money On Chain',
    'What a dollar on a blockchain really is — who backs USDC, the three ways a peg gets defended, what actually happened when UST died and when USDC wobbled, and how money crosses between a bank account and a wallet.',
    'web3',
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
    'stablecoins-module-core',
    'stablecoins-core',
    'Stablecoins & Money On Chain Core',
    'Core module for Course 7: Stablecoins & Money On Chain.',
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
    ('stablecoins-money-on-chain', 'stablecoins-module-core', 1, true)
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
  select 'stablecoins-module-core', l->>'lessonId', (l->>'order')::int, true
    from jsonb_array_elements(v_spec) as l
  on conflict (module_id, lesson_id) do update set
    lesson_order = excluded.lesson_order,
    is_required = excluded.is_required;

  ---------------------------------------------------------------------------
  -- 6. Publish release (this course's own)
  ---------------------------------------------------------------------------
  insert into lesson.publish_releases (release_name, notes, created_by)
  values (
    'course7-stablecoins-v1',
    'Course 7: Stablecoins & Money On Chain — 6 beginner lessons covering what a peg is, USDC reserves and redemption, fiat/crypto/algorithmic designs, the UST and USDC depegs, on- and off-ramps, and settlement finality.',
    'seed-script'
  )
  returning id into v_release_id;

  ---------------------------------------------------------------------------
  -- 7. Per-lesson: version, blocks, questions, options, attribution, payloads.
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

    insert into lesson.lesson_blocks (lesson_version_id, block_order, block_type, payload)
    select v_version_id, (b->>'order')::int, b->>'type', b
      from jsonb_array_elements(v_item.l->'blocks') as b;

    insert into lesson.questions (
      id, lesson_version_id, question_order, question_type, prompt, correct_answer, metadata
    )
    select q->>'id', v_version_id, t.ord::int, q->>'type', q->>'prompt', q->>'correctAnswer', '{}'::jsonb
      from jsonb_array_elements(v_item.l->'questions') with ordinality as t(q, ord);

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

    v_payload := jsonb_build_object(
      'id',        v_item.l->>'lessonId',
      'courseId',  'stablecoins-money-on-chain',
      'moduleId',  'stablecoins-module-core',
      'title',     v_item.l->>'title',
      'order',     (v_item.l->>'order')::int,
      'version',   1,
      'releaseId', v_release_id::text,
      'blocks',    v_item.l->'blocks',
      'questions', lesson.__seed_sanitize_questions(v_item.l->'questions')
    );

    if v_payload::text like '%correctAnswer%' then
      raise exception
        '0061: lesson % payload contains correctAnswer — the answer key would ship to the client.',
        v_item.l->>'lessonId';
    end if;

    insert into lesson.published_lessons (
      release_id, lesson_id, module_id, lesson_version_id, lesson_order, payload
    ) values (
      v_release_id,
      v_item.l->>'lessonId',
      'stablecoins-module-core',
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
    'stablecoins-money-on-chain',
    'stablecoins-module-core',
    1,
    jsonb_build_object(
      'id', 'stablecoins-module-core',
      'courseId', 'stablecoins-money-on-chain',
      'slug', 'stablecoins-core',
      'title', 'Stablecoins & Money On Chain Core',
      'description', 'Core module for Course 7: Stablecoins & Money On Chain.',
      'order', 1,
      'difficulty', 'beginner',
      'totalLessons', v_lessons,
      'estimatedMinutes', 45
    )
  );

  ---------------------------------------------------------------------------
  -- 9. Self-verification
  ---------------------------------------------------------------------------
  if v_lessons <> 6 then
    raise exception '0061: expected to publish 6 lessons, published %.', v_lessons;
  end if;

  if (select count(*) from lesson.published_lessons where release_id = v_release_id) <> 6 then
    raise exception '0061: published_lessons row count does not match the 6 seeded lessons.';
  end if;

  if (select count(*) from lesson.published_lesson_payloads where release_id = v_release_id) <> 6 then
    raise exception '0061: published_lesson_payloads row count does not match the 6 seeded lessons.';
  end if;

  if exists (
    select 1
      from lesson.questions q
      join lesson.lesson_versions lv on lv.id = q.lesson_version_id
     where lv.release_id = v_release_id
       and q.question_type = 'mcq'
       and (select count(*) from lesson.question_options o where o.question_id = q.id) <> 3
  ) then
    raise exception '0061: an mcq did not land exactly 3 options.';
  end if;

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
    raise exception '0061: a stored mcq answer key does not match any of its stored options.';
  end if;

  raise notice 'Course 7 Stablecoins & Money On Chain release complete. Release ID: %, lessons: %.',
    v_release_id, v_lessons;
end;
$seed$;

drop function if exists lesson.__seed_sanitize_questions(jsonb);
