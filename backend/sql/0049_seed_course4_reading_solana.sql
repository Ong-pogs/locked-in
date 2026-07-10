create extension if not exists pgcrypto;

do $seed$
declare
  v_release_id uuid;

  v_rd1_version_id uuid;
  v_rd2_version_id uuid;
  v_rd3_version_id uuid;
  v_rd4_version_id uuid;
  v_rd5_version_id uuid;
  v_rd6_version_id uuid;

  v_rd1_payload jsonb;
  v_rd2_payload jsonb;
  v_rd3_payload jsonb;
  v_rd4_payload jsonb;
  v_rd5_payload jsonb;
  v_rd6_payload jsonb;
begin
  if exists (
    select 1
    from lesson.publish_releases
    where release_name = 'course4-reading-solana-v1'
  ) then
    raise notice 'Seed skipped: course4-reading-solana-v1 already exists.';
    return;
  end if;

  ---------------------------------------------------------------------------
  -- 1. Course
  ---------------------------------------------------------------------------
  insert into lesson.courses (
    id,
    slug,
    title,
    description,
    category,
    difficulty,
    estimated_minutes,
    min_principal_amount_usdc,
    max_principal_amount_usdc,
    demo_principal_amount_usdc,
    min_lock_duration_days,
    max_lock_duration_days
  ) values (
    'reading-solana',
    'reading-solana',
    'Reading Solana — Explorers & Transactions',
    'Learn to read the chain for yourself — what a transaction really is, what fees cost in lamports, how finality works, and how to check any account or transaction on a block explorer.',
    'solana',
    'beginner',
    45,
    5,
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
  -- 2. Module
  ---------------------------------------------------------------------------
  insert into lesson.modules (
    id,
    slug,
    title,
    description,
    difficulty,
    estimated_minutes
  ) values (
    'reading-solana-module-core',
    'reading-solana-core',
    'Reading Solana Core',
    'Core module for Course 4: Reading Solana — Explorers & Transactions.',
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
    ('reading-solana', 'reading-solana-module-core', 1, true)
  on conflict (course_id, module_id) do update set
    module_order = excluded.module_order,
    is_required = excluded.is_required;

  ---------------------------------------------------------------------------
  -- 3. Lessons
  ---------------------------------------------------------------------------
  insert into lesson.lessons (id, slug, title) values
    ('rd-1', 'what-is-a-transaction-really',   'What Is a Transaction, Really?'),
    ('rd-2', 'signatures-proof-you-said-so',   'Signatures — Proof You Said So'),
    ('rd-3', 'fees-and-lamports',              'Fees & Lamports — What a Transaction Costs'),
    ('rd-4', 'confirmations-and-finality',     'Confirmations & Finality — When Is It Done?'),
    ('rd-5', 'block-explorers',                'Block Explorers — X-Ray Vision for the Chain'),
    ('rd-6', 'devnet-vs-mainnet',              'Devnet vs Mainnet — Two Worlds, Same Tools')
  on conflict (id) do update set
    title = excluded.title,
    updated_at = now();

  insert into lesson.module_lessons (module_id, lesson_id, lesson_order, is_required) values
    ('reading-solana-module-core', 'rd-1', 1, true),
    ('reading-solana-module-core', 'rd-2', 2, true),
    ('reading-solana-module-core', 'rd-3', 3, true),
    ('reading-solana-module-core', 'rd-4', 4, true),
    ('reading-solana-module-core', 'rd-5', 5, true),
    ('reading-solana-module-core', 'rd-6', 6, true)
  on conflict (module_id, lesson_id) do update set
    lesson_order = excluded.lesson_order,
    is_required = excluded.is_required;

  ---------------------------------------------------------------------------
  -- 4. Publish release
  ---------------------------------------------------------------------------
  insert into lesson.publish_releases (release_name, notes, created_by)
  values (
    'course4-reading-solana-v1',
    'Course 4: Reading Solana — 6 beginner lessons covering transactions, signatures, fees and lamports, finality, block explorers, and devnet vs mainnet.',
    'seed-script'
  )
  returning id into v_release_id;

  ---------------------------------------------------------------------------
  -- 5. Lesson versions
  ---------------------------------------------------------------------------
  insert into lesson.lesson_versions (
    lesson_id, version, state, release_id, changelog, source_fingerprint, created_by, published_at
  ) values
    ('rd-1', 1, 'published', v_release_id, 'Initial lesson: What Is a Transaction, Really?', md5('rd-1-v1'), 'seed-script', now())
  returning id into v_rd1_version_id;

  insert into lesson.lesson_versions (
    lesson_id, version, state, release_id, changelog, source_fingerprint, created_by, published_at
  ) values
    ('rd-2', 1, 'published', v_release_id, 'Initial lesson: Signatures — Proof You Said So.', md5('rd-2-v1'), 'seed-script', now())
  returning id into v_rd2_version_id;

  insert into lesson.lesson_versions (
    lesson_id, version, state, release_id, changelog, source_fingerprint, created_by, published_at
  ) values
    ('rd-3', 1, 'published', v_release_id, 'Initial lesson: Fees & Lamports — What a Transaction Costs.', md5('rd-3-v1'), 'seed-script', now())
  returning id into v_rd3_version_id;

  insert into lesson.lesson_versions (
    lesson_id, version, state, release_id, changelog, source_fingerprint, created_by, published_at
  ) values
    ('rd-4', 1, 'published', v_release_id, 'Initial lesson: Confirmations & Finality — When Is It Done?', md5('rd-4-v1'), 'seed-script', now())
  returning id into v_rd4_version_id;

  insert into lesson.lesson_versions (
    lesson_id, version, state, release_id, changelog, source_fingerprint, created_by, published_at
  ) values
    ('rd-5', 1, 'published', v_release_id, 'Initial lesson: Block Explorers — X-Ray Vision for the Chain.', md5('rd-5-v1'), 'seed-script', now())
  returning id into v_rd5_version_id;

  insert into lesson.lesson_versions (
    lesson_id, version, state, release_id, changelog, source_fingerprint, created_by, published_at
  ) values
    ('rd-6', 1, 'published', v_release_id, 'Initial lesson: Devnet vs Mainnet — Two Worlds, Same Tools.', md5('rd-6-v1'), 'seed-script', now())
  returning id into v_rd6_version_id;

  ---------------------------------------------------------------------------
  -- 6. Lesson blocks
  ---------------------------------------------------------------------------

  -- ── rd-1: What Is a Transaction, Really? ───────────────────────────────
  insert into lesson.lesson_blocks (lesson_version_id, block_order, block_type, payload) values
  (
    v_rd1_version_id, 1, 'paragraph',
    jsonb_build_object('id','rd-1-block-1','type','paragraph','order',1,'text',$$Not a Coin Flying Through the Internet

When you "send SOL," no coin travels anywhere. What actually happens: you fill out a request and the network updates its records.

A transaction is that request — a signed message asking the network to do something. Inside it are one or more instructions. Each instruction names three things: which program should run (for example, the token program), what it should do (transfer 5 USDC), and which accounts it touches (from yours, to theirs).

Think of it like a filled-out bank form — except instead of a clerk, thousands of validators process it, and instead of a filing cabinet, the result lands on a public ledger everyone can read.$$)
  ),
  (
    v_rd1_version_id, 2, 'paragraph',
    jsonb_build_object('id','rd-1-block-2','type','paragraph','order',2,'text',$$Several Instructions, One Fate

One transaction can carry several instructions. A common example: "create a token account for this new token" and "transfer the token into it" — two instructions, one transaction.

Here's the important rule: instructions in a transaction succeed or fail together. If instruction 2 of 3 fails, the whole transaction fails and NONE of the changes happen. The ledger is never left half-updated — you can't lose your USDC without the other side receiving it.

This all-or-nothing property is called being atomic, and it's one of the most reassuring things about how blockchains work.$$)
  ),
  (
    v_rd1_version_id, 3, 'callout',
    jsonb_build_object('id','rd-1-block-3','type','callout','order',3,'text',$$Mental Model: You never "send coins" — you send a signed instruction telling a program to update balances on the ledger. Once you see transactions as requests-to-update-records, everything else in this course (signatures, fees, explorers) falls into place.$$,'calloutTone','info')
  );

  -- ── rd-2: Signatures — Proof You Said So ───────────────────────────────
  insert into lesson.lesson_blocks (lesson_version_id, block_order, block_type, payload) values
  (
    v_rd2_version_id, 1, 'paragraph',
    jsonb_build_object('id','rd-2-block-1','type','paragraph','order',1,'text',$$No Signature, No Transaction

The network won't touch your money on someone's word — every transaction must be signed with the sender's private key before validators will even look at it.

A signature is a piece of cryptographic math with a remarkable property: it proves that the holder of the private key approved this exact transaction. Change even one character of the transaction — the amount, the destination, anything — and the signature no longer matches. Forging one without the private key is practically impossible.$$)
  ),
  (
    v_rd2_version_id, 2, 'paragraph',
    jsonb_build_object('id','rd-2-block-2','type','paragraph','order',2,'text',$$The Signature IS the Receipt

On Solana, the transaction's first signature doubles as its ID. That long string you see after sending — something like 5UfDu3qz...xk2P — is the signature, and it's what you paste into a block explorer to look the transaction up.

A few more useful facts:

Fees are charged per signature — most everyday transactions have exactly one.

Some transactions need several signers — for example, when two parties must both approve.

Your wallet handles all of the math. Your job is just to read what you're signing before you tap Approve.$$)
  ),
  (
    v_rd2_version_id, 3, 'callout',
    jsonb_build_object('id','rd-2-block-3','type','callout','order',3,'text',$$The Pop-Up Is the Moment: Every time your wallet shows an "Approve transaction?" pop-up, that's the signing moment — your last line of defense. After you approve, the signature exists and the network will act on it. Read first, sign second.$$,'calloutTone','info')
  );

  -- ── rd-3: Fees & Lamports — What a Transaction Costs ───────────────────
  insert into lesson.lesson_blocks (lesson_version_id, block_order, block_type, payload) values
  (
    v_rd3_version_id, 1, 'paragraph',
    jsonb_build_object('id','rd-3-block-1','type','paragraph','order',1,'text',$$Meet the Lamport

Just like a dollar breaks into 100 cents, SOL breaks into smaller units called lamports — except the split is much finer: 1 SOL = 1,000,000,000 lamports (one billion). The unit is named after Leslie Lamport, a computer scientist whose work underpins distributed systems like Solana.

Why so small? Because Solana fees are tiny, and you need tiny units to price them.$$)
  ),
  (
    v_rd3_version_id, 2, 'code',
    jsonb_build_object('id','rd-3-block-2','type','code','order',2,'text',$$Solana Fee Cheat Sheet:
┌───────────────────────────┬────────────────────────────────┐
│  1 SOL                    │  1,000,000,000 lamports        │
│  Base fee                 │  5,000 lamports per signature  │
│  That's in SOL            │  0.000005 SOL                  │
│  Typical everyday tx      │  well under one cent           │
│  Priority fee (optional)  │  small tip to jump the queue   │
└───────────────────────────┴────────────────────────────────┘$$)
  ),
  (
    v_rd3_version_id, 3, 'paragraph',
    jsonb_build_object('id','rd-3-block-3','type','paragraph','order',3,'text',$$Why Fees Exist at All

Fees do two jobs. First, they pay the validators who spend real electricity and hardware processing your transaction. Second, they protect the network: if sending a transaction were completely free, anyone could flood Solana with billions of junk transactions and grind it to a halt. A tiny fee makes spam expensive while staying almost invisible to real users.

During busy moments you can also add a priority fee — a small tip that asks validators to process your transaction sooner. Wallets usually handle this for you automatically.$$)
  ),
  (
    v_rd3_version_id, 4, 'callout',
    jsonb_build_object('id','rd-3-block-4','type','callout','order',4,'text',$$Practical Tip: Keep a little SOL in your wallet even if you only care about USDC — every transaction needs a few thousand lamports for the fee. No SOL, no transactions, even to move your own money.$$,'calloutTone','info')
  );

  -- ── rd-4: Confirmations & Finality — When Is It Done? ──────────────────
  insert into lesson.lesson_blocks (lesson_version_id, block_order, block_type, payload) values
  (
    v_rd4_version_id, 1, 'paragraph',
    jsonb_build_object('id','rd-4-block-1','type','paragraph','order',1,'text',$$The Chain Never Stops

Solana produces a new block roughly every 400 milliseconds — more than two per second. Your transaction gets picked up by the current block producer, lands in a block, and then the network votes on that block.

But "it's in a block" isn't the whole story. How SURE can you be that it's permanent? Solana gives you three levels of certainty, called commitment levels.$$)
  ),
  (
    v_rd4_version_id, 2, 'paragraph',
    jsonb_build_object('id','rd-4-block-2','type','paragraph','order',2,'text',$$Processed, Confirmed, Finalized

Processed — your transaction is in a block. Fast, but that block could in rare cases still be abandoned.

Confirmed — a supermajority of validators has voted on the block. This takes about a second, and in practice a confirmed transaction is safe; wallets and apps typically show success at this point.

Finalized — enough blocks (31+) have been built on top that the block is mathematically locked in. This takes several seconds. A finalized transaction can NEVER be rolled back — not by validators, not by anyone.$$)
  ),
  (
    v_rd4_version_id, 3, 'callout',
    jsonb_build_object('id','rd-4-block-3','type','callout','order',3,'text',$$Compare With Your Bank Card: A card payment can be disputed and clawed back months later. On Solana, a finalized transaction is done forever — usually within seconds of you tapping send. That permanence is exactly what makes the chain trustworthy... and exactly why you double-check the address before sending.$$,'calloutTone','info')
  );

  -- ── rd-5: Block Explorers — X-Ray Vision for the Chain ─────────────────
  insert into lesson.lesson_blocks (lesson_version_id, block_order, block_type, payload) values
  (
    v_rd5_version_id, 1, 'paragraph',
    jsonb_build_object('id','rd-5-block-1','type','paragraph','order',1,'text',$$See Everything, Trust Nothing

The blockchain is public — a block explorer is the website that lets you read it. Popular Solana explorers include Solscan, Solana Explorer, and SolanaFM. They're free, need no login, and all show the same underlying data.

Two searches cover almost everything:

Paste a wallet address → see its SOL balance, every token it holds, and its full transaction history.

Paste a transaction signature → see exactly what that transaction did, when, and what it cost.$$)
  ),
  (
    v_rd5_version_id, 2, 'code',
    jsonb_build_object('id','rd-5-block-2','type','code','order',2,'text',$$Anatomy of a Transaction Page:
┌──────────────────────────────────────────────────────────┐
│  Signature      5UfDu3qz…xk2P   (the transaction's ID)   │
│  Status         Success ✓  (or Fail ✗)                   │
│  Timestamp      When it landed on chain                  │
│  Fee            0.000005 SOL                             │
│  Signer         The wallet that authorized it            │
│  Instructions   Which programs ran, and what they did    │
│  Balances       Every account's change, before → after   │
└──────────────────────────────────────────────────────────┘$$)
  ),
  (
    v_rd5_version_id, 3, 'paragraph',
    jsonb_build_object('id','rd-5-block-3','type','paragraph','order',3,'text',$$Reading Status Like a Pro

Success means the transaction ran and every instruction completed — the balance changes you see really happened.

Fail means the transaction was included but a program rejected it (wrong amount, missing account, slippage too tight...). Its changes were rolled back — only the small fee was spent. Your funds didn't vanish; the action just didn't happen.

If you can read an address page and a transaction page, nobody can lie to you about what happened on chain. "Payment sent!" — check it. "Transaction failed!" — check why. The explorer is the referee.$$)
  ),
  (
    v_rd5_version_id, 4, 'callout',
    jsonb_build_object('id','rd-5-block-4','type','callout','order',4,'text',$$Try It Now: Copy your own wallet address, paste it into an explorer like Solscan, and scroll your history. That slightly eerie feeling of seeing your activity in public? That's the transparency the whole system is built on — and now you know how to use it.$$,'calloutTone','info')
  );

  -- ── rd-6: Devnet vs Mainnet — Two Worlds, Same Tools ───────────────────
  insert into lesson.lesson_blocks (lesson_version_id, block_order, block_type, payload) values
  (
    v_rd6_version_id, 1, 'paragraph',
    jsonb_build_object('id','rd-6-block-1','type','paragraph','order',1,'text',$$Solana Runs More Than One Network

The same Solana software runs several separate networks, called clusters:

Mainnet (mainnet-beta) — the real one. Real SOL, real USDC, real value. Everything you own lives here.

Devnet — the practice world. Identical software, separate ledger, and the SOL there is free — you can "airdrop" yourself devnet SOL from a faucet with one click. It's worth exactly nothing, which makes it the perfect sandbox.

Testnet — a third cluster used mainly by validators and engineers to stress-test new releases. You'll rarely need it.$$)
  ),
  (
    v_rd6_version_id, 2, 'paragraph',
    jsonb_build_object('id','rd-6-block-2','type','paragraph','order',2,'text',$$Why Devnet Is a Gift to Learners

Everything you've learned in this course — sending transactions, reading signatures, watching confirmations, browsing explorers — can be practiced on devnet with zero risk. Airdrop yourself some fake SOL, send it between two of your own addresses, then find the transaction on an explorer. Same tools, same mechanics, no stakes.

Developers build and test entire apps on devnet before touching real money. You can learn the same way.$$)
  ),
  (
    v_rd6_version_id, 3, 'callout',
    jsonb_build_object('id','rd-6-block-3','type','callout','order',3,'text',$$The Classic Gotcha: Explorers have a cluster switch (usually a dropdown in the corner). If a real payment "isn't showing up," first check the explorer is set to mainnet — you may be staring at devnet. And remember: devnet tokens never become real. Anyone "proving" a payment with a devnet transaction link is showing you play money.$$,'calloutTone','info')
  );

  ---------------------------------------------------------------------------
  -- 7. Questions
  ---------------------------------------------------------------------------

  -- rd-1 questions
  insert into lesson.questions (id, lesson_version_id, question_order, question_type, prompt, correct_answer, metadata) values
    ('rd-1-q1', v_rd1_version_id, 1, 'mcq', $$What is a Solana transaction?$$, $$A signed set of instructions telling programs what to do$$, '{}'::jsonb),
    ('rd-1-q2', v_rd1_version_id, 2, 'mcq', $$A transaction has 3 instructions and one of them fails. What happens?$$, $$The whole transaction fails — none of the changes happen$$, '{}'::jsonb),
    ('rd-1-q3', v_rd1_version_id, 3, 'short_text', $$Transactions are all-or-nothing: they fully succeed or fully fail. Fill in the term: transactions are ___. (one word)$$, $$atomic$$, '{}'::jsonb),

  -- rd-2 questions
    ('rd-2-q1', v_rd2_version_id, 1, 'mcq', $$What does a transaction signature prove?$$, $$The holder of the private key approved this exact transaction$$, '{}'::jsonb),
    ('rd-2-q2', v_rd2_version_id, 2, 'mcq', $$What is used as a transaction's ID on Solana?$$, $$Its first signature$$, '{}'::jsonb),
    ('rd-2-q3', v_rd2_version_id, 3, 'short_text', $$Which key creates the signature on a transaction? (two words)$$, $$private key$$, '{}'::jsonb),

  -- rd-3 questions
    ('rd-3-q1', v_rd3_version_id, 1, 'mcq', $$What is a lamport?$$, $$The smallest unit of SOL — one billionth of 1 SOL$$, '{}'::jsonb),
    ('rd-3-q2', v_rd3_version_id, 2, 'mcq', $$Why do transaction fees exist?$$, $$They pay validators and make spamming the network expensive$$, '{}'::jsonb),
    ('rd-3-q3', v_rd3_version_id, 3, 'short_text', $$What is the base fee per signature, in lamports? (answer with just the number)$$, $$5000$$, '{}'::jsonb),

  -- rd-4 questions
    ('rd-4-q1', v_rd4_version_id, 1, 'mcq', $$What does 'finalized' mean for a transaction?$$, $$It is permanent and can never be rolled back$$, '{}'::jsonb),
    ('rd-4-q2', v_rd4_version_id, 2, 'mcq', $$Roughly how often does Solana produce a new block?$$, $$About every 400 milliseconds$$, '{}'::jsonb),
    ('rd-4-q3', v_rd4_version_id, 3, 'short_text', $$Name the commitment level that means a transaction is permanent. (one word)$$, $$finalized$$, '{}'::jsonb),

  -- rd-5 questions
    ('rd-5-q1', v_rd5_version_id, 1, 'mcq', $$What is a block explorer?$$, $$A website for looking up any account or transaction on the chain$$, '{}'::jsonb),
    ('rd-5-q2', v_rd5_version_id, 2, 'mcq', $$What do you paste into an explorer to find one specific transaction?$$, $$The transaction's signature$$, '{}'::jsonb),
    ('rd-5-q3', v_rd5_version_id, 3, 'mcq', $$A transaction shows status 'Fail' on an explorer. What does that mean?$$, $$A program rejected it — its changes were rolled back and only the fee was spent$$, '{}'::jsonb),

  -- rd-6 questions
    ('rd-6-q1', v_rd6_version_id, 1, 'mcq', $$What is devnet for?$$, $$Practicing with free test SOL that has no real-world value$$, '{}'::jsonb),
    ('rd-6-q2', v_rd6_version_id, 2, 'mcq', $$A stranger "proves" they paid you by sending a devnet transaction link. What's wrong?$$, $$Devnet tokens aren't real money — nothing arrived on mainnet$$, '{}'::jsonb),
    ('rd-6-q3', v_rd6_version_id, 3, 'short_text', $$Which cluster is the real one, where tokens have actual value? (one word)$$, $$mainnet$$, '{}'::jsonb);

  ---------------------------------------------------------------------------
  -- 8. Question options (MCQ only)
  ---------------------------------------------------------------------------
  insert into lesson.question_options (question_id, option_order, option_text) values
    -- rd-1-q1
    ('rd-1-q1', 1, 'A coin file that travels across the internet'),
    ('rd-1-q1', 2, 'A signed set of instructions telling programs what to do'),
    ('rd-1-q1', 3, 'A message you send to Solana customer support'),
    -- rd-1-q2
    ('rd-1-q2', 1, 'The other two instructions still go through'),
    ('rd-1-q2', 2, 'The whole transaction fails — none of the changes happen'),
    ('rd-1-q2', 3, 'The network automatically repairs the broken instruction'),

    -- rd-2-q1
    ('rd-2-q1', 1, 'The transaction is guaranteed to succeed'),
    ('rd-2-q1', 2, 'The holder of the private key approved this exact transaction'),
    ('rd-2-q1', 3, 'The sender passed an identity check'),
    -- rd-2-q2
    ('rd-2-q2', 1, 'The sender''s wallet address'),
    ('rd-2-q2', 2, 'Its first signature'),
    ('rd-2-q2', 3, 'A random number chosen by the validator'),

    -- rd-3-q1
    ('rd-3-q1', 1, 'A separate token you must buy to pay fees'),
    ('rd-3-q1', 2, 'The smallest unit of SOL — one billionth of 1 SOL'),
    ('rd-3-q1', 3, 'A nickname for a Solana validator'),
    -- rd-3-q2
    ('rd-3-q2', 1, 'They fund the Solana marketing budget'),
    ('rd-3-q2', 2, 'They pay validators and make spamming the network expensive'),
    ('rd-3-q2', 3, 'They are a tax collected by exchanges'),

    -- rd-4-q1
    ('rd-4-q1', 1, 'One validator has seen the transaction'),
    ('rd-4-q1', 2, 'It is permanent and can never be rolled back'),
    ('rd-4-q1', 3, 'It is waiting for a bank to approve it'),
    -- rd-4-q2
    ('rd-4-q2', 1, 'Every 10 minutes'),
    ('rd-4-q2', 2, 'About every 400 milliseconds'),
    ('rd-4-q2', 3, 'Once per hour'),

    -- rd-5-q1
    ('rd-5-q1', 1, 'A wallet app for advanced traders'),
    ('rd-5-q1', 2, 'A website for looking up any account or transaction on the chain'),
    ('rd-5-q1', 3, 'A tool that can reverse mistaken transactions'),
    -- rd-5-q2
    ('rd-5-q2', 1, 'The transaction''s signature'),
    ('rd-5-q2', 2, 'Your seed phrase'),
    ('rd-5-q2', 3, 'Your private key'),
    -- rd-5-q3
    ('rd-5-q3', 1, 'Your wallet is now broken and needs reinstalling'),
    ('rd-5-q3', 2, 'The explorer is showing outdated information'),
    ('rd-5-q3', 3, 'A program rejected it — its changes were rolled back and only the fee was spent'),

    -- rd-6-q1
    ('rd-6-q1', 1, 'Practicing with free test SOL that has no real-world value'),
    ('rd-6-q1', 2, 'Earning extra yield on your USDC'),
    ('rd-6-q1', 3, 'A faster version of mainnet reserved for VIPs'),
    -- rd-6-q2
    ('rd-6-q2', 1, 'Nothing — devnet and mainnet share the same balances'),
    ('rd-6-q2', 2, 'Devnet tokens aren''t real money — nothing arrived on mainnet'),
    ('rd-6-q2', 3, 'The link just needs a few hours to sync over')
  ;

  ---------------------------------------------------------------------------
  -- 9. Source attributions
  ---------------------------------------------------------------------------
  insert into lesson.source_attributions (lesson_version_id, source_url, source_repo, source_ref, source_license, citation_note) values
    (v_rd1_version_id, 'https://solana.com/docs/core/transactions', 'solana-labs/solana', 'docs/core/transactions', 'Apache-2.0', 'Transaction and instruction concepts adapted for beginner Course 4.'),
    (v_rd2_version_id, 'https://solana.com/docs/core/transactions', 'solana-labs/solana', 'docs/core/transactions', 'Apache-2.0', 'Signature concepts adapted for beginner Course 4.'),
    (v_rd3_version_id, 'https://solana.com/docs/core/fees', 'solana-labs/solana', 'docs/core/fees', 'Apache-2.0', 'Fee and lamport concepts adapted for beginner Course 4.'),
    (v_rd4_version_id, 'https://solana.com/docs/advanced/confirmation', 'solana-labs/solana', 'docs/advanced/confirmation', 'Apache-2.0', 'Commitment and finality concepts adapted for beginner Course 4.'),
    (v_rd5_version_id, 'https://solscan.io', 'solscan', 'docs', 'unknown', 'Block explorer walkthrough adapted for beginner Course 4.'),
    (v_rd6_version_id, 'https://solana.com/docs/core/clusters', 'solana-labs/solana', 'docs/core/clusters', 'Apache-2.0', 'Cluster concepts adapted for beginner Course 4.');

  ---------------------------------------------------------------------------
  -- 10. Published payloads (sanitized — no correctAnswer)
  ---------------------------------------------------------------------------

  -- rd-1 payload
  v_rd1_payload := jsonb_build_object(
    'id','rd-1','courseId','reading-solana','moduleId','reading-solana-module-core','title','What Is a Transaction, Really?','order',1,'version',1,'releaseId',v_release_id::text,
    'blocks', jsonb_build_array(
      jsonb_build_object('id','rd-1-block-1','type','paragraph','order',1,'text',$$Not a Coin Flying Through the Internet

When you "send SOL," no coin travels anywhere. What actually happens: you fill out a request and the network updates its records.

A transaction is that request — a signed message asking the network to do something. Inside it are one or more instructions. Each instruction names three things: which program should run (for example, the token program), what it should do (transfer 5 USDC), and which accounts it touches (from yours, to theirs).

Think of it like a filled-out bank form — except instead of a clerk, thousands of validators process it, and instead of a filing cabinet, the result lands on a public ledger everyone can read.$$),
      jsonb_build_object('id','rd-1-block-2','type','paragraph','order',2,'text',$$Several Instructions, One Fate

One transaction can carry several instructions. A common example: "create a token account for this new token" and "transfer the token into it" — two instructions, one transaction.

Here's the important rule: instructions in a transaction succeed or fail together. If instruction 2 of 3 fails, the whole transaction fails and NONE of the changes happen. The ledger is never left half-updated — you can't lose your USDC without the other side receiving it.

This all-or-nothing property is called being atomic, and it's one of the most reassuring things about how blockchains work.$$),
      jsonb_build_object('id','rd-1-block-3','type','callout','order',3,'text',$$Mental Model: You never "send coins" — you send a signed instruction telling a program to update balances on the ledger. Once you see transactions as requests-to-update-records, everything else in this course (signatures, fees, explorers) falls into place.$$,'calloutTone','info')
    ),
    'questions', jsonb_build_array(
      jsonb_build_object('id','rd-1-q1','type','mcq','prompt',$$What is a Solana transaction?$$,'options',jsonb_build_array(
        jsonb_build_object('id','rd-1-q1-opt-1','text','A coin file that travels across the internet'),
        jsonb_build_object('id','rd-1-q1-opt-2','text','A signed set of instructions telling programs what to do'),
        jsonb_build_object('id','rd-1-q1-opt-3','text','A message you send to Solana customer support')
      )),
      jsonb_build_object('id','rd-1-q2','type','mcq','prompt',$$A transaction has 3 instructions and one of them fails. What happens?$$,'options',jsonb_build_array(
        jsonb_build_object('id','rd-1-q2-opt-1','text','The other two instructions still go through'),
        jsonb_build_object('id','rd-1-q2-opt-2','text','The whole transaction fails — none of the changes happen'),
        jsonb_build_object('id','rd-1-q2-opt-3','text','The network automatically repairs the broken instruction')
      )),
      jsonb_build_object('id','rd-1-q3','type','short_text','prompt',$$Transactions are all-or-nothing: they fully succeed or fully fail. Fill in the term: transactions are ___. (one word)$$)
    )
  );

  -- rd-2 payload
  v_rd2_payload := jsonb_build_object(
    'id','rd-2','courseId','reading-solana','moduleId','reading-solana-module-core','title','Signatures — Proof You Said So','order',2,'version',1,'releaseId',v_release_id::text,
    'blocks', jsonb_build_array(
      jsonb_build_object('id','rd-2-block-1','type','paragraph','order',1,'text',$$No Signature, No Transaction

The network won't touch your money on someone's word — every transaction must be signed with the sender's private key before validators will even look at it.

A signature is a piece of cryptographic math with a remarkable property: it proves that the holder of the private key approved this exact transaction. Change even one character of the transaction — the amount, the destination, anything — and the signature no longer matches. Forging one without the private key is practically impossible.$$),
      jsonb_build_object('id','rd-2-block-2','type','paragraph','order',2,'text',$$The Signature IS the Receipt

On Solana, the transaction's first signature doubles as its ID. That long string you see after sending — something like 5UfDu3qz...xk2P — is the signature, and it's what you paste into a block explorer to look the transaction up.

A few more useful facts:

Fees are charged per signature — most everyday transactions have exactly one.

Some transactions need several signers — for example, when two parties must both approve.

Your wallet handles all of the math. Your job is just to read what you're signing before you tap Approve.$$),
      jsonb_build_object('id','rd-2-block-3','type','callout','order',3,'text',$$The Pop-Up Is the Moment: Every time your wallet shows an "Approve transaction?" pop-up, that's the signing moment — your last line of defense. After you approve, the signature exists and the network will act on it. Read first, sign second.$$,'calloutTone','info')
    ),
    'questions', jsonb_build_array(
      jsonb_build_object('id','rd-2-q1','type','mcq','prompt',$$What does a transaction signature prove?$$,'options',jsonb_build_array(
        jsonb_build_object('id','rd-2-q1-opt-1','text','The transaction is guaranteed to succeed'),
        jsonb_build_object('id','rd-2-q1-opt-2','text','The holder of the private key approved this exact transaction'),
        jsonb_build_object('id','rd-2-q1-opt-3','text','The sender passed an identity check')
      )),
      jsonb_build_object('id','rd-2-q2','type','mcq','prompt',$$What is used as a transaction's ID on Solana?$$,'options',jsonb_build_array(
        jsonb_build_object('id','rd-2-q2-opt-1','text','The sender''s wallet address'),
        jsonb_build_object('id','rd-2-q2-opt-2','text','Its first signature'),
        jsonb_build_object('id','rd-2-q2-opt-3','text','A random number chosen by the validator')
      )),
      jsonb_build_object('id','rd-2-q3','type','short_text','prompt',$$Which key creates the signature on a transaction? (two words)$$)
    )
  );

  -- rd-3 payload
  v_rd3_payload := jsonb_build_object(
    'id','rd-3','courseId','reading-solana','moduleId','reading-solana-module-core','title','Fees & Lamports — What a Transaction Costs','order',3,'version',1,'releaseId',v_release_id::text,
    'blocks', jsonb_build_array(
      jsonb_build_object('id','rd-3-block-1','type','paragraph','order',1,'text',$$Meet the Lamport

Just like a dollar breaks into 100 cents, SOL breaks into smaller units called lamports — except the split is much finer: 1 SOL = 1,000,000,000 lamports (one billion). The unit is named after Leslie Lamport, a computer scientist whose work underpins distributed systems like Solana.

Why so small? Because Solana fees are tiny, and you need tiny units to price them.$$),
      jsonb_build_object('id','rd-3-block-2','type','code','order',2,'text',$$Solana Fee Cheat Sheet:
┌───────────────────────────┬────────────────────────────────┐
│  1 SOL                    │  1,000,000,000 lamports        │
│  Base fee                 │  5,000 lamports per signature  │
│  That's in SOL            │  0.000005 SOL                  │
│  Typical everyday tx      │  well under one cent           │
│  Priority fee (optional)  │  small tip to jump the queue   │
└───────────────────────────┴────────────────────────────────┘$$),
      jsonb_build_object('id','rd-3-block-3','type','paragraph','order',3,'text',$$Why Fees Exist at All

Fees do two jobs. First, they pay the validators who spend real electricity and hardware processing your transaction. Second, they protect the network: if sending a transaction were completely free, anyone could flood Solana with billions of junk transactions and grind it to a halt. A tiny fee makes spam expensive while staying almost invisible to real users.

During busy moments you can also add a priority fee — a small tip that asks validators to process your transaction sooner. Wallets usually handle this for you automatically.$$),
      jsonb_build_object('id','rd-3-block-4','type','callout','order',4,'text',$$Practical Tip: Keep a little SOL in your wallet even if you only care about USDC — every transaction needs a few thousand lamports for the fee. No SOL, no transactions, even to move your own money.$$,'calloutTone','info')
    ),
    'questions', jsonb_build_array(
      jsonb_build_object('id','rd-3-q1','type','mcq','prompt',$$What is a lamport?$$,'options',jsonb_build_array(
        jsonb_build_object('id','rd-3-q1-opt-1','text','A separate token you must buy to pay fees'),
        jsonb_build_object('id','rd-3-q1-opt-2','text','The smallest unit of SOL — one billionth of 1 SOL'),
        jsonb_build_object('id','rd-3-q1-opt-3','text','A nickname for a Solana validator')
      )),
      jsonb_build_object('id','rd-3-q2','type','mcq','prompt',$$Why do transaction fees exist?$$,'options',jsonb_build_array(
        jsonb_build_object('id','rd-3-q2-opt-1','text','They fund the Solana marketing budget'),
        jsonb_build_object('id','rd-3-q2-opt-2','text','They pay validators and make spamming the network expensive'),
        jsonb_build_object('id','rd-3-q2-opt-3','text','They are a tax collected by exchanges')
      )),
      jsonb_build_object('id','rd-3-q3','type','short_text','prompt',$$What is the base fee per signature, in lamports? (answer with just the number)$$)
    )
  );

  -- rd-4 payload
  v_rd4_payload := jsonb_build_object(
    'id','rd-4','courseId','reading-solana','moduleId','reading-solana-module-core','title','Confirmations & Finality — When Is It Done?','order',4,'version',1,'releaseId',v_release_id::text,
    'blocks', jsonb_build_array(
      jsonb_build_object('id','rd-4-block-1','type','paragraph','order',1,'text',$$The Chain Never Stops

Solana produces a new block roughly every 400 milliseconds — more than two per second. Your transaction gets picked up by the current block producer, lands in a block, and then the network votes on that block.

But "it's in a block" isn't the whole story. How SURE can you be that it's permanent? Solana gives you three levels of certainty, called commitment levels.$$),
      jsonb_build_object('id','rd-4-block-2','type','paragraph','order',2,'text',$$Processed, Confirmed, Finalized

Processed — your transaction is in a block. Fast, but that block could in rare cases still be abandoned.

Confirmed — a supermajority of validators has voted on the block. This takes about a second, and in practice a confirmed transaction is safe; wallets and apps typically show success at this point.

Finalized — enough blocks (31+) have been built on top that the block is mathematically locked in. This takes several seconds. A finalized transaction can NEVER be rolled back — not by validators, not by anyone.$$),
      jsonb_build_object('id','rd-4-block-3','type','callout','order',3,'text',$$Compare With Your Bank Card: A card payment can be disputed and clawed back months later. On Solana, a finalized transaction is done forever — usually within seconds of you tapping send. That permanence is exactly what makes the chain trustworthy... and exactly why you double-check the address before sending.$$,'calloutTone','info')
    ),
    'questions', jsonb_build_array(
      jsonb_build_object('id','rd-4-q1','type','mcq','prompt',$$What does 'finalized' mean for a transaction?$$,'options',jsonb_build_array(
        jsonb_build_object('id','rd-4-q1-opt-1','text','One validator has seen the transaction'),
        jsonb_build_object('id','rd-4-q1-opt-2','text','It is permanent and can never be rolled back'),
        jsonb_build_object('id','rd-4-q1-opt-3','text','It is waiting for a bank to approve it')
      )),
      jsonb_build_object('id','rd-4-q2','type','mcq','prompt',$$Roughly how often does Solana produce a new block?$$,'options',jsonb_build_array(
        jsonb_build_object('id','rd-4-q2-opt-1','text','Every 10 minutes'),
        jsonb_build_object('id','rd-4-q2-opt-2','text','About every 400 milliseconds'),
        jsonb_build_object('id','rd-4-q2-opt-3','text','Once per hour')
      )),
      jsonb_build_object('id','rd-4-q3','type','short_text','prompt',$$Name the commitment level that means a transaction is permanent. (one word)$$)
    )
  );

  -- rd-5 payload
  v_rd5_payload := jsonb_build_object(
    'id','rd-5','courseId','reading-solana','moduleId','reading-solana-module-core','title','Block Explorers — X-Ray Vision for the Chain','order',5,'version',1,'releaseId',v_release_id::text,
    'blocks', jsonb_build_array(
      jsonb_build_object('id','rd-5-block-1','type','paragraph','order',1,'text',$$See Everything, Trust Nothing

The blockchain is public — a block explorer is the website that lets you read it. Popular Solana explorers include Solscan, Solana Explorer, and SolanaFM. They're free, need no login, and all show the same underlying data.

Two searches cover almost everything:

Paste a wallet address → see its SOL balance, every token it holds, and its full transaction history.

Paste a transaction signature → see exactly what that transaction did, when, and what it cost.$$),
      jsonb_build_object('id','rd-5-block-2','type','code','order',2,'text',$$Anatomy of a Transaction Page:
┌──────────────────────────────────────────────────────────┐
│  Signature      5UfDu3qz…xk2P   (the transaction's ID)   │
│  Status         Success ✓  (or Fail ✗)                   │
│  Timestamp      When it landed on chain                  │
│  Fee            0.000005 SOL                             │
│  Signer         The wallet that authorized it            │
│  Instructions   Which programs ran, and what they did    │
│  Balances       Every account's change, before → after   │
└──────────────────────────────────────────────────────────┘$$),
      jsonb_build_object('id','rd-5-block-3','type','paragraph','order',3,'text',$$Reading Status Like a Pro

Success means the transaction ran and every instruction completed — the balance changes you see really happened.

Fail means the transaction was included but a program rejected it (wrong amount, missing account, slippage too tight...). Its changes were rolled back — only the small fee was spent. Your funds didn't vanish; the action just didn't happen.

If you can read an address page and a transaction page, nobody can lie to you about what happened on chain. "Payment sent!" — check it. "Transaction failed!" — check why. The explorer is the referee.$$),
      jsonb_build_object('id','rd-5-block-4','type','callout','order',4,'text',$$Try It Now: Copy your own wallet address, paste it into an explorer like Solscan, and scroll your history. That slightly eerie feeling of seeing your activity in public? That's the transparency the whole system is built on — and now you know how to use it.$$,'calloutTone','info')
    ),
    'questions', jsonb_build_array(
      jsonb_build_object('id','rd-5-q1','type','mcq','prompt',$$What is a block explorer?$$,'options',jsonb_build_array(
        jsonb_build_object('id','rd-5-q1-opt-1','text','A wallet app for advanced traders'),
        jsonb_build_object('id','rd-5-q1-opt-2','text','A website for looking up any account or transaction on the chain'),
        jsonb_build_object('id','rd-5-q1-opt-3','text','A tool that can reverse mistaken transactions')
      )),
      jsonb_build_object('id','rd-5-q2','type','mcq','prompt',$$What do you paste into an explorer to find one specific transaction?$$,'options',jsonb_build_array(
        jsonb_build_object('id','rd-5-q2-opt-1','text','The transaction''s signature'),
        jsonb_build_object('id','rd-5-q2-opt-2','text','Your seed phrase'),
        jsonb_build_object('id','rd-5-q2-opt-3','text','Your private key')
      )),
      jsonb_build_object('id','rd-5-q3','type','mcq','prompt',$$A transaction shows status 'Fail' on an explorer. What does that mean?$$,'options',jsonb_build_array(
        jsonb_build_object('id','rd-5-q3-opt-1','text','Your wallet is now broken and needs reinstalling'),
        jsonb_build_object('id','rd-5-q3-opt-2','text','The explorer is showing outdated information'),
        jsonb_build_object('id','rd-5-q3-opt-3','text','A program rejected it — its changes were rolled back and only the fee was spent')
      ))
    )
  );

  -- rd-6 payload
  v_rd6_payload := jsonb_build_object(
    'id','rd-6','courseId','reading-solana','moduleId','reading-solana-module-core','title','Devnet vs Mainnet — Two Worlds, Same Tools','order',6,'version',1,'releaseId',v_release_id::text,
    'blocks', jsonb_build_array(
      jsonb_build_object('id','rd-6-block-1','type','paragraph','order',1,'text',$$Solana Runs More Than One Network

The same Solana software runs several separate networks, called clusters:

Mainnet (mainnet-beta) — the real one. Real SOL, real USDC, real value. Everything you own lives here.

Devnet — the practice world. Identical software, separate ledger, and the SOL there is free — you can "airdrop" yourself devnet SOL from a faucet with one click. It's worth exactly nothing, which makes it the perfect sandbox.

Testnet — a third cluster used mainly by validators and engineers to stress-test new releases. You'll rarely need it.$$),
      jsonb_build_object('id','rd-6-block-2','type','paragraph','order',2,'text',$$Why Devnet Is a Gift to Learners

Everything you've learned in this course — sending transactions, reading signatures, watching confirmations, browsing explorers — can be practiced on devnet with zero risk. Airdrop yourself some fake SOL, send it between two of your own addresses, then find the transaction on an explorer. Same tools, same mechanics, no stakes.

Developers build and test entire apps on devnet before touching real money. You can learn the same way.$$),
      jsonb_build_object('id','rd-6-block-3','type','callout','order',3,'text',$$The Classic Gotcha: Explorers have a cluster switch (usually a dropdown in the corner). If a real payment "isn't showing up," first check the explorer is set to mainnet — you may be staring at devnet. And remember: devnet tokens never become real. Anyone "proving" a payment with a devnet transaction link is showing you play money.$$,'calloutTone','info')
    ),
    'questions', jsonb_build_array(
      jsonb_build_object('id','rd-6-q1','type','mcq','prompt',$$What is devnet for?$$,'options',jsonb_build_array(
        jsonb_build_object('id','rd-6-q1-opt-1','text','Practicing with free test SOL that has no real-world value'),
        jsonb_build_object('id','rd-6-q1-opt-2','text','Earning extra yield on your USDC'),
        jsonb_build_object('id','rd-6-q1-opt-3','text','A faster version of mainnet reserved for VIPs')
      )),
      jsonb_build_object('id','rd-6-q2','type','mcq','prompt',$$A stranger "proves" they paid you by sending a devnet transaction link. What's wrong?$$,'options',jsonb_build_array(
        jsonb_build_object('id','rd-6-q2-opt-1','text','Nothing — devnet and mainnet share the same balances'),
        jsonb_build_object('id','rd-6-q2-opt-2','text','Devnet tokens aren''t real money — nothing arrived on mainnet'),
        jsonb_build_object('id','rd-6-q2-opt-3','text','The link just needs a few hours to sync over')
      )),
      jsonb_build_object('id','rd-6-q3','type','short_text','prompt',$$Which cluster is the real one, where tokens have actual value? (one word)$$)
    )
  );

  ---------------------------------------------------------------------------
  -- 11. Published module
  ---------------------------------------------------------------------------
  insert into lesson.published_modules (release_id, course_id, module_id, module_order, payload) values
  (
    v_release_id,
    'reading-solana',
    'reading-solana-module-core',
    1,
    jsonb_build_object(
      'id', 'reading-solana-module-core',
      'courseId', 'reading-solana',
      'slug', 'reading-solana-core',
      'title', 'Reading Solana Core',
      'description', 'Core module for Course 4: Reading Solana — Explorers & Transactions.',
      'order', 1,
      'difficulty', 'beginner',
      'totalLessons', 6,
      'estimatedMinutes', 45
    )
  );

  ---------------------------------------------------------------------------
  -- 12. Published lessons
  ---------------------------------------------------------------------------
  insert into lesson.published_lessons (release_id, lesson_id, module_id, lesson_version_id, lesson_order, payload) values
    (v_release_id, 'rd-1', 'reading-solana-module-core', v_rd1_version_id, 1, v_rd1_payload),
    (v_release_id, 'rd-2', 'reading-solana-module-core', v_rd2_version_id, 2, v_rd2_payload),
    (v_release_id, 'rd-3', 'reading-solana-module-core', v_rd3_version_id, 3, v_rd3_payload),
    (v_release_id, 'rd-4', 'reading-solana-module-core', v_rd4_version_id, 4, v_rd4_payload),
    (v_release_id, 'rd-5', 'reading-solana-module-core', v_rd5_version_id, 5, v_rd5_payload),
    (v_release_id, 'rd-6', 'reading-solana-module-core', v_rd6_version_id, 6, v_rd6_payload);

  ---------------------------------------------------------------------------
  -- 13. Published lesson payloads (with content_hash)
  ---------------------------------------------------------------------------
  insert into lesson.published_lesson_payloads (release_id, lesson_id, payload, content_hash) values
    (v_release_id, 'rd-1', v_rd1_payload, md5(v_rd1_payload::text)),
    (v_release_id, 'rd-2', v_rd2_payload, md5(v_rd2_payload::text)),
    (v_release_id, 'rd-3', v_rd3_payload, md5(v_rd3_payload::text)),
    (v_release_id, 'rd-4', v_rd4_payload, md5(v_rd4_payload::text)),
    (v_release_id, 'rd-5', v_rd5_payload, md5(v_rd5_payload::text)),
    (v_release_id, 'rd-6', v_rd6_payload, md5(v_rd6_payload::text));

  raise notice 'Course 4 Reading Solana release complete. Release ID: %', v_release_id;
end;
$seed$;
