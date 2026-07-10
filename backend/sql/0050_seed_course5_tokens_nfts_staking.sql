create extension if not exists pgcrypto;

do $seed$
declare
  v_release_id uuid;

  v_tn1_version_id uuid;
  v_tn2_version_id uuid;
  v_tn3_version_id uuid;
  v_tn4_version_id uuid;
  v_tn5_version_id uuid;
  v_tn6_version_id uuid;

  v_tn1_payload jsonb;
  v_tn2_payload jsonb;
  v_tn3_payload jsonb;
  v_tn4_payload jsonb;
  v_tn5_payload jsonb;
  v_tn6_payload jsonb;
begin
  if exists (
    select 1
    from lesson.publish_releases
    where release_name = 'course5-tokens-nfts-staking-v1'
  ) then
    raise notice 'Seed skipped: course5-tokens-nfts-staking-v1 already exists.';
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
    'tokens-nfts-staking',
    'tokens-nfts-and-staking',
    'Tokens, NFTs & Staking',
    'From SOL to SPL — how tokens and token accounts work, what an NFT actually is on Solana, and how staking and liquid staking put your SOL to work.',
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
    'tokens-nfts-staking-module-core',
    'tokens-nfts-staking-core',
    'Tokens, NFTs & Staking Core',
    'Core module for Course 5: Tokens, NFTs & Staking.',
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
    ('tokens-nfts-staking', 'tokens-nfts-staking-module-core', 1, true)
  on conflict (course_id, module_id) do update set
    module_order = excluded.module_order,
    is_required = excluded.is_required;

  ---------------------------------------------------------------------------
  -- 3. Lessons
  ---------------------------------------------------------------------------
  insert into lesson.lessons (id, slug, title) values
    ('tn-1', 'sol-vs-spl-tokens',              'SOL vs SPL — Two Kinds of Tokens'),
    ('tn-2', 'token-accounts-and-atas',        'Token Accounts & ATAs — Where Tokens Actually Sit'),
    ('tn-3', 'nfts-on-solana',                 'NFTs on Solana — One of a Kind'),
    ('tn-4', 'staking-sol',                    'Staking SOL — Put Your Coins to Work'),
    ('tn-5', 'epochs-commission-validators',   'Epochs, Commission & Picking a Validator'),
    ('tn-6', 'liquid-staking-basics',          'Liquid Staking — Stake and Stay Flexible')
  on conflict (id) do update set
    title = excluded.title,
    updated_at = now();

  insert into lesson.module_lessons (module_id, lesson_id, lesson_order, is_required) values
    ('tokens-nfts-staking-module-core', 'tn-1', 1, true),
    ('tokens-nfts-staking-module-core', 'tn-2', 2, true),
    ('tokens-nfts-staking-module-core', 'tn-3', 3, true),
    ('tokens-nfts-staking-module-core', 'tn-4', 4, true),
    ('tokens-nfts-staking-module-core', 'tn-5', 5, true),
    ('tokens-nfts-staking-module-core', 'tn-6', 6, true)
  on conflict (module_id, lesson_id) do update set
    lesson_order = excluded.lesson_order,
    is_required = excluded.is_required;

  ---------------------------------------------------------------------------
  -- 4. Publish release
  ---------------------------------------------------------------------------
  insert into lesson.publish_releases (release_name, notes, created_by)
  values (
    'course5-tokens-nfts-staking-v1',
    'Course 5: Tokens, NFTs & Staking — 6 beginner lessons covering SPL tokens, token accounts and ATAs, NFTs, staking, validators, and liquid staking.',
    'seed-script'
  )
  returning id into v_release_id;

  ---------------------------------------------------------------------------
  -- 5. Lesson versions
  ---------------------------------------------------------------------------
  insert into lesson.lesson_versions (
    lesson_id, version, state, release_id, changelog, source_fingerprint, created_by, published_at
  ) values
    ('tn-1', 1, 'published', v_release_id, 'Initial lesson: SOL vs SPL — Two Kinds of Tokens.', md5('tn-1-v1'), 'seed-script', now())
  returning id into v_tn1_version_id;

  insert into lesson.lesson_versions (
    lesson_id, version, state, release_id, changelog, source_fingerprint, created_by, published_at
  ) values
    ('tn-2', 1, 'published', v_release_id, 'Initial lesson: Token Accounts & ATAs — Where Tokens Actually Sit.', md5('tn-2-v1'), 'seed-script', now())
  returning id into v_tn2_version_id;

  insert into lesson.lesson_versions (
    lesson_id, version, state, release_id, changelog, source_fingerprint, created_by, published_at
  ) values
    ('tn-3', 1, 'published', v_release_id, 'Initial lesson: NFTs on Solana — One of a Kind.', md5('tn-3-v1'), 'seed-script', now())
  returning id into v_tn3_version_id;

  insert into lesson.lesson_versions (
    lesson_id, version, state, release_id, changelog, source_fingerprint, created_by, published_at
  ) values
    ('tn-4', 1, 'published', v_release_id, 'Initial lesson: Staking SOL — Put Your Coins to Work.', md5('tn-4-v1'), 'seed-script', now())
  returning id into v_tn4_version_id;

  insert into lesson.lesson_versions (
    lesson_id, version, state, release_id, changelog, source_fingerprint, created_by, published_at
  ) values
    ('tn-5', 1, 'published', v_release_id, 'Initial lesson: Epochs, Commission & Picking a Validator.', md5('tn-5-v1'), 'seed-script', now())
  returning id into v_tn5_version_id;

  insert into lesson.lesson_versions (
    lesson_id, version, state, release_id, changelog, source_fingerprint, created_by, published_at
  ) values
    ('tn-6', 1, 'published', v_release_id, 'Initial lesson: Liquid Staking — Stake and Stay Flexible.', md5('tn-6-v1'), 'seed-script', now())
  returning id into v_tn6_version_id;

  ---------------------------------------------------------------------------
  -- 6. Lesson blocks
  ---------------------------------------------------------------------------

  -- ── tn-1: SOL vs SPL — Two Kinds of Tokens ─────────────────────────────
  insert into lesson.lesson_blocks (lesson_version_id, block_order, block_type, payload) values
  (
    v_tn1_version_id, 1, 'paragraph',
    jsonb_build_object('id','tn-1-block-1','type','paragraph','order',1,'text',$$The Native Coin and Everything Else

Solana has exactly one native coin: SOL. It's built into the network itself — it pays transaction fees, it gets staked to secure the chain, and every wallet can hold it from the moment it's created.

Everything else — USDC, BONK, JitoSOL, the thousands of tokens you'll see on explorers — is an SPL token. SPL stands for Solana Program Library, and the SPL token program is the shared standard that defines how tokens on Solana are created, held, and transferred. One standard means every wallet, exchange, and app knows how to handle every token — no special integrations needed.$$)
  ),
  (
    v_tn1_version_id, 2, 'paragraph',
    jsonb_build_object('id','tn-1-block-2','type','paragraph','order',2,'text',$$Every Token Has a Mint

Each SPL token is defined by a mint — a small account on the chain that acts as the token's ID card. The mint records the token's total supply, how many decimal places it uses, and who (if anyone) is allowed to create more of it.

USDC has one official mint address. BONK has another. When your wallet shows "USDC," what it really means is "tokens from this exact mint."

Here's the catch: creating a token costs pennies, and ANYONE can do it — with any name. A scammer can mint a token called "USDC" in thirty seconds. The name is just a label; the mint address is the truth.$$)
  ),
  (
    v_tn1_version_id, 3, 'callout',
    jsonb_build_object('id','tn-1-block-3','type','callout','order',3,'text',$$The Ticker Isn't the Token: Two tokens can both display "USDC" — only the mint address tells them apart. Explorers and good wallets mark well-known mints with a verified badge. If a "famous" token arrives from an unknown mint, it's a fake. Check the mint, not the name.$$,'calloutTone','info')
  );

  -- ── tn-2: Token Accounts & ATAs — Where Tokens Actually Sit ────────────
  insert into lesson.lesson_blocks (lesson_version_id, block_order, block_type, payload) values
  (
    v_tn2_version_id, 1, 'paragraph',
    jsonb_build_object('id','tn-2-block-1','type','paragraph','order',1,'text',$$Your Wallet Address Only Holds SOL

Here's something that surprises everyone: your main wallet address holds only SOL. It cannot hold USDC, BONK, or any other SPL token directly.

Instead, every SPL token you own sits in its own separate token account — one per token type. Think of your wallet as a filing cabinet: the cabinet itself (your address) holds SOL, and each drawer inside is a token account holding your balance of one specific token. USDC drawer, BONK drawer, JitoSOL drawer — one drawer per token.$$)
  ),
  (
    v_tn2_version_id, 2, 'paragraph',
    jsonb_build_object('id','tn-2-block-2','type','paragraph','order',2,'text',$$The ATA — A Predictable Drawer

In the early days, a wallet could have several token accounts for the same token, which confused everyone. The fix is the Associated Token Account, or ATA: a standard formula that computes ONE canonical token account address from two ingredients — your wallet address plus the token's mint.

Because it's a formula, anyone can compute your USDC ATA without asking you. That's how someone can send you a token you've never held: their wallet derives your ATA, creates it on chain, and deposits the tokens — all in one transaction.

Creating that account reserves a tiny amount of SOL on chain (about 0.002 SOL, called rent-exemption). That's why receiving a brand-new token type involves a tiny one-time cost, usually paid by the sender.$$)
  ),
  (
    v_tn2_version_id, 3, 'callout',
    jsonb_build_object('id','tn-2-block-3','type','callout','order',3,'text',$$In One Sentence: An ATA holds your balance of one specific SPL token, for one wallet — your USDC ATA holds your USDC, your BONK ATA holds your BONK, and your wallet address itself holds only SOL. When an explorer shows "Token Accounts" under your address, you now know exactly what you're looking at.$$,'calloutTone','info')
  );

  -- ── tn-3: NFTs on Solana — One of a Kind ───────────────────────────────
  insert into lesson.lesson_blocks (lesson_version_id, block_order, block_type, payload) values
  (
    v_tn3_version_id, 1, 'paragraph',
    jsonb_build_object('id','tn-3-block-1','type','paragraph','order',1,'text',$$Fungible vs. Non-Fungible

Money is fungible: any 1 USDC is exactly as good as any other 1 USDC — swap them and nothing changes. Most tokens work this way.

An NFT (non-fungible token) is the opposite: it's one of a kind. Like the original of a painting or a signed jersey, no other token is interchangeable with it. On the chain, that uniqueness is enforced by the token itself: an NFT on Solana is an SPL token whose mint has a supply of exactly 1 and zero decimals — there is one whole unit, ever, and whoever holds it owns THE thing.$$)
  ),
  (
    v_tn3_version_id, 2, 'paragraph',
    jsonb_build_object('id','tn-3-block-2','type','paragraph','order',2,'text',$$What Makes It More Than a Number

Attached to that 1-of-1 mint is metadata — the NFT's name, its image or media link, and its attributes (like "background: gold" for a collectible). The image itself usually lives off-chain in permanent storage; the chain holds the record that points to it and, crucially, the record of who owns it.

What are NFTs used for? Art and collectibles are the famous ones, but the same one-of-a-kind mechanism powers game items, event tickets, membership passes, and .sol domain names. Anything that needs a provable, transferable "there is only one of this" lives naturally as an NFT.$$)
  ),
  (
    v_tn3_version_id, 3, 'callout',
    jsonb_build_object('id','tn-3-block-3','type','callout','order',3,'text',$$Owning an NFT, Precisely: "Owning an NFT" means your token account holds that mint's single token. Sell it, and the token moves to the buyer's token account — the chain's ownership record updates for the whole world to see. You're not buying the JPEG; you're buying the publicly verifiable record of ownership.$$,'calloutTone','info')
  );

  -- ── tn-4: Staking SOL — Put Your Coins to Work ─────────────────────────
  insert into lesson.lesson_blocks (lesson_version_id, block_order, block_type, payload) values
  (
    v_tn4_version_id, 1, 'paragraph',
    jsonb_build_object('id','tn-4-block-1','type','paragraph','order',1,'text',$$Why the Network Pays You

Solana is run by validators — computers that process transactions and vote on which blocks are correct. The network trusts a validator in proportion to how much SOL backs it. That backing comes from people like you.

Staking means delegating your SOL to a validator. Your stake adds to that validator's weight, helping secure the network — and in return, the network pays rewards, historically somewhere around 5-8% per year, paid in SOL. The rewards come from the network itself (new SOL issuance plus a share of transaction fees), not from the validator's pocket.$$)
  ),
  (
    v_tn4_version_id, 2, 'paragraph',
    jsonb_build_object('id','tn-4-block-2','type','paragraph','order',2,'text',$$"Delegating" Is Not "Handing Over"

This is the part beginners worry about, so let's be precise. When you stake, your SOL moves into a stake account that YOU own. The validator never touches it, never holds it, and cannot spend it. You delegate only the stake's weight — its vote of confidence.

You can undelegate whenever you want. Your SOL then deactivates and returns to your control (the switch takes effect at the next epoch boundary — more on epochs in the next lesson). The validator can't stop you, delay you, or take a cut of your principal.$$)
  ),
  (
    v_tn4_version_id, 3, 'callout',
    jsonb_build_object('id','tn-4-block-3','type','callout','order',3,'text',$$The Mental Model: Staking is like voting with your money while keeping your money. Your SOL says "I vouch for this validator" — and the network pays you for helping it decide who to trust. It is not a loan, not a deposit, and not a transfer.$$,'calloutTone','info')
  );

  -- ── tn-5: Epochs, Commission & Picking a Validator ─────────────────────
  insert into lesson.lesson_blocks (lesson_version_id, block_order, block_type, payload) values
  (
    v_tn5_version_id, 1, 'paragraph',
    jsonb_build_object('id','tn-5-block-1','type','paragraph','order',1,'text',$$The Network's Heartbeat: Epochs

Solana time is divided into epochs — periods of roughly 2 to 3 days. Staking runs on this clock:

New stake activates at the next epoch boundary — delegate today, start earning when the epoch turns.

Unstaking works the same way — deactivate today, withdraw after the epoch turns.

Rewards land once per epoch, added straight to your stake so they compound automatically.

The wait is a feature, not a bug: it stops huge amounts of stake from stampeding in and out instantly, which keeps the network's voting power stable.$$)
  ),
  (
    v_tn5_version_id, 2, 'paragraph',
    jsonb_build_object('id','tn-5-block-2','type','paragraph','order',2,'text',$$Choosing a Validator

There are thousands of validators. Three things to check before delegating:

Commission — the percentage of your staking REWARDS the validator keeps as its fee. 5% commission means you keep 95% of the rewards your stake earns. (It never touches your principal.)

Performance — a validator that's often offline earns fewer rewards for everyone staked to it. Uptime and vote quality matter.

Decentralization — the biggest validators don't need your help. Delegating to smaller, reliable validators keeps the network healthier.

Sites like validators.app or stakewiz.com grade validators on all three.$$)
  ),
  (
    v_tn5_version_id, 3, 'callout',
    jsonb_build_object('id','tn-5-block-3','type','callout','order',3,'text',$$Watch Out for 100%: A handful of validators run 100% commission — they keep ALL the staking rewards, and delegators earn nothing. Nothing is stolen from your principal, but your yield is zero. Always glance at the commission before you delegate.$$,'calloutTone','info')
  );

  -- ── tn-6: Liquid Staking — Stake and Stay Flexible ─────────────────────
  insert into lesson.lesson_blocks (lesson_version_id, block_order, block_type, payload) values
  (
    v_tn6_version_id, 1, 'paragraph',
    jsonb_build_object('id','tn-6-block-1','type','paragraph','order',1,'text',$$The Trade-Off Liquid Staking Solves

Native staking has one annoyance: while your SOL is staked, it's busy. You can't spend it, and unstaking means waiting for an epoch boundary.

Liquid staking fixes that. You deposit SOL into a stake pool — a program that spreads the stake across many validators — and the pool hands you a liquid staking token (LST) in return: mSOL from Marinade, JitoSOL from Jito, and others. That token IS your claim on the staked SOL, and unlike a stake account, it's an ordinary SPL token: you can hold it, swap it on a DEX, or use it in DeFi — all while the SOL behind it keeps earning staking rewards.$$)
  ),
  (
    v_tn6_version_id, 2, 'paragraph',
    jsonb_build_object('id','tn-6-block-2','type','paragraph','order',2,'text',$$Why 1 JitoSOL Is Worth More Than 1 SOL

Liquid staking tokens usually don't pay rewards into your wallet. Instead, the token's exchange rate rises: as the pool's stake earns rewards each epoch, every LST becomes a claim on slightly more SOL. Deposit when 1 LST = 1.00 SOL, come back a year later, and 1 LST might redeem for roughly 1.07 SOL. The "yield" is baked into the price.

Exiting is flexible too: swap your LST back to SOL instantly on a DEX, or redeem through the pool (which follows the normal epoch delay).$$)
  ),
  (
    v_tn6_version_id, 3, 'callout',
    jsonb_build_object('id','tn-6-block-3','type','callout','order',3,'text',$$The Honest Fine Print: A stake pool is a smart contract, so liquid staking adds contract risk on top of ordinary staking — and an LST's market price can wobble slightly from its redemption value in stressed markets. The flexibility is real, and so is the extra layer. Beginners: start small, stick to the large, battle-tested pools.$$,'calloutTone','info')
  );

  ---------------------------------------------------------------------------
  -- 7. Questions
  ---------------------------------------------------------------------------

  -- tn-1 questions
  insert into lesson.questions (id, lesson_version_id, question_order, question_type, prompt, correct_answer, metadata) values
    ('tn-1-q1', v_tn1_version_id, 1, 'mcq', $$What is an SPL token?$$, $$Any token on Solana built on the shared SPL token standard$$, '{}'::jsonb),
    ('tn-1-q2', v_tn1_version_id, 2, 'mcq', $$How is SOL different from SPL tokens like USDC?$$, $$SOL is the native coin that pays fees and gets staked; SPL tokens are assets built on top$$, '{}'::jsonb),
    ('tn-1-q3', v_tn1_version_id, 3, 'short_text', $$A token arrives in your wallet named "USDC". What should you check to know if it's the real thing?$$, $$the mint address$$, '{}'::jsonb),

  -- tn-2 questions
    ('tn-2-q1', v_tn2_version_id, 1, 'mcq', $$Why can't your main wallet address hold USDC directly?$$, $$The wallet address holds only SOL; every SPL token needs its own token account$$, '{}'::jsonb),
    ('tn-2-q2', v_tn2_version_id, 2, 'mcq', $$You hold USDC, BONK, and JitoSOL. How many token accounts is that?$$, $$Three — one per token mint$$, '{}'::jsonb),
    ('tn-2-q3', v_tn2_version_id, 3, 'short_text', $$What does an ATA hold?$$, $$a specific SPL token balance for one wallet$$, '{}'::jsonb),

  -- tn-3 questions
    ('tn-3-q1', v_tn3_version_id, 1, 'mcq', $$What makes an NFT non-fungible?$$, $$It's unique — no other token is interchangeable with it$$, '{}'::jsonb),
    ('tn-3-q2', v_tn3_version_id, 2, 'mcq', $$Technically, what is an NFT on Solana?$$, $$An SPL token with a supply of 1, zero decimals, and metadata attached$$, '{}'::jsonb),
    ('tn-3-q3', v_tn3_version_id, 3, 'short_text', $$What is the total supply of a true 1-of-1 NFT's mint? (answer with just the number)$$, $$1$$, '{}'::jsonb),

  -- tn-4 questions
    ('tn-4-q1', v_tn4_version_id, 1, 'mcq', $$What are you doing when you stake SOL?$$, $$Delegating it to a validator to help secure the network and earn rewards$$, '{}'::jsonb),
    ('tn-4-q2', v_tn4_version_id, 2, 'mcq', $$Can a validator spend the SOL you delegated to it?$$, $$No — it stays in your own stake account; you delegate only its weight$$, '{}'::jsonb),
    ('tn-4-q3', v_tn4_version_id, 3, 'short_text', $$Who do you delegate your SOL to when you stake? (one word)$$, $$validator$$, '{}'::jsonb),

  -- tn-5 questions
    ('tn-5-q1', v_tn5_version_id, 1, 'mcq', $$When does newly delegated stake start earning rewards?$$, $$At the next epoch boundary — epochs last roughly 2-3 days$$, '{}'::jsonb),
    ('tn-5-q2', v_tn5_version_id, 2, 'mcq', $$A validator charges 5% commission. What does that mean?$$, $$It keeps 5% of your staking rewards — your principal is untouched$$, '{}'::jsonb),
    ('tn-5-q3', v_tn5_version_id, 3, 'short_text', $$What is the validator's cut of your staking rewards called? (one word)$$, $$commission$$, '{}'::jsonb),

  -- tn-6 questions
    ('tn-6-q1', v_tn6_version_id, 1, 'mcq', $$What do you receive when you deposit SOL into a liquid staking pool?$$, $$A liquid staking token (like mSOL or JitoSOL) representing your staked SOL$$, '{}'::jsonb),
    ('tn-6-q2', v_tn6_version_id, 2, 'mcq', $$Why does a liquid staking token slowly become worth more SOL over time?$$, $$Staking rewards accrue to the pool, so each token redeems for slightly more SOL$$, '{}'::jsonb),
    ('tn-6-q3', v_tn6_version_id, 3, 'short_text', $$What's the big advantage of liquid staking over native staking?$$, $$still use it in defi while earning rewards$$, '{}'::jsonb);

  ---------------------------------------------------------------------------
  -- 8. Question options (MCQ only)
  ---------------------------------------------------------------------------
  insert into lesson.question_options (question_id, option_order, option_text) values
    -- tn-1-q1
    ('tn-1-q1', 1, 'A token issued personally by the Solana Foundation'),
    ('tn-1-q1', 2, 'Any token on Solana built on the shared SPL token standard'),
    ('tn-1-q1', 3, 'A special kind of NFT'),
    -- tn-1-q2
    ('tn-1-q2', 1, 'SOL is the native coin that pays fees and gets staked; SPL tokens are assets built on top'),
    ('tn-1-q2', 2, 'SOL is slower to send than SPL tokens'),
    ('tn-1-q2', 3, 'There is no difference — SOL is just another SPL token'),

    -- tn-2-q1
    ('tn-2-q1', 1, 'USDC is not allowed on Solana'),
    ('tn-2-q1', 2, 'The wallet address holds only SOL; every SPL token needs its own token account'),
    ('tn-2-q1', 3, 'Because USDC is an NFT'),
    -- tn-2-q2
    ('tn-2-q2', 1, 'One — all tokens share a single account'),
    ('tn-2-q2', 2, 'Three — one per token mint'),
    ('tn-2-q2', 3, 'Zero — tokens live at the exchange'),

    -- tn-3-q1
    ('tn-3-q1', 1, 'It''s more expensive than other tokens'),
    ('tn-3-q1', 2, 'It''s unique — no other token is interchangeable with it'),
    ('tn-3-q1', 3, 'It can''t be sent to other wallets'),
    -- tn-3-q2
    ('tn-3-q2', 1, 'An SPL token with a supply of 1, zero decimals, and metadata attached'),
    ('tn-3-q2', 2, 'A JPEG stored entirely on the blockchain'),
    ('tn-3-q2', 3, 'A special account type created by validators'),

    -- tn-4-q1
    ('tn-4-q1', 1, 'Delegating it to a validator to help secure the network and earn rewards'),
    ('tn-4-q1', 2, 'Lending it to the validator to trade with'),
    ('tn-4-q1', 3, 'Donating it to the Solana Foundation'),
    -- tn-4-q2
    ('tn-4-q2', 1, 'Yes — that''s what staking means'),
    ('tn-4-q2', 2, 'No — it stays in your own stake account; you delegate only its weight'),
    ('tn-4-q2', 3, 'Only if it asks for an admin password'),

    -- tn-5-q1
    ('tn-5-q1', 1, 'Instantly, the second you delegate'),
    ('tn-5-q1', 2, 'At the next epoch boundary — epochs last roughly 2-3 days'),
    ('tn-5-q1', 3, 'After exactly 30 days'),
    -- tn-5-q2
    ('tn-5-q2', 1, 'It takes 5% of your staked SOL every year'),
    ('tn-5-q2', 2, 'It keeps 5% of your staking rewards — your principal is untouched'),
    ('tn-5-q2', 3, 'You must pay 5% upfront to delegate'),

    -- tn-6-q1
    ('tn-6-q1', 1, 'A liquid staking token (like mSOL or JitoSOL) representing your staked SOL'),
    ('tn-6-q1', 2, 'A paper certificate from the validator'),
    ('tn-6-q1', 3, 'Nothing — the pool holds it as a favor'),
    -- tn-6-q2
    ('tn-6-q2', 1, 'The pool prints extra SOL for holders'),
    ('tn-6-q2', 2, 'Staking rewards accrue to the pool, so each token redeems for slightly more SOL'),
    ('tn-6-q2', 3, 'Validators tip their favorite delegators');

  ---------------------------------------------------------------------------
  -- 9. Source attributions
  ---------------------------------------------------------------------------
  insert into lesson.source_attributions (lesson_version_id, source_url, source_repo, source_ref, source_license, citation_note) values
    (v_tn1_version_id, 'https://spl.solana.com/token', 'solana-labs/solana-program-library', 'token', 'Apache-2.0', 'SPL token and mint concepts adapted for beginner Course 5.'),
    (v_tn2_version_id, 'https://spl.solana.com/associated-token-account', 'solana-labs/solana-program-library', 'associated-token-account', 'Apache-2.0', 'Token account and ATA concepts adapted for beginner Course 5.'),
    (v_tn3_version_id, 'https://developers.metaplex.com/token-metadata', 'metaplex-foundation/mpl-token-metadata', 'docs', 'Apache-2.0', 'NFT and metadata concepts adapted for beginner Course 5.'),
    (v_tn4_version_id, 'https://solana.com/docs/references/staking', 'solana-labs/solana', 'docs/references/staking', 'Apache-2.0', 'Staking and delegation concepts adapted for beginner Course 5.'),
    (v_tn5_version_id, 'https://solana.com/docs/references/staking/stake-accounts', 'solana-labs/solana', 'docs/references/staking', 'Apache-2.0', 'Epoch and commission concepts adapted for beginner Course 5.'),
    (v_tn6_version_id, 'https://spl.solana.com/stake-pool', 'solana-labs/solana-program-library', 'stake-pool', 'Apache-2.0', 'Stake pool and liquid staking concepts adapted for beginner Course 5.');

  ---------------------------------------------------------------------------
  -- 10. Published payloads (sanitized — no correctAnswer)
  ---------------------------------------------------------------------------

  -- tn-1 payload
  v_tn1_payload := jsonb_build_object(
    'id','tn-1','courseId','tokens-nfts-staking','moduleId','tokens-nfts-staking-module-core','title','SOL vs SPL — Two Kinds of Tokens','order',1,'version',1,'releaseId',v_release_id::text,
    'blocks', jsonb_build_array(
      jsonb_build_object('id','tn-1-block-1','type','paragraph','order',1,'text',$$The Native Coin and Everything Else

Solana has exactly one native coin: SOL. It's built into the network itself — it pays transaction fees, it gets staked to secure the chain, and every wallet can hold it from the moment it's created.

Everything else — USDC, BONK, JitoSOL, the thousands of tokens you'll see on explorers — is an SPL token. SPL stands for Solana Program Library, and the SPL token program is the shared standard that defines how tokens on Solana are created, held, and transferred. One standard means every wallet, exchange, and app knows how to handle every token — no special integrations needed.$$),
      jsonb_build_object('id','tn-1-block-2','type','paragraph','order',2,'text',$$Every Token Has a Mint

Each SPL token is defined by a mint — a small account on the chain that acts as the token's ID card. The mint records the token's total supply, how many decimal places it uses, and who (if anyone) is allowed to create more of it.

USDC has one official mint address. BONK has another. When your wallet shows "USDC," what it really means is "tokens from this exact mint."

Here's the catch: creating a token costs pennies, and ANYONE can do it — with any name. A scammer can mint a token called "USDC" in thirty seconds. The name is just a label; the mint address is the truth.$$),
      jsonb_build_object('id','tn-1-block-3','type','callout','order',3,'text',$$The Ticker Isn't the Token: Two tokens can both display "USDC" — only the mint address tells them apart. Explorers and good wallets mark well-known mints with a verified badge. If a "famous" token arrives from an unknown mint, it's a fake. Check the mint, not the name.$$,'calloutTone','info')
    ),
    'questions', jsonb_build_array(
      jsonb_build_object('id','tn-1-q1','type','mcq','prompt',$$What is an SPL token?$$,'options',jsonb_build_array(
        jsonb_build_object('id','tn-1-q1-opt-1','text','A token issued personally by the Solana Foundation'),
        jsonb_build_object('id','tn-1-q1-opt-2','text','Any token on Solana built on the shared SPL token standard'),
        jsonb_build_object('id','tn-1-q1-opt-3','text','A special kind of NFT')
      )),
      jsonb_build_object('id','tn-1-q2','type','mcq','prompt',$$How is SOL different from SPL tokens like USDC?$$,'options',jsonb_build_array(
        jsonb_build_object('id','tn-1-q2-opt-1','text','SOL is the native coin that pays fees and gets staked; SPL tokens are assets built on top'),
        jsonb_build_object('id','tn-1-q2-opt-2','text','SOL is slower to send than SPL tokens'),
        jsonb_build_object('id','tn-1-q2-opt-3','text','There is no difference — SOL is just another SPL token')
      )),
      jsonb_build_object('id','tn-1-q3','type','short_text','prompt',$$A token arrives in your wallet named "USDC". What should you check to know if it's the real thing?$$)
    )
  );

  -- tn-2 payload
  v_tn2_payload := jsonb_build_object(
    'id','tn-2','courseId','tokens-nfts-staking','moduleId','tokens-nfts-staking-module-core','title','Token Accounts & ATAs — Where Tokens Actually Sit','order',2,'version',1,'releaseId',v_release_id::text,
    'blocks', jsonb_build_array(
      jsonb_build_object('id','tn-2-block-1','type','paragraph','order',1,'text',$$Your Wallet Address Only Holds SOL

Here's something that surprises everyone: your main wallet address holds only SOL. It cannot hold USDC, BONK, or any other SPL token directly.

Instead, every SPL token you own sits in its own separate token account — one per token type. Think of your wallet as a filing cabinet: the cabinet itself (your address) holds SOL, and each drawer inside is a token account holding your balance of one specific token. USDC drawer, BONK drawer, JitoSOL drawer — one drawer per token.$$),
      jsonb_build_object('id','tn-2-block-2','type','paragraph','order',2,'text',$$The ATA — A Predictable Drawer

In the early days, a wallet could have several token accounts for the same token, which confused everyone. The fix is the Associated Token Account, or ATA: a standard formula that computes ONE canonical token account address from two ingredients — your wallet address plus the token's mint.

Because it's a formula, anyone can compute your USDC ATA without asking you. That's how someone can send you a token you've never held: their wallet derives your ATA, creates it on chain, and deposits the tokens — all in one transaction.

Creating that account reserves a tiny amount of SOL on chain (about 0.002 SOL, called rent-exemption). That's why receiving a brand-new token type involves a tiny one-time cost, usually paid by the sender.$$),
      jsonb_build_object('id','tn-2-block-3','type','callout','order',3,'text',$$In One Sentence: An ATA holds your balance of one specific SPL token, for one wallet — your USDC ATA holds your USDC, your BONK ATA holds your BONK, and your wallet address itself holds only SOL. When an explorer shows "Token Accounts" under your address, you now know exactly what you're looking at.$$,'calloutTone','info')
    ),
    'questions', jsonb_build_array(
      jsonb_build_object('id','tn-2-q1','type','mcq','prompt',$$Why can't your main wallet address hold USDC directly?$$,'options',jsonb_build_array(
        jsonb_build_object('id','tn-2-q1-opt-1','text','USDC is not allowed on Solana'),
        jsonb_build_object('id','tn-2-q1-opt-2','text','The wallet address holds only SOL; every SPL token needs its own token account'),
        jsonb_build_object('id','tn-2-q1-opt-3','text','Because USDC is an NFT')
      )),
      jsonb_build_object('id','tn-2-q2','type','mcq','prompt',$$You hold USDC, BONK, and JitoSOL. How many token accounts is that?$$,'options',jsonb_build_array(
        jsonb_build_object('id','tn-2-q2-opt-1','text','One — all tokens share a single account'),
        jsonb_build_object('id','tn-2-q2-opt-2','text','Three — one per token mint'),
        jsonb_build_object('id','tn-2-q2-opt-3','text','Zero — tokens live at the exchange')
      )),
      jsonb_build_object('id','tn-2-q3','type','short_text','prompt',$$What does an ATA hold?$$)
    )
  );

  -- tn-3 payload
  v_tn3_payload := jsonb_build_object(
    'id','tn-3','courseId','tokens-nfts-staking','moduleId','tokens-nfts-staking-module-core','title','NFTs on Solana — One of a Kind','order',3,'version',1,'releaseId',v_release_id::text,
    'blocks', jsonb_build_array(
      jsonb_build_object('id','tn-3-block-1','type','paragraph','order',1,'text',$$Fungible vs. Non-Fungible

Money is fungible: any 1 USDC is exactly as good as any other 1 USDC — swap them and nothing changes. Most tokens work this way.

An NFT (non-fungible token) is the opposite: it's one of a kind. Like the original of a painting or a signed jersey, no other token is interchangeable with it. On the chain, that uniqueness is enforced by the token itself: an NFT on Solana is an SPL token whose mint has a supply of exactly 1 and zero decimals — there is one whole unit, ever, and whoever holds it owns THE thing.$$),
      jsonb_build_object('id','tn-3-block-2','type','paragraph','order',2,'text',$$What Makes It More Than a Number

Attached to that 1-of-1 mint is metadata — the NFT's name, its image or media link, and its attributes (like "background: gold" for a collectible). The image itself usually lives off-chain in permanent storage; the chain holds the record that points to it and, crucially, the record of who owns it.

What are NFTs used for? Art and collectibles are the famous ones, but the same one-of-a-kind mechanism powers game items, event tickets, membership passes, and .sol domain names. Anything that needs a provable, transferable "there is only one of this" lives naturally as an NFT.$$),
      jsonb_build_object('id','tn-3-block-3','type','callout','order',3,'text',$$Owning an NFT, Precisely: "Owning an NFT" means your token account holds that mint's single token. Sell it, and the token moves to the buyer's token account — the chain's ownership record updates for the whole world to see. You're not buying the JPEG; you're buying the publicly verifiable record of ownership.$$,'calloutTone','info')
    ),
    'questions', jsonb_build_array(
      jsonb_build_object('id','tn-3-q1','type','mcq','prompt',$$What makes an NFT non-fungible?$$,'options',jsonb_build_array(
        jsonb_build_object('id','tn-3-q1-opt-1','text','It''s more expensive than other tokens'),
        jsonb_build_object('id','tn-3-q1-opt-2','text','It''s unique — no other token is interchangeable with it'),
        jsonb_build_object('id','tn-3-q1-opt-3','text','It can''t be sent to other wallets')
      )),
      jsonb_build_object('id','tn-3-q2','type','mcq','prompt',$$Technically, what is an NFT on Solana?$$,'options',jsonb_build_array(
        jsonb_build_object('id','tn-3-q2-opt-1','text','An SPL token with a supply of 1, zero decimals, and metadata attached'),
        jsonb_build_object('id','tn-3-q2-opt-2','text','A JPEG stored entirely on the blockchain'),
        jsonb_build_object('id','tn-3-q2-opt-3','text','A special account type created by validators')
      )),
      jsonb_build_object('id','tn-3-q3','type','short_text','prompt',$$What is the total supply of a true 1-of-1 NFT's mint? (answer with just the number)$$)
    )
  );

  -- tn-4 payload
  v_tn4_payload := jsonb_build_object(
    'id','tn-4','courseId','tokens-nfts-staking','moduleId','tokens-nfts-staking-module-core','title','Staking SOL — Put Your Coins to Work','order',4,'version',1,'releaseId',v_release_id::text,
    'blocks', jsonb_build_array(
      jsonb_build_object('id','tn-4-block-1','type','paragraph','order',1,'text',$$Why the Network Pays You

Solana is run by validators — computers that process transactions and vote on which blocks are correct. The network trusts a validator in proportion to how much SOL backs it. That backing comes from people like you.

Staking means delegating your SOL to a validator. Your stake adds to that validator's weight, helping secure the network — and in return, the network pays rewards, historically somewhere around 5-8% per year, paid in SOL. The rewards come from the network itself (new SOL issuance plus a share of transaction fees), not from the validator's pocket.$$),
      jsonb_build_object('id','tn-4-block-2','type','paragraph','order',2,'text',$$"Delegating" Is Not "Handing Over"

This is the part beginners worry about, so let's be precise. When you stake, your SOL moves into a stake account that YOU own. The validator never touches it, never holds it, and cannot spend it. You delegate only the stake's weight — its vote of confidence.

You can undelegate whenever you want. Your SOL then deactivates and returns to your control (the switch takes effect at the next epoch boundary — more on epochs in the next lesson). The validator can't stop you, delay you, or take a cut of your principal.$$),
      jsonb_build_object('id','tn-4-block-3','type','callout','order',3,'text',$$The Mental Model: Staking is like voting with your money while keeping your money. Your SOL says "I vouch for this validator" — and the network pays you for helping it decide who to trust. It is not a loan, not a deposit, and not a transfer.$$,'calloutTone','info')
    ),
    'questions', jsonb_build_array(
      jsonb_build_object('id','tn-4-q1','type','mcq','prompt',$$What are you doing when you stake SOL?$$,'options',jsonb_build_array(
        jsonb_build_object('id','tn-4-q1-opt-1','text','Delegating it to a validator to help secure the network and earn rewards'),
        jsonb_build_object('id','tn-4-q1-opt-2','text','Lending it to the validator to trade with'),
        jsonb_build_object('id','tn-4-q1-opt-3','text','Donating it to the Solana Foundation')
      )),
      jsonb_build_object('id','tn-4-q2','type','mcq','prompt',$$Can a validator spend the SOL you delegated to it?$$,'options',jsonb_build_array(
        jsonb_build_object('id','tn-4-q2-opt-1','text','Yes — that''s what staking means'),
        jsonb_build_object('id','tn-4-q2-opt-2','text','No — it stays in your own stake account; you delegate only its weight'),
        jsonb_build_object('id','tn-4-q2-opt-3','text','Only if it asks for an admin password')
      )),
      jsonb_build_object('id','tn-4-q3','type','short_text','prompt',$$Who do you delegate your SOL to when you stake? (one word)$$)
    )
  );

  -- tn-5 payload
  v_tn5_payload := jsonb_build_object(
    'id','tn-5','courseId','tokens-nfts-staking','moduleId','tokens-nfts-staking-module-core','title','Epochs, Commission & Picking a Validator','order',5,'version',1,'releaseId',v_release_id::text,
    'blocks', jsonb_build_array(
      jsonb_build_object('id','tn-5-block-1','type','paragraph','order',1,'text',$$The Network's Heartbeat: Epochs

Solana time is divided into epochs — periods of roughly 2 to 3 days. Staking runs on this clock:

New stake activates at the next epoch boundary — delegate today, start earning when the epoch turns.

Unstaking works the same way — deactivate today, withdraw after the epoch turns.

Rewards land once per epoch, added straight to your stake so they compound automatically.

The wait is a feature, not a bug: it stops huge amounts of stake from stampeding in and out instantly, which keeps the network's voting power stable.$$),
      jsonb_build_object('id','tn-5-block-2','type','paragraph','order',2,'text',$$Choosing a Validator

There are thousands of validators. Three things to check before delegating:

Commission — the percentage of your staking REWARDS the validator keeps as its fee. 5% commission means you keep 95% of the rewards your stake earns. (It never touches your principal.)

Performance — a validator that's often offline earns fewer rewards for everyone staked to it. Uptime and vote quality matter.

Decentralization — the biggest validators don't need your help. Delegating to smaller, reliable validators keeps the network healthier.

Sites like validators.app or stakewiz.com grade validators on all three.$$),
      jsonb_build_object('id','tn-5-block-3','type','callout','order',3,'text',$$Watch Out for 100%: A handful of validators run 100% commission — they keep ALL the staking rewards, and delegators earn nothing. Nothing is stolen from your principal, but your yield is zero. Always glance at the commission before you delegate.$$,'calloutTone','info')
    ),
    'questions', jsonb_build_array(
      jsonb_build_object('id','tn-5-q1','type','mcq','prompt',$$When does newly delegated stake start earning rewards?$$,'options',jsonb_build_array(
        jsonb_build_object('id','tn-5-q1-opt-1','text','Instantly, the second you delegate'),
        jsonb_build_object('id','tn-5-q1-opt-2','text','At the next epoch boundary — epochs last roughly 2-3 days'),
        jsonb_build_object('id','tn-5-q1-opt-3','text','After exactly 30 days')
      )),
      jsonb_build_object('id','tn-5-q2','type','mcq','prompt',$$A validator charges 5% commission. What does that mean?$$,'options',jsonb_build_array(
        jsonb_build_object('id','tn-5-q2-opt-1','text','It takes 5% of your staked SOL every year'),
        jsonb_build_object('id','tn-5-q2-opt-2','text','It keeps 5% of your staking rewards — your principal is untouched'),
        jsonb_build_object('id','tn-5-q2-opt-3','text','You must pay 5% upfront to delegate')
      )),
      jsonb_build_object('id','tn-5-q3','type','short_text','prompt',$$What is the validator's cut of your staking rewards called? (one word)$$)
    )
  );

  -- tn-6 payload
  v_tn6_payload := jsonb_build_object(
    'id','tn-6','courseId','tokens-nfts-staking','moduleId','tokens-nfts-staking-module-core','title','Liquid Staking — Stake and Stay Flexible','order',6,'version',1,'releaseId',v_release_id::text,
    'blocks', jsonb_build_array(
      jsonb_build_object('id','tn-6-block-1','type','paragraph','order',1,'text',$$The Trade-Off Liquid Staking Solves

Native staking has one annoyance: while your SOL is staked, it's busy. You can't spend it, and unstaking means waiting for an epoch boundary.

Liquid staking fixes that. You deposit SOL into a stake pool — a program that spreads the stake across many validators — and the pool hands you a liquid staking token (LST) in return: mSOL from Marinade, JitoSOL from Jito, and others. That token IS your claim on the staked SOL, and unlike a stake account, it's an ordinary SPL token: you can hold it, swap it on a DEX, or use it in DeFi — all while the SOL behind it keeps earning staking rewards.$$),
      jsonb_build_object('id','tn-6-block-2','type','paragraph','order',2,'text',$$Why 1 JitoSOL Is Worth More Than 1 SOL

Liquid staking tokens usually don't pay rewards into your wallet. Instead, the token's exchange rate rises: as the pool's stake earns rewards each epoch, every LST becomes a claim on slightly more SOL. Deposit when 1 LST = 1.00 SOL, come back a year later, and 1 LST might redeem for roughly 1.07 SOL. The "yield" is baked into the price.

Exiting is flexible too: swap your LST back to SOL instantly on a DEX, or redeem through the pool (which follows the normal epoch delay).$$),
      jsonb_build_object('id','tn-6-block-3','type','callout','order',3,'text',$$The Honest Fine Print: A stake pool is a smart contract, so liquid staking adds contract risk on top of ordinary staking — and an LST's market price can wobble slightly from its redemption value in stressed markets. The flexibility is real, and so is the extra layer. Beginners: start small, stick to the large, battle-tested pools.$$,'calloutTone','info')
    ),
    'questions', jsonb_build_array(
      jsonb_build_object('id','tn-6-q1','type','mcq','prompt',$$What do you receive when you deposit SOL into a liquid staking pool?$$,'options',jsonb_build_array(
        jsonb_build_object('id','tn-6-q1-opt-1','text','A liquid staking token (like mSOL or JitoSOL) representing your staked SOL'),
        jsonb_build_object('id','tn-6-q1-opt-2','text','A paper certificate from the validator'),
        jsonb_build_object('id','tn-6-q1-opt-3','text','Nothing — the pool holds it as a favor')
      )),
      jsonb_build_object('id','tn-6-q2','type','mcq','prompt',$$Why does a liquid staking token slowly become worth more SOL over time?$$,'options',jsonb_build_array(
        jsonb_build_object('id','tn-6-q2-opt-1','text','The pool prints extra SOL for holders'),
        jsonb_build_object('id','tn-6-q2-opt-2','text','Staking rewards accrue to the pool, so each token redeems for slightly more SOL'),
        jsonb_build_object('id','tn-6-q2-opt-3','text','Validators tip their favorite delegators')
      )),
      jsonb_build_object('id','tn-6-q3','type','short_text','prompt',$$What's the big advantage of liquid staking over native staking?$$)
    )
  );

  ---------------------------------------------------------------------------
  -- 11. Published module
  ---------------------------------------------------------------------------
  insert into lesson.published_modules (release_id, course_id, module_id, module_order, payload) values
  (
    v_release_id,
    'tokens-nfts-staking',
    'tokens-nfts-staking-module-core',
    1,
    jsonb_build_object(
      'id', 'tokens-nfts-staking-module-core',
      'courseId', 'tokens-nfts-staking',
      'slug', 'tokens-nfts-staking-core',
      'title', 'Tokens, NFTs & Staking Core',
      'description', 'Core module for Course 5: Tokens, NFTs & Staking.',
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
    (v_release_id, 'tn-1', 'tokens-nfts-staking-module-core', v_tn1_version_id, 1, v_tn1_payload),
    (v_release_id, 'tn-2', 'tokens-nfts-staking-module-core', v_tn2_version_id, 2, v_tn2_payload),
    (v_release_id, 'tn-3', 'tokens-nfts-staking-module-core', v_tn3_version_id, 3, v_tn3_payload),
    (v_release_id, 'tn-4', 'tokens-nfts-staking-module-core', v_tn4_version_id, 4, v_tn4_payload),
    (v_release_id, 'tn-5', 'tokens-nfts-staking-module-core', v_tn5_version_id, 5, v_tn5_payload),
    (v_release_id, 'tn-6', 'tokens-nfts-staking-module-core', v_tn6_version_id, 6, v_tn6_payload);

  ---------------------------------------------------------------------------
  -- 13. Published lesson payloads (with content_hash)
  ---------------------------------------------------------------------------
  insert into lesson.published_lesson_payloads (release_id, lesson_id, payload, content_hash) values
    (v_release_id, 'tn-1', v_tn1_payload, md5(v_tn1_payload::text)),
    (v_release_id, 'tn-2', v_tn2_payload, md5(v_tn2_payload::text)),
    (v_release_id, 'tn-3', v_tn3_payload, md5(v_tn3_payload::text)),
    (v_release_id, 'tn-4', v_tn4_payload, md5(v_tn4_payload::text)),
    (v_release_id, 'tn-5', v_tn5_payload, md5(v_tn5_payload::text)),
    (v_release_id, 'tn-6', v_tn6_payload, md5(v_tn6_payload::text));

  raise notice 'Course 5 Tokens, NFTs & Staking release complete. Release ID: %', v_release_id;
end;
$seed$;
