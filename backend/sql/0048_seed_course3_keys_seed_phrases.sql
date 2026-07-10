create extension if not exists pgcrypto;

do $seed$
declare
  v_release_id uuid;

  v_ks1_version_id uuid;
  v_ks2_version_id uuid;
  v_ks3_version_id uuid;
  v_ks4_version_id uuid;
  v_ks5_version_id uuid;
  v_ks6_version_id uuid;

  v_ks1_payload jsonb;
  v_ks2_payload jsonb;
  v_ks3_payload jsonb;
  v_ks4_payload jsonb;
  v_ks5_payload jsonb;
  v_ks6_payload jsonb;
begin
  if exists (
    select 1
    from lesson.publish_releases
    where release_name = 'course3-keys-seed-phrases-v1'
  ) then
    raise notice 'Seed skipped: course3-keys-seed-phrases-v1 already exists.';
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
    'keys-and-seed-phrases',
    'keys-and-seed-phrases',
    'Keys & Seed Phrases — Own Your Crypto',
    'Self-custody made simple — what private keys and seed phrases really are, how to store them safely, and how to spot the scams that try to take them.',
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
    'keys-seed-phrases-module-core',
    'keys-seed-phrases-core',
    'Keys & Seed Phrases Core',
    'Core module for Course 3: Keys & Seed Phrases — Own Your Crypto.',
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
    ('keys-and-seed-phrases', 'keys-seed-phrases-module-core', 1, true)
  on conflict (course_id, module_id) do update set
    module_order = excluded.module_order,
    is_required = excluded.is_required;

  ---------------------------------------------------------------------------
  -- 3. Lessons
  ---------------------------------------------------------------------------
  insert into lesson.lessons (id, slug, title) values
    ('ks-1', 'your-keys-or-their-keys',        'Your Keys or Their Keys — Where Crypto Really Lives'),
    ('ks-2', 'public-and-private-keys',        'Public & Private Keys — The Lock and the Key'),
    ('ks-3', 'the-12-word-seed-phrase',        'The 12-Word Seed Phrase — Your Master Backup'),
    ('ks-4', 'hardware-wallets-cold-storage',  'Hardware Wallets — Cold Storage for Serious Savings'),
    ('ks-5', 'scams-and-phishing',             'Scams & Phishing — Know the Tricks'),
    ('ks-6', 'the-golden-rules',               'The Golden Rules — Protect Yourself Forever')
  on conflict (id) do update set
    title = excluded.title,
    updated_at = now();

  insert into lesson.module_lessons (module_id, lesson_id, lesson_order, is_required) values
    ('keys-seed-phrases-module-core', 'ks-1', 1, true),
    ('keys-seed-phrases-module-core', 'ks-2', 2, true),
    ('keys-seed-phrases-module-core', 'ks-3', 3, true),
    ('keys-seed-phrases-module-core', 'ks-4', 4, true),
    ('keys-seed-phrases-module-core', 'ks-5', 5, true),
    ('keys-seed-phrases-module-core', 'ks-6', 6, true)
  on conflict (module_id, lesson_id) do update set
    lesson_order = excluded.lesson_order,
    is_required = excluded.is_required;

  ---------------------------------------------------------------------------
  -- 4. Publish release
  ---------------------------------------------------------------------------
  insert into lesson.publish_releases (release_name, notes, created_by)
  values (
    'course3-keys-seed-phrases-v1',
    'Course 3: Keys & Seed Phrases — 6 beginner lessons covering self-custody, key pairs, seed phrases, hardware wallets, scams, and safety rules.',
    'seed-script'
  )
  returning id into v_release_id;

  ---------------------------------------------------------------------------
  -- 5. Lesson versions
  ---------------------------------------------------------------------------
  insert into lesson.lesson_versions (
    lesson_id, version, state, release_id, changelog, source_fingerprint, created_by, published_at
  ) values
    ('ks-1', 1, 'published', v_release_id, 'Initial lesson: Your Keys or Their Keys — Where Crypto Really Lives.', md5('ks-1-v1'), 'seed-script', now())
  returning id into v_ks1_version_id;

  insert into lesson.lesson_versions (
    lesson_id, version, state, release_id, changelog, source_fingerprint, created_by, published_at
  ) values
    ('ks-2', 1, 'published', v_release_id, 'Initial lesson: Public & Private Keys — The Lock and the Key.', md5('ks-2-v1'), 'seed-script', now())
  returning id into v_ks2_version_id;

  insert into lesson.lesson_versions (
    lesson_id, version, state, release_id, changelog, source_fingerprint, created_by, published_at
  ) values
    ('ks-3', 1, 'published', v_release_id, 'Initial lesson: The 12-Word Seed Phrase — Your Master Backup.', md5('ks-3-v1'), 'seed-script', now())
  returning id into v_ks3_version_id;

  insert into lesson.lesson_versions (
    lesson_id, version, state, release_id, changelog, source_fingerprint, created_by, published_at
  ) values
    ('ks-4', 1, 'published', v_release_id, 'Initial lesson: Hardware Wallets — Cold Storage for Serious Savings.', md5('ks-4-v1'), 'seed-script', now())
  returning id into v_ks4_version_id;

  insert into lesson.lesson_versions (
    lesson_id, version, state, release_id, changelog, source_fingerprint, created_by, published_at
  ) values
    ('ks-5', 1, 'published', v_release_id, 'Initial lesson: Scams & Phishing — Know the Tricks.', md5('ks-5-v1'), 'seed-script', now())
  returning id into v_ks5_version_id;

  insert into lesson.lesson_versions (
    lesson_id, version, state, release_id, changelog, source_fingerprint, created_by, published_at
  ) values
    ('ks-6', 1, 'published', v_release_id, 'Initial lesson: The Golden Rules — Protect Yourself Forever.', md5('ks-6-v1'), 'seed-script', now())
  returning id into v_ks6_version_id;

  ---------------------------------------------------------------------------
  -- 6. Lesson blocks
  ---------------------------------------------------------------------------

  -- ── ks-1: Your Keys or Their Keys — Where Crypto Really Lives ──────────
  insert into lesson.lesson_blocks (lesson_version_id, block_order, block_type, payload) values
  (
    v_ks1_version_id, 1, 'paragraph',
    jsonb_build_object('id','ks-1-block-1','type','paragraph','order',1,'text',$$Two Ways to Hold Crypto

There are exactly two ways to hold crypto, and the difference matters more than anything else you'll learn in this course.

Way one: an exchange account. You sign up on an app like Coinbase or Binance, buy some crypto, and see a balance on your screen. Feels like yours, right? Here's the catch — the exchange holds the keys. What you actually have is an entry in their database. An IOU. A promise that they'll give you your crypto when you ask.

Way two: your own wallet. You hold the private keys yourself. No company sits between you and your money. The blockchain answers to your keys, and only your keys.$$)
  ),
  (
    v_ks1_version_id, 2, 'paragraph',
    jsonb_build_object('id','ks-1-block-2','type','paragraph','order',2,'text',$$What Can Go Wrong With "Way One"

Exchanges are convenient — but that convenience has a price:

They can freeze withdrawals. When markets panic, exchanges have paused withdrawals exactly when people wanted their money most.

They can get hacked. Exchanges are giant honeypots. Billions of dollars have been stolen from exchange wallets over the years.

They can collapse. In 2022, FTX — one of the biggest exchanges in the world — went bankrupt almost overnight. Millions of customers discovered their "balances" were IOUs from a company that had quietly spent their deposits. Many never got their money back.

They make the rules. Account reviews, region bans, identity re-checks — your access depends on their policies, not on you.$$)
  ),
  (
    v_ks1_version_id, 3, 'callout',
    jsonb_build_object('id','ks-1-block-3','type','callout','order',3,'text',$$The Saying That Sums It Up: "Not your keys, not your coins." If someone else holds the private keys, they hold the crypto — whatever your app balance says. This one sentence has saved more people from losing money than any security tool ever built.$$,'calloutTone','info')
  ),
  (
    v_ks1_version_id, 4, 'paragraph',
    jsonb_build_object('id','ks-1-block-4','type','paragraph','order',4,'text',$$The Trade — Control for Responsibility

Self-custody flips the deal. You get full control: nobody can freeze, seize, or "review" your funds. But you also take full responsibility: there is no "forgot password" button, no support line that can restore a lost key.

That responsibility sounds scary, but it's smaller than it seems. It boils down to protecting one thing — your keys. The rest of this course teaches you exactly how: what the keys are, how the seed phrase backs them up, and how to keep both away from thieves.$$)
  );

  -- ── ks-2: Public & Private Keys — The Lock and the Key ─────────────────
  insert into lesson.lesson_blocks (lesson_version_id, block_order, block_type, payload) values
  (
    v_ks2_version_id, 1, 'paragraph',
    jsonb_build_object('id','ks-2-block-1','type','paragraph','order',1,'text',$$Every Wallet Is a Pair of Keys

A crypto wallet isn't a bag of coins — it's a pair of mathematically linked keys.

Your public key is your address. Think of it like the slot on a mailbox: anyone can drop mail in if they know where it is. You can share it freely — post it, print it, text it. People need it to send you crypto. On Solana it looks like a long string of letters and numbers, something like 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU.

Your private key is the key that opens the box. It's a secret number that proves you own everything at that address. Whoever knows it controls the funds. Full stop.$$)
  ),
  (
    v_ks2_version_id, 2, 'paragraph',
    jsonb_build_object('id','ks-2-block-2','type','paragraph','order',2,'text',$$What "Signing" Actually Means

When you send crypto, your wallet doesn't upload your private key anywhere. Instead, it uses the private key to create a digital signature — a piece of math that proves "the owner of this address approved this exact transaction."

Anyone on the network can check the signature against your public key and confirm it's genuine — without ever seeing the private key itself. That's the magic trick that makes the whole system work: you can prove you approved something without revealing your secret.$$)
  ),
  (
    v_ks2_version_id, 3, 'callout',
    jsonb_build_object('id','ks-2-block-3','type','callout','order',3,'text',$$The Hard Truth: To the blockchain, your private key IS you. There's no ID check, no face scan, no second chance. If a thief gets your private key, the network will obey them exactly as it obeys you — and no one can reverse what they do. That's why every security rule in crypto is really one rule: keep the private key secret.$$,'calloutTone','info')
  );

  -- ── ks-3: The 12-Word Seed Phrase — Your Master Backup ─────────────────
  insert into lesson.lesson_blocks (lesson_version_id, block_order, block_type, payload) values
  (
    v_ks3_version_id, 1, 'paragraph',
    jsonb_build_object('id','ks-3-block-1','type','paragraph','order',1,'text',$$Twelve Ordinary Words

A private key is a huge, unreadable number — hopeless to write down without mistakes. So wallets give you something friendlier: a seed phrase (also called a recovery phrase) — usually 12 simple words, sometimes 24, in a specific order. Something like: canyon robot velvet lunch...

Those words ARE your private key, encoded in a form humans can copy correctly. Your wallet app generates the phrase once, when you first set it up, and every account and key in your wallet can be rebuilt from it.$$)
  ),
  (
    v_ks3_version_id, 2, 'paragraph',
    jsonb_build_object('id','ks-3-block-2','type','paragraph','order',2,'text',$$Why It's Called a Master Backup

Lose your phone? Delete the app? Spill coffee on your laptop? None of it matters. Install any compatible wallet on any device, type in your 12 words, and everything comes back — your address, your balance, your history. The funds were on the blockchain all along; the seed phrase just rebuilds the key that controls them.

The flip side is just as absolute: anyone who reads your seed phrase can rebuild your wallet on THEIR device and empty it in minutes. The phrase doesn't ask who's typing.$$)
  ),
  (
    v_ks3_version_id, 3, 'paragraph',
    jsonb_build_object('id','ks-3-block-3','type','paragraph','order',3,'text',$$Storage Rules (Non-Negotiable)

Write it on paper, by hand. The moment a seed phrase touches anything digital, it can be stolen by malware — so no screenshots, no photos, no cloud notes, no password managers' free-text fields, no email drafts.

Keep it somewhere safe and private. A drawer only you use, a home safe, a safety deposit box.

Consider two copies in two places. One fire or flood shouldn't be able to destroy your only backup.

Copy it exactly. The word ORDER matters — word 3 swapped with word 7 is a different wallet entirely. Double-check every word when you write it down.$$)
  ),
  (
    v_ks3_version_id, 4, 'callout',
    jsonb_build_object('id','ks-3-block-4','type','callout','order',4,'text',$$Good to Know: Seed phrases use a standard list of 2,048 English words shared across the industry. That's why a phrase written today can restore your wallet in a different app, years from now. The standard is the backup — not the app that generated it.$$,'calloutTone','info')
  );

  -- ── ks-4: Hardware Wallets — Cold Storage for Serious Savings ──────────
  insert into lesson.lesson_blocks (lesson_version_id, block_order, block_type, payload) values
  (
    v_ks4_version_id, 1, 'paragraph',
    jsonb_build_object('id','ks-4-block-1','type','paragraph','order',1,'text',$$Hot vs. Cold

Wallets come in two temperatures:

A hot wallet keeps your private key on a device that's connected to the internet — a phone app or a browser extension like Phantom. Convenient for daily use, but the key lives next to your browser tabs, downloads, and whatever malware sneaks in with them.

A cold wallet keeps the private key on a device that never touches the internet. The most popular kind is a hardware wallet — a small gadget, about the size of a USB stick, made by companies like Ledger and Trezor.$$)
  ),
  (
    v_ks4_version_id, 2, 'paragraph',
    jsonb_build_object('id','ks-4-block-2','type','paragraph','order',2,'text',$$How a Hardware Wallet Works

The private key is generated inside the device and never leaves it. Ever.

When you want to send a transaction, your computer passes the unsigned transaction to the device. The device shows you the details on its own little screen, you press a physical button to approve, and only the finished signature comes back out.

Even if your computer is riddled with viruses, the malware sees the signature — never the key. That's the whole trick, and it's why hardware wallets are the standard for storing serious amounts.$$)
  ),
  (
    v_ks4_version_id, 3, 'paragraph',
    jsonb_build_object('id','ks-4-block-3','type','paragraph','order',3,'text',$$"But What If I Lose the Gadget?"

Nothing happens to your crypto. Your funds live on the blockchain, not inside the device. When you set up a hardware wallet, it gives you — you guessed it — a seed phrase. Lose the device, buy a new one (or use any compatible wallet), restore from the seed phrase, and you're back.

A thief who finds your device still needs its PIN code, and most devices wipe themselves after a few wrong guesses. Your seed phrase, stored safely at home on paper, remains the real backup.$$)
  ),
  (
    v_ks4_version_id, 4, 'callout',
    jsonb_build_object('id','ks-4-block-4','type','callout','order',4,'text',$$A Sensible Setup: Think of a hot wallet like the cash in your pocket and a hardware wallet like the safe at home. Keep small, everyday amounts hot — and move savings you'd hate to lose into cold storage. You don't need one on day one, but know they exist for the day your balance starts to matter.$$,'calloutTone','info')
  );

  -- ── ks-5: Scams & Phishing — Know the Tricks ───────────────────────────
  insert into lesson.lesson_blocks (lesson_version_id, block_order, block_type, payload) values
  (
    v_ks5_version_id, 1, 'paragraph',
    jsonb_build_object('id','ks-5-block-1','type','paragraph','order',1,'text',$$Why Scammers Target People, Not Blockchains

Breaking the cryptography behind your keys is practically impossible. So thieves don't attack the math — they attack you. Every major crypto theft from an individual comes down to one thing: the victim was tricked into handing over their keys or approving something they shouldn't have.

And because blockchain transactions can't be reversed, there's no fraud department to call afterwards. Prevention is the whole game.$$)
  ),
  (
    v_ks5_version_id, 2, 'paragraph',
    jsonb_build_object('id','ks-5-block-2','type','paragraph','order',2,'text',$$The Four Classic Tricks

1. Fake support. Someone DMs you first — on Discord, Telegram, X — claiming to be "support" and offering to fix a problem if you "verify" or "validate" your seed phrase. Real support never DMs first, and no legitimate service ever needs your seed phrase.

2. Phishing sites. A lookalike website with a nearly identical URL — phanton.app instead of phantom.app — asks you to "import your wallet" by typing your seed phrase. The page then sends your words straight to the thief.

3. Giveaway scams. "Send 1 SOL, get 2 back!" — often dressed up with a celebrity's face or a hacked verified account. Nobody is doubling your money. Nobody.

4. Malicious approvals. A shady site asks your wallet to sign something vague. That signature can hand a drainer contract permission to empty your tokens. If you don't understand what you're signing, don't sign it.$$)
  ),
  (
    v_ks5_version_id, 3, 'paragraph',
    jsonb_build_object('id','ks-5-block-3','type','paragraph','order',3,'text',$$Red Flags You Can Spot in Seconds

Urgency — "act now or lose your funds." Panic is the scammer's best tool.

They contacted you first. Real teams announce; scammers DM.

Too good to be true. Guaranteed returns, free money, secret airdrops.

Any request for your seed phrase — anywhere, ever, for any reason.

Slightly-off URLs. Bookmark the real sites you use and only enter through your bookmarks.$$)
  ),
  (
    v_ks5_version_id, 4, 'callout',
    jsonb_build_object('id','ks-5-block-4','type','callout','order',4,'text',$$One Rule Beats All: Legitimate apps, wallets, and support teams NEVER need your seed phrase — not to verify, not to sync, not to fix a bug, not to send you a refund. The only people on Earth who ask for it are trying to rob you. Memorize that, and 90% of crypto scams simply stop working on you.$$,'calloutTone','info')
  );

  -- ── ks-6: The Golden Rules — Protect Yourself Forever ──────────────────
  insert into lesson.lesson_blocks (lesson_version_id, block_order, block_type, payload) values
  (
    v_ks6_version_id, 1, 'paragraph',
    jsonb_build_object('id','ks-6-block-1','type','paragraph','order',1,'text',$$Five Habits, Lifetime of Safety

Everything in this course compresses into five habits:

1. Never share your seed phrase. Not with support, not with friends, not with anyone. Never type it into a website.

2. Keep the phrase on paper, offline. No photos, no cloud, no notes app.

3. Bookmark the real sites. Enter Phantom, LockedIn, or any dApp through your own bookmarks — never through DM links or search ads.

4. Read before you sign. Every wallet pop-up is a decision. If you can't tell what it does, close it.

5. Start small. Trying a new app or sending to a new address? Test with a tiny amount first.$$)
  ),
  (
    v_ks6_version_id, 2, 'paragraph',
    jsonb_build_object('id','ks-6-block-2','type','paragraph','order',2,'text',$$If Your Seed Phrase Ever Leaks

Maybe you typed it into a site that felt wrong, or found a photo of it in your cloud storage. Treat the wallet as burned — even if nothing has been stolen yet.

Create a brand-new wallet with a brand-new seed phrase, and move your funds to it immediately. Then stop using the old one forever. There is no way to "change the password" on a compromised seed phrase — the only fix is a new wallet.

Speed matters: drainer bots watch leaked phrases and can empty a wallet within minutes.$$)
  ),
  (
    v_ks6_version_id, 3, 'callout',
    jsonb_build_object('id','ks-6-block-3','type','callout','order',3,'text',$$You're Ready: Self-custody isn't about paranoia — it's about a few boring habits done consistently. Protect the seed phrase, verify what you sign, and the most powerful property of crypto — money nobody can take from you — is yours for good.$$,'calloutTone','info')
  );

  ---------------------------------------------------------------------------
  -- 7. Questions
  ---------------------------------------------------------------------------

  -- ks-1 questions
  insert into lesson.questions (id, lesson_version_id, question_order, question_type, prompt, correct_answer, metadata) values
    ('ks-1-q1', v_ks1_version_id, 1, 'mcq', $$When your crypto sits on an exchange, who holds the private keys?$$, $$The exchange — your balance is an IOU in their database$$, '{}'::jsonb),
    ('ks-1-q2', v_ks1_version_id, 2, 'mcq', $$What is self-custody?$$, $$Holding your own private keys so only you control your funds$$, '{}'::jsonb),
    ('ks-1-q3', v_ks1_version_id, 3, 'short_text', $$Finish the famous crypto saying: "Not your keys, not your ___." (one word)$$, $$coins$$, '{}'::jsonb),

  -- ks-2 questions
    ('ks-2-q1', v_ks2_version_id, 1, 'mcq', $$Which key is safe to share so people can send you crypto?$$, $$Your public key — it works like your address$$, '{}'::jsonb),
    ('ks-2-q2', v_ks2_version_id, 2, 'mcq', $$What does your private key actually do?$$, $$It signs transactions to prove you approved them$$, '{}'::jsonb),
    ('ks-2-q3', v_ks2_version_id, 3, 'short_text', $$Which key must stay secret? Answer with one word: public or private.$$, $$private$$, '{}'::jsonb),

  -- ks-3 questions
    ('ks-3-q1', v_ks3_version_id, 1, 'mcq', $$What is a seed phrase?$$, $$A list of 12 or 24 words that can rebuild your whole wallet$$, '{}'::jsonb),
    ('ks-3-q2', v_ks3_version_id, 2, 'mcq', $$Which of these is a safe place for your seed phrase?$$, $$Written on paper, stored somewhere safe and private$$, '{}'::jsonb),
    ('ks-3-q3', v_ks3_version_id, 3, 'short_text', $$How many words are in the most common seed phrase? (answer with just the number)$$, $$12$$, '{}'::jsonb),

  -- ks-4 questions
    ('ks-4-q1', v_ks4_version_id, 1, 'mcq', $$Why is a hardware wallet safer than a wallet app on your phone?$$, $$The private key never leaves the device — it signs transactions offline$$, '{}'::jsonb),
    ('ks-4-q2', v_ks4_version_id, 2, 'mcq', $$Your hardware wallet breaks. What happens to your crypto?$$, $$Nothing — you restore it from your seed phrase on a new device$$, '{}'::jsonb),
    ('ks-4-q3', v_ks4_version_id, 3, 'short_text', $$What do you use to restore your wallet if your hardware wallet is lost or broken? (two words)$$, $$seed phrase$$, '{}'::jsonb),

  -- ks-5 questions
    ('ks-5-q1', v_ks5_version_id, 1, 'mcq', $$"Support" DMs you first, offering to fix your wallet if you "verify" your seed phrase. What is this?$$, $$A scam — real support never DMs first or asks for your seed phrase$$, '{}'::jsonb),
    ('ks-5-q2', v_ks5_version_id, 2, 'mcq', $$A site promises to double any SOL you send it. What should you do?$$, $$Nothing — "double your crypto" giveaways are always scams$$, '{}'::jsonb),
    ('ks-5-q3', v_ks5_version_id, 3, 'short_text', $$A fake website that imitates a real one to steal your keys or passwords is called a ___ site. (one word)$$, $$phishing$$, '{}'::jsonb),

  -- ks-6 questions
    ('ks-6-q1', v_ks6_version_id, 1, 'mcq', $$Who should you share your seed phrase with?$$, $$Nobody — not support, not friends, not anyone$$, '{}'::jsonb),
    ('ks-6-q2', v_ks6_version_id, 2, 'mcq', $$You accidentally typed your seed phrase into a website. What now?$$, $$Create a brand-new wallet and move your funds to it immediately$$, '{}'::jsonb),
    ('ks-6-q3', v_ks6_version_id, 3, 'short_text', $$Fill in the golden rule: "___ share your seed phrase." (one word)$$, $$never$$, '{}'::jsonb);

  ---------------------------------------------------------------------------
  -- 8. Question options (MCQ only)
  ---------------------------------------------------------------------------
  insert into lesson.question_options (question_id, option_order, option_text) values
    -- ks-1-q1
    ('ks-1-q1', 1, 'You — the exchange app just displays it'),
    ('ks-1-q1', 2, 'The exchange — your balance is an IOU in their database'),
    ('ks-1-q1', 3, 'Nobody — exchange crypto has no keys'),
    -- ks-1-q2
    ('ks-1-q2', 1, 'Keeping your crypto on a trusted exchange'),
    ('ks-1-q2', 2, 'Holding your own private keys so only you control your funds'),
    ('ks-1-q2', 3, 'Storing your crypto in a bank vault'),

    -- ks-2-q1
    ('ks-2-q1', 1, 'Your private key — sharing it builds trust'),
    ('ks-2-q1', 2, 'Your public key — it works like your address'),
    ('ks-2-q1', 3, 'Your seed phrase — but only the first six words'),
    -- ks-2-q2
    ('ks-2-q2', 1, 'It hides your balance from strangers'),
    ('ks-2-q2', 2, 'It signs transactions to prove you approved them'),
    ('ks-2-q2', 3, 'It makes your transactions confirm faster'),

    -- ks-3-q1
    ('ks-3-q1', 1, 'Your wallet app''s login password'),
    ('ks-3-q1', 2, 'A list of 12 or 24 words that can rebuild your whole wallet'),
    ('ks-3-q1', 3, 'A code the exchange emails you for support'),
    -- ks-3-q2
    ('ks-3-q2', 1, 'A screenshot in your photos app'),
    ('ks-3-q2', 2, 'Written on paper, stored somewhere safe and private'),
    ('ks-3-q2', 3, 'A note in your email drafts'),

    -- ks-4-q1
    ('ks-4-q1', 1, 'It stores your crypto inside the device itself'),
    ('ks-4-q1', 2, 'The private key never leaves the device — it signs transactions offline'),
    ('ks-4-q1', 3, 'It has a longer password than a phone app'),
    -- ks-4-q2
    ('ks-4-q2', 1, 'It''s gone — the crypto was inside the device'),
    ('ks-4-q2', 2, 'Nothing — you restore it from your seed phrase on a new device'),
    ('ks-4-q2', 3, 'The manufacturer refunds your balance'),

    -- ks-5-q1
    ('ks-5-q1', 1, 'A standard security procedure — cooperate quickly'),
    ('ks-5-q1', 2, 'Safe, as long as their profile picture looks official'),
    ('ks-5-q1', 3, 'A scam — real support never DMs first or asks for your seed phrase'),
    -- ks-5-q2
    ('ks-5-q2', 1, 'Send a small test amount first to check it works'),
    ('ks-5-q2', 2, 'Nothing — "double your crypto" giveaways are always scams'),
    ('ks-5-q2', 3, 'Send quickly before the offer expires'),

    -- ks-6-q1
    ('ks-6-q1', 1, 'Only official support staff'),
    ('ks-6-q1', 2, 'A trusted family member, by email'),
    ('ks-6-q1', 3, 'Nobody — not support, not friends, not anyone'),
    -- ks-6-q2
    ('ks-6-q2', 1, 'Change the website''s password and move on'),
    ('ks-6-q2', 2, 'Create a brand-new wallet and move your funds to it immediately'),
    ('ks-6-q2', 3, 'Wait and see if anything bad happens');

  ---------------------------------------------------------------------------
  -- 9. Source attributions
  ---------------------------------------------------------------------------
  insert into lesson.source_attributions (lesson_version_id, source_url, source_repo, source_ref, source_license, citation_note) values
    (v_ks1_version_id, 'https://solana.com/learn/what-is-a-wallet', 'solana-labs/solana', 'docs', 'Apache-2.0', 'Custody and wallet concepts adapted for beginner Course 3.'),
    (v_ks2_version_id, 'https://solana.com/docs/core/accounts', 'solana-labs/solana', 'docs/core/accounts', 'Apache-2.0', 'Keypair and signing concepts adapted for beginner Course 3.'),
    (v_ks3_version_id, 'https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki', 'bitcoin/bips', 'bip-0039', 'BSD-2-Clause', 'Mnemonic seed phrase standard adapted for beginner Course 3.'),
    (v_ks4_version_id, 'https://www.ledger.com/academy', 'ledger', 'academy', 'unknown', 'Hardware wallet concepts adapted for beginner Course 3.'),
    (v_ks5_version_id, 'https://solana.com/docs/security', 'solana-labs/solana', 'docs/security', 'Apache-2.0', 'Scam and phishing patterns adapted for beginner Course 3.'),
    (v_ks6_version_id, 'https://phantom.app/learn', 'phantom', 'learn', 'unknown', 'Wallet safety best practices adapted for beginner Course 3.');

  ---------------------------------------------------------------------------
  -- 10. Published payloads (sanitized — no correctAnswer)
  ---------------------------------------------------------------------------

  -- ks-1 payload
  v_ks1_payload := jsonb_build_object(
    'id','ks-1','courseId','keys-and-seed-phrases','moduleId','keys-seed-phrases-module-core','title','Your Keys or Their Keys — Where Crypto Really Lives','order',1,'version',1,'releaseId',v_release_id::text,
    'blocks', jsonb_build_array(
      jsonb_build_object('id','ks-1-block-1','type','paragraph','order',1,'text',$$Two Ways to Hold Crypto

There are exactly two ways to hold crypto, and the difference matters more than anything else you'll learn in this course.

Way one: an exchange account. You sign up on an app like Coinbase or Binance, buy some crypto, and see a balance on your screen. Feels like yours, right? Here's the catch — the exchange holds the keys. What you actually have is an entry in their database. An IOU. A promise that they'll give you your crypto when you ask.

Way two: your own wallet. You hold the private keys yourself. No company sits between you and your money. The blockchain answers to your keys, and only your keys.$$),
      jsonb_build_object('id','ks-1-block-2','type','paragraph','order',2,'text',$$What Can Go Wrong With "Way One"

Exchanges are convenient — but that convenience has a price:

They can freeze withdrawals. When markets panic, exchanges have paused withdrawals exactly when people wanted their money most.

They can get hacked. Exchanges are giant honeypots. Billions of dollars have been stolen from exchange wallets over the years.

They can collapse. In 2022, FTX — one of the biggest exchanges in the world — went bankrupt almost overnight. Millions of customers discovered their "balances" were IOUs from a company that had quietly spent their deposits. Many never got their money back.

They make the rules. Account reviews, region bans, identity re-checks — your access depends on their policies, not on you.$$),
      jsonb_build_object('id','ks-1-block-3','type','callout','order',3,'text',$$The Saying That Sums It Up: "Not your keys, not your coins." If someone else holds the private keys, they hold the crypto — whatever your app balance says. This one sentence has saved more people from losing money than any security tool ever built.$$,'calloutTone','info'),
      jsonb_build_object('id','ks-1-block-4','type','paragraph','order',4,'text',$$The Trade — Control for Responsibility

Self-custody flips the deal. You get full control: nobody can freeze, seize, or "review" your funds. But you also take full responsibility: there is no "forgot password" button, no support line that can restore a lost key.

That responsibility sounds scary, but it's smaller than it seems. It boils down to protecting one thing — your keys. The rest of this course teaches you exactly how: what the keys are, how the seed phrase backs them up, and how to keep both away from thieves.$$)
    ),
    'questions', jsonb_build_array(
      jsonb_build_object('id','ks-1-q1','type','mcq','prompt',$$When your crypto sits on an exchange, who holds the private keys?$$,'options',jsonb_build_array(
        jsonb_build_object('id','ks-1-q1-opt-1','text','You — the exchange app just displays it'),
        jsonb_build_object('id','ks-1-q1-opt-2','text','The exchange — your balance is an IOU in their database'),
        jsonb_build_object('id','ks-1-q1-opt-3','text','Nobody — exchange crypto has no keys')
      )),
      jsonb_build_object('id','ks-1-q2','type','mcq','prompt',$$What is self-custody?$$,'options',jsonb_build_array(
        jsonb_build_object('id','ks-1-q2-opt-1','text','Keeping your crypto on a trusted exchange'),
        jsonb_build_object('id','ks-1-q2-opt-2','text','Holding your own private keys so only you control your funds'),
        jsonb_build_object('id','ks-1-q2-opt-3','text','Storing your crypto in a bank vault')
      )),
      jsonb_build_object('id','ks-1-q3','type','short_text','prompt',$$Finish the famous crypto saying: "Not your keys, not your ___." (one word)$$)
    )
  );

  -- ks-2 payload
  v_ks2_payload := jsonb_build_object(
    'id','ks-2','courseId','keys-and-seed-phrases','moduleId','keys-seed-phrases-module-core','title','Public & Private Keys — The Lock and the Key','order',2,'version',1,'releaseId',v_release_id::text,
    'blocks', jsonb_build_array(
      jsonb_build_object('id','ks-2-block-1','type','paragraph','order',1,'text',$$Every Wallet Is a Pair of Keys

A crypto wallet isn't a bag of coins — it's a pair of mathematically linked keys.

Your public key is your address. Think of it like the slot on a mailbox: anyone can drop mail in if they know where it is. You can share it freely — post it, print it, text it. People need it to send you crypto. On Solana it looks like a long string of letters and numbers, something like 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU.

Your private key is the key that opens the box. It's a secret number that proves you own everything at that address. Whoever knows it controls the funds. Full stop.$$),
      jsonb_build_object('id','ks-2-block-2','type','paragraph','order',2,'text',$$What "Signing" Actually Means

When you send crypto, your wallet doesn't upload your private key anywhere. Instead, it uses the private key to create a digital signature — a piece of math that proves "the owner of this address approved this exact transaction."

Anyone on the network can check the signature against your public key and confirm it's genuine — without ever seeing the private key itself. That's the magic trick that makes the whole system work: you can prove you approved something without revealing your secret.$$),
      jsonb_build_object('id','ks-2-block-3','type','callout','order',3,'text',$$The Hard Truth: To the blockchain, your private key IS you. There's no ID check, no face scan, no second chance. If a thief gets your private key, the network will obey them exactly as it obeys you — and no one can reverse what they do. That's why every security rule in crypto is really one rule: keep the private key secret.$$,'calloutTone','info')
    ),
    'questions', jsonb_build_array(
      jsonb_build_object('id','ks-2-q1','type','mcq','prompt',$$Which key is safe to share so people can send you crypto?$$,'options',jsonb_build_array(
        jsonb_build_object('id','ks-2-q1-opt-1','text','Your private key — sharing it builds trust'),
        jsonb_build_object('id','ks-2-q1-opt-2','text','Your public key — it works like your address'),
        jsonb_build_object('id','ks-2-q1-opt-3','text','Your seed phrase — but only the first six words')
      )),
      jsonb_build_object('id','ks-2-q2','type','mcq','prompt',$$What does your private key actually do?$$,'options',jsonb_build_array(
        jsonb_build_object('id','ks-2-q2-opt-1','text','It hides your balance from strangers'),
        jsonb_build_object('id','ks-2-q2-opt-2','text','It signs transactions to prove you approved them'),
        jsonb_build_object('id','ks-2-q2-opt-3','text','It makes your transactions confirm faster')
      )),
      jsonb_build_object('id','ks-2-q3','type','short_text','prompt',$$Which key must stay secret? Answer with one word: public or private.$$)
    )
  );

  -- ks-3 payload
  v_ks3_payload := jsonb_build_object(
    'id','ks-3','courseId','keys-and-seed-phrases','moduleId','keys-seed-phrases-module-core','title','The 12-Word Seed Phrase — Your Master Backup','order',3,'version',1,'releaseId',v_release_id::text,
    'blocks', jsonb_build_array(
      jsonb_build_object('id','ks-3-block-1','type','paragraph','order',1,'text',$$Twelve Ordinary Words

A private key is a huge, unreadable number — hopeless to write down without mistakes. So wallets give you something friendlier: a seed phrase (also called a recovery phrase) — usually 12 simple words, sometimes 24, in a specific order. Something like: canyon robot velvet lunch...

Those words ARE your private key, encoded in a form humans can copy correctly. Your wallet app generates the phrase once, when you first set it up, and every account and key in your wallet can be rebuilt from it.$$),
      jsonb_build_object('id','ks-3-block-2','type','paragraph','order',2,'text',$$Why It's Called a Master Backup

Lose your phone? Delete the app? Spill coffee on your laptop? None of it matters. Install any compatible wallet on any device, type in your 12 words, and everything comes back — your address, your balance, your history. The funds were on the blockchain all along; the seed phrase just rebuilds the key that controls them.

The flip side is just as absolute: anyone who reads your seed phrase can rebuild your wallet on THEIR device and empty it in minutes. The phrase doesn't ask who's typing.$$),
      jsonb_build_object('id','ks-3-block-3','type','paragraph','order',3,'text',$$Storage Rules (Non-Negotiable)

Write it on paper, by hand. The moment a seed phrase touches anything digital, it can be stolen by malware — so no screenshots, no photos, no cloud notes, no password managers' free-text fields, no email drafts.

Keep it somewhere safe and private. A drawer only you use, a home safe, a safety deposit box.

Consider two copies in two places. One fire or flood shouldn't be able to destroy your only backup.

Copy it exactly. The word ORDER matters — word 3 swapped with word 7 is a different wallet entirely. Double-check every word when you write it down.$$),
      jsonb_build_object('id','ks-3-block-4','type','callout','order',4,'text',$$Good to Know: Seed phrases use a standard list of 2,048 English words shared across the industry. That's why a phrase written today can restore your wallet in a different app, years from now. The standard is the backup — not the app that generated it.$$,'calloutTone','info')
    ),
    'questions', jsonb_build_array(
      jsonb_build_object('id','ks-3-q1','type','mcq','prompt',$$What is a seed phrase?$$,'options',jsonb_build_array(
        jsonb_build_object('id','ks-3-q1-opt-1','text','Your wallet app''s login password'),
        jsonb_build_object('id','ks-3-q1-opt-2','text','A list of 12 or 24 words that can rebuild your whole wallet'),
        jsonb_build_object('id','ks-3-q1-opt-3','text','A code the exchange emails you for support')
      )),
      jsonb_build_object('id','ks-3-q2','type','mcq','prompt',$$Which of these is a safe place for your seed phrase?$$,'options',jsonb_build_array(
        jsonb_build_object('id','ks-3-q2-opt-1','text','A screenshot in your photos app'),
        jsonb_build_object('id','ks-3-q2-opt-2','text','Written on paper, stored somewhere safe and private'),
        jsonb_build_object('id','ks-3-q2-opt-3','text','A note in your email drafts')
      )),
      jsonb_build_object('id','ks-3-q3','type','short_text','prompt',$$How many words are in the most common seed phrase? (answer with just the number)$$)
    )
  );

  -- ks-4 payload
  v_ks4_payload := jsonb_build_object(
    'id','ks-4','courseId','keys-and-seed-phrases','moduleId','keys-seed-phrases-module-core','title','Hardware Wallets — Cold Storage for Serious Savings','order',4,'version',1,'releaseId',v_release_id::text,
    'blocks', jsonb_build_array(
      jsonb_build_object('id','ks-4-block-1','type','paragraph','order',1,'text',$$Hot vs. Cold

Wallets come in two temperatures:

A hot wallet keeps your private key on a device that's connected to the internet — a phone app or a browser extension like Phantom. Convenient for daily use, but the key lives next to your browser tabs, downloads, and whatever malware sneaks in with them.

A cold wallet keeps the private key on a device that never touches the internet. The most popular kind is a hardware wallet — a small gadget, about the size of a USB stick, made by companies like Ledger and Trezor.$$),
      jsonb_build_object('id','ks-4-block-2','type','paragraph','order',2,'text',$$How a Hardware Wallet Works

The private key is generated inside the device and never leaves it. Ever.

When you want to send a transaction, your computer passes the unsigned transaction to the device. The device shows you the details on its own little screen, you press a physical button to approve, and only the finished signature comes back out.

Even if your computer is riddled with viruses, the malware sees the signature — never the key. That's the whole trick, and it's why hardware wallets are the standard for storing serious amounts.$$),
      jsonb_build_object('id','ks-4-block-3','type','paragraph','order',3,'text',$$"But What If I Lose the Gadget?"

Nothing happens to your crypto. Your funds live on the blockchain, not inside the device. When you set up a hardware wallet, it gives you — you guessed it — a seed phrase. Lose the device, buy a new one (or use any compatible wallet), restore from the seed phrase, and you're back.

A thief who finds your device still needs its PIN code, and most devices wipe themselves after a few wrong guesses. Your seed phrase, stored safely at home on paper, remains the real backup.$$),
      jsonb_build_object('id','ks-4-block-4','type','callout','order',4,'text',$$A Sensible Setup: Think of a hot wallet like the cash in your pocket and a hardware wallet like the safe at home. Keep small, everyday amounts hot — and move savings you'd hate to lose into cold storage. You don't need one on day one, but know they exist for the day your balance starts to matter.$$,'calloutTone','info')
    ),
    'questions', jsonb_build_array(
      jsonb_build_object('id','ks-4-q1','type','mcq','prompt',$$Why is a hardware wallet safer than a wallet app on your phone?$$,'options',jsonb_build_array(
        jsonb_build_object('id','ks-4-q1-opt-1','text','It stores your crypto inside the device itself'),
        jsonb_build_object('id','ks-4-q1-opt-2','text','The private key never leaves the device — it signs transactions offline'),
        jsonb_build_object('id','ks-4-q1-opt-3','text','It has a longer password than a phone app')
      )),
      jsonb_build_object('id','ks-4-q2','type','mcq','prompt',$$Your hardware wallet breaks. What happens to your crypto?$$,'options',jsonb_build_array(
        jsonb_build_object('id','ks-4-q2-opt-1','text','It''s gone — the crypto was inside the device'),
        jsonb_build_object('id','ks-4-q2-opt-2','text','Nothing — you restore it from your seed phrase on a new device'),
        jsonb_build_object('id','ks-4-q2-opt-3','text','The manufacturer refunds your balance')
      )),
      jsonb_build_object('id','ks-4-q3','type','short_text','prompt',$$What do you use to restore your wallet if your hardware wallet is lost or broken? (two words)$$)
    )
  );

  -- ks-5 payload
  v_ks5_payload := jsonb_build_object(
    'id','ks-5','courseId','keys-and-seed-phrases','moduleId','keys-seed-phrases-module-core','title','Scams & Phishing — Know the Tricks','order',5,'version',1,'releaseId',v_release_id::text,
    'blocks', jsonb_build_array(
      jsonb_build_object('id','ks-5-block-1','type','paragraph','order',1,'text',$$Why Scammers Target People, Not Blockchains

Breaking the cryptography behind your keys is practically impossible. So thieves don't attack the math — they attack you. Every major crypto theft from an individual comes down to one thing: the victim was tricked into handing over their keys or approving something they shouldn't have.

And because blockchain transactions can't be reversed, there's no fraud department to call afterwards. Prevention is the whole game.$$),
      jsonb_build_object('id','ks-5-block-2','type','paragraph','order',2,'text',$$The Four Classic Tricks

1. Fake support. Someone DMs you first — on Discord, Telegram, X — claiming to be "support" and offering to fix a problem if you "verify" or "validate" your seed phrase. Real support never DMs first, and no legitimate service ever needs your seed phrase.

2. Phishing sites. A lookalike website with a nearly identical URL — phanton.app instead of phantom.app — asks you to "import your wallet" by typing your seed phrase. The page then sends your words straight to the thief.

3. Giveaway scams. "Send 1 SOL, get 2 back!" — often dressed up with a celebrity's face or a hacked verified account. Nobody is doubling your money. Nobody.

4. Malicious approvals. A shady site asks your wallet to sign something vague. That signature can hand a drainer contract permission to empty your tokens. If you don't understand what you're signing, don't sign it.$$),
      jsonb_build_object('id','ks-5-block-3','type','paragraph','order',3,'text',$$Red Flags You Can Spot in Seconds

Urgency — "act now or lose your funds." Panic is the scammer's best tool.

They contacted you first. Real teams announce; scammers DM.

Too good to be true. Guaranteed returns, free money, secret airdrops.

Any request for your seed phrase — anywhere, ever, for any reason.

Slightly-off URLs. Bookmark the real sites you use and only enter through your bookmarks.$$),
      jsonb_build_object('id','ks-5-block-4','type','callout','order',4,'text',$$One Rule Beats All: Legitimate apps, wallets, and support teams NEVER need your seed phrase — not to verify, not to sync, not to fix a bug, not to send you a refund. The only people on Earth who ask for it are trying to rob you. Memorize that, and 90% of crypto scams simply stop working on you.$$,'calloutTone','info')
    ),
    'questions', jsonb_build_array(
      jsonb_build_object('id','ks-5-q1','type','mcq','prompt',$$"Support" DMs you first, offering to fix your wallet if you "verify" your seed phrase. What is this?$$,'options',jsonb_build_array(
        jsonb_build_object('id','ks-5-q1-opt-1','text','A standard security procedure — cooperate quickly'),
        jsonb_build_object('id','ks-5-q1-opt-2','text','Safe, as long as their profile picture looks official'),
        jsonb_build_object('id','ks-5-q1-opt-3','text','A scam — real support never DMs first or asks for your seed phrase')
      )),
      jsonb_build_object('id','ks-5-q2','type','mcq','prompt',$$A site promises to double any SOL you send it. What should you do?$$,'options',jsonb_build_array(
        jsonb_build_object('id','ks-5-q2-opt-1','text','Send a small test amount first to check it works'),
        jsonb_build_object('id','ks-5-q2-opt-2','text','Nothing — "double your crypto" giveaways are always scams'),
        jsonb_build_object('id','ks-5-q2-opt-3','text','Send quickly before the offer expires')
      )),
      jsonb_build_object('id','ks-5-q3','type','short_text','prompt',$$A fake website that imitates a real one to steal your keys or passwords is called a ___ site. (one word)$$)
    )
  );

  -- ks-6 payload
  v_ks6_payload := jsonb_build_object(
    'id','ks-6','courseId','keys-and-seed-phrases','moduleId','keys-seed-phrases-module-core','title','The Golden Rules — Protect Yourself Forever','order',6,'version',1,'releaseId',v_release_id::text,
    'blocks', jsonb_build_array(
      jsonb_build_object('id','ks-6-block-1','type','paragraph','order',1,'text',$$Five Habits, Lifetime of Safety

Everything in this course compresses into five habits:

1. Never share your seed phrase. Not with support, not with friends, not with anyone. Never type it into a website.

2. Keep the phrase on paper, offline. No photos, no cloud, no notes app.

3. Bookmark the real sites. Enter Phantom, LockedIn, or any dApp through your own bookmarks — never through DM links or search ads.

4. Read before you sign. Every wallet pop-up is a decision. If you can't tell what it does, close it.

5. Start small. Trying a new app or sending to a new address? Test with a tiny amount first.$$),
      jsonb_build_object('id','ks-6-block-2','type','paragraph','order',2,'text',$$If Your Seed Phrase Ever Leaks

Maybe you typed it into a site that felt wrong, or found a photo of it in your cloud storage. Treat the wallet as burned — even if nothing has been stolen yet.

Create a brand-new wallet with a brand-new seed phrase, and move your funds to it immediately. Then stop using the old one forever. There is no way to "change the password" on a compromised seed phrase — the only fix is a new wallet.

Speed matters: drainer bots watch leaked phrases and can empty a wallet within minutes.$$),
      jsonb_build_object('id','ks-6-block-3','type','callout','order',3,'text',$$You're Ready: Self-custody isn't about paranoia — it's about a few boring habits done consistently. Protect the seed phrase, verify what you sign, and the most powerful property of crypto — money nobody can take from you — is yours for good.$$,'calloutTone','info')
    ),
    'questions', jsonb_build_array(
      jsonb_build_object('id','ks-6-q1','type','mcq','prompt',$$Who should you share your seed phrase with?$$,'options',jsonb_build_array(
        jsonb_build_object('id','ks-6-q1-opt-1','text','Only official support staff'),
        jsonb_build_object('id','ks-6-q1-opt-2','text','A trusted family member, by email'),
        jsonb_build_object('id','ks-6-q1-opt-3','text','Nobody — not support, not friends, not anyone')
      )),
      jsonb_build_object('id','ks-6-q2','type','mcq','prompt',$$You accidentally typed your seed phrase into a website. What now?$$,'options',jsonb_build_array(
        jsonb_build_object('id','ks-6-q2-opt-1','text','Change the website''s password and move on'),
        jsonb_build_object('id','ks-6-q2-opt-2','text','Create a brand-new wallet and move your funds to it immediately'),
        jsonb_build_object('id','ks-6-q2-opt-3','text','Wait and see if anything bad happens')
      )),
      jsonb_build_object('id','ks-6-q3','type','short_text','prompt',$$Fill in the golden rule: "___ share your seed phrase." (one word)$$)
    )
  );

  ---------------------------------------------------------------------------
  -- 11. Published module
  ---------------------------------------------------------------------------
  insert into lesson.published_modules (release_id, course_id, module_id, module_order, payload) values
  (
    v_release_id,
    'keys-and-seed-phrases',
    'keys-seed-phrases-module-core',
    1,
    jsonb_build_object(
      'id', 'keys-seed-phrases-module-core',
      'courseId', 'keys-and-seed-phrases',
      'slug', 'keys-seed-phrases-core',
      'title', 'Keys & Seed Phrases Core',
      'description', 'Core module for Course 3: Keys & Seed Phrases — Own Your Crypto.',
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
    (v_release_id, 'ks-1', 'keys-seed-phrases-module-core', v_ks1_version_id, 1, v_ks1_payload),
    (v_release_id, 'ks-2', 'keys-seed-phrases-module-core', v_ks2_version_id, 2, v_ks2_payload),
    (v_release_id, 'ks-3', 'keys-seed-phrases-module-core', v_ks3_version_id, 3, v_ks3_payload),
    (v_release_id, 'ks-4', 'keys-seed-phrases-module-core', v_ks4_version_id, 4, v_ks4_payload),
    (v_release_id, 'ks-5', 'keys-seed-phrases-module-core', v_ks5_version_id, 5, v_ks5_payload),
    (v_release_id, 'ks-6', 'keys-seed-phrases-module-core', v_ks6_version_id, 6, v_ks6_payload);

  ---------------------------------------------------------------------------
  -- 13. Published lesson payloads (with content_hash)
  ---------------------------------------------------------------------------
  insert into lesson.published_lesson_payloads (release_id, lesson_id, payload, content_hash) values
    (v_release_id, 'ks-1', v_ks1_payload, md5(v_ks1_payload::text)),
    (v_release_id, 'ks-2', v_ks2_payload, md5(v_ks2_payload::text)),
    (v_release_id, 'ks-3', v_ks3_payload, md5(v_ks3_payload::text)),
    (v_release_id, 'ks-4', v_ks4_payload, md5(v_ks4_payload::text)),
    (v_release_id, 'ks-5', v_ks5_payload, md5(v_ks5_payload::text)),
    (v_release_id, 'ks-6', v_ks6_payload, md5(v_ks6_payload::text));

  raise notice 'Course 3 Keys & Seed Phrases release complete. Release ID: %', v_release_id;
end;
$seed$;
