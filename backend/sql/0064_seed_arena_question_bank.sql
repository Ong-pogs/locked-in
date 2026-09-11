-- 0064: seed the Arena question bank.
--
-- Spec: docs/superpowers/specs/2026-09-11-arena-1v1-design.md
--
-- WHY A SEPARATE BANK RATHER THAN REUSING LESSON QUESTIONS
--
--   1. The lesson submit path returns correctAnswer to the client
--      (progress/repository.mjs:1390) and again on /check (:4622). Anyone who
--      has completed a lesson has already been handed its key, so reusing
--      those questions would hand early-finishers a permanent edge.
--   2. The open queue pairs arbitrary players. Drawing from lesson content
--      would serve material from courses the opponent has not unlocked —
--      giving away content someone else locked USDC to reach.
--
-- Arena questions are therefore authored for the arena and never shown in a
-- lesson. They are MCQ-only with exactly 3 options: short-text would route
-- through the LLM grader, which is far too slow and non-deterministic to sit
-- inside a 20-second timed race.
--
-- The correct option is deliberately spread across a/b/c. A bank where the key
-- is always 'a' is guessable, and would also let a broken grader pass its own
-- tests.
--
-- Guards below FAIL the migration (they do not warn) if any question lacks
-- exactly 3 options, if any correctOptionId is not one of that question's own
-- option ids, or if option ids within a question are not unique. That is the
-- 0057 repair bug — a graded key drifting from its own options — made
-- impossible rather than proofread.
--
-- Idempotent: early-returns if the bank is already seeded.

create extension if not exists pgcrypto;

do $seed$
declare
  v_spec  jsonb;
  v_bad   text;
  v_count integer;
begin
  if exists (select 1 from arena.questions where id like 'aq-%') then
    raise notice 'Seed skipped: arena question bank already present.';
    return;
  end if;

  v_spec := $json$
[
{"id":"aq-wal-01","topic":"wallets","difficulty":"easy","prompt":"What does a Solana wallet actually store?","options":[{"id":"a","text":"Your coins, held inside the app"},{"id":"b","text":"Your keys — the coins live on the chain"},{"id":"c","text":"A copy of the whole blockchain"}],"correctOptionId":"b"},
{"id":"aq-wal-02","topic":"wallets","difficulty":"easy","prompt":"What is a public key used for?","options":[{"id":"a","text":"Receiving funds — it is safe to share"},{"id":"b","text":"Signing transactions, so keep it secret"},{"id":"c","text":"Logging into an exchange"}],"correctOptionId":"a"},
{"id":"aq-wal-03","topic":"wallets","difficulty":"easy","prompt":"Someone asks for your seed phrase to 'verify' your wallet. What is happening?","options":[{"id":"a","text":"A routine security check"},{"id":"b","text":"A wallet upgrade"},{"id":"c","text":"A scam — nobody legitimate ever needs it"}],"correctOptionId":"c"},
{"id":"aq-wal-04","topic":"wallets","difficulty":"medium","prompt":"What happens if you lose your seed phrase and your device?","options":[{"id":"a","text":"Support can restore it from their backup"},{"id":"b","text":"The funds are gone — nobody can recover them"},{"id":"c","text":"The network re-issues your keys after 30 days"}],"correctOptionId":"b"},
{"id":"aq-wal-05","topic":"wallets","difficulty":"medium","prompt":"What is a hardware wallet's main advantage?","options":[{"id":"a","text":"It makes transactions cheaper"},{"id":"b","text":"It stores coins offline where the chain cannot reach them"},{"id":"c","text":"The private key never leaves the device, even when signing"}],"correctOptionId":"c"},
{"id":"aq-wal-06","topic":"wallets","difficulty":"easy","prompt":"Can two people have the same Solana address by accident?","options":[{"id":"a","text":"No — the keyspace is far too large for a collision"},{"id":"b","text":"Yes, addresses are reused once accounts close"},{"id":"c","text":"Only if they use the same wallet app"}],"correctOptionId":"a"},
{"id":"aq-wal-07","topic":"wallets","difficulty":"medium","prompt":"What does 'self-custody' mean?","options":[{"id":"a","text":"A regulated company holds your funds for you"},{"id":"b","text":"You hold the keys, so you carry both the control and the risk"},{"id":"c","text":"Your funds are insured by the network"}],"correctOptionId":"b"},
{"id":"aq-wal-08","topic":"wallets","difficulty":"hard","prompt":"A site asks you to sign a message that is not a transaction. Is that always safe?","options":[{"id":"a","text":"Yes, signatures cannot move funds"},{"id":"b","text":"No — a signature can approve a transfer or delegate authority"},{"id":"c","text":"Only unsafe if the site is not HTTPS"}],"correctOptionId":"b"},
{"id":"aq-wal-09","topic":"wallets","difficulty":"easy","prompt":"Where should a seed phrase NOT be stored?","options":[{"id":"a","text":"Written on paper in a safe"},{"id":"b","text":"Split across two physical locations"},{"id":"c","text":"A screenshot in your cloud photo library"}],"correctOptionId":"c"},
{"id":"aq-wal-10","topic":"wallets","difficulty":"medium","prompt":"What is a burner wallet mainly used for?","options":[{"id":"a","text":"Interacting with untrusted apps without exposing your main funds"},{"id":"b","text":"Paying lower network fees"},{"id":"c","text":"Staking with higher rewards"}],"correctOptionId":"a"},
{"id":"aq-wal-11","topic":"wallets","difficulty":"hard","prompt":"You revoke a token approval. What does that actually change?","options":[{"id":"a","text":"It reverses past transfers made under that approval"},{"id":"b","text":"It removes a contract's ongoing permission to move that token"},{"id":"c","text":"It deletes the token from your wallet"}],"correctOptionId":"b"},
{"id":"aq-wal-12","topic":"wallets","difficulty":"easy","prompt":"What is the safest way to reach a wallet app's website?","options":[{"id":"a","text":"The top search result"},{"id":"b","text":"A link from a support DM"},{"id":"c","text":"A bookmark you saved yourself"}],"correctOptionId":"c"},
{"id":"aq-key-01","topic":"keys","difficulty":"easy","prompt":"How many words is a standard seed phrase?","options":[{"id":"a","text":"12 or 24"},{"id":"b","text":"Always exactly 8"},{"id":"c","text":"Between 30 and 40"}],"correctOptionId":"a"},
{"id":"aq-key-02","topic":"keys","difficulty":"medium","prompt":"What is the relationship between a seed phrase and your private keys?","options":[{"id":"a","text":"They are unrelated backups"},{"id":"b","text":"The seed deterministically derives every key in the wallet"},{"id":"c","text":"The seed is an encrypted copy of one key"}],"correctOptionId":"b"},
{"id":"aq-key-03","topic":"keys","difficulty":"medium","prompt":"Why does word ORDER matter in a seed phrase?","options":[{"id":"a","text":"It does not — any order works"},{"id":"b","text":"Only the first four words matter"},{"id":"c","text":"The order is part of the input that derives the keys"}],"correctOptionId":"c"},
{"id":"aq-key-04","topic":"keys","difficulty":"hard","prompt":"What does a passphrase (the '25th word') do?","options":[{"id":"a","text":"Derives an entirely separate set of wallets from the same seed"},{"id":"b","text":"Encrypts the seed phrase file"},{"id":"c","text":"Resets the wallet if entered three times"}],"correctOptionId":"a"},
{"id":"aq-key-05","topic":"keys","difficulty":"easy","prompt":"Can you change your seed phrase while keeping the same address?","options":[{"id":"a","text":"Yes, in wallet settings"},{"id":"b","text":"No — the address is derived from the seed"},{"id":"c","text":"Yes, once per year"}],"correctOptionId":"b"},
{"id":"aq-key-06","topic":"keys","difficulty":"medium","prompt":"Your seed phrase words come from a fixed list. Why?","options":[{"id":"a","text":"To make phrases shorter"},{"id":"b","text":"To let wallets detect typos and checksum the phrase"},{"id":"c","text":"To limit how many wallets can exist"}],"correctOptionId":"b"},
{"id":"aq-key-07","topic":"keys","difficulty":"hard","prompt":"What is the risk of typing your seed into a 'wallet checker' website?","options":[{"id":"a","text":"None, if the site uses HTTPS"},{"id":"b","text":"It may show stale balances"},{"id":"c","text":"The site now controls every key that seed derives"}],"correctOptionId":"c"},
{"id":"aq-key-08","topic":"keys","difficulty":"easy","prompt":"Who should ever see your seed phrase?","options":[{"id":"a","text":"Only you"},{"id":"b","text":"You and the wallet's support team"},{"id":"c","text":"You and any verified project admin"}],"correctOptionId":"a"},
{"id":"aq-key-09","topic":"keys","difficulty":"medium","prompt":"What does 'deterministic' mean for a seed phrase?","options":[{"id":"a","text":"It expires after a set time"},{"id":"b","text":"The same seed always regenerates the same keys"},{"id":"c","text":"It can only be used on one device"}],"correctOptionId":"b"},
{"id":"aq-key-10","topic":"keys","difficulty":"medium","prompt":"You restore your seed into a second wallet app. What happens to the first?","options":[{"id":"a","text":"It is wiped for security"},{"id":"b","text":"It stops working until you re-verify"},{"id":"c","text":"Nothing — both now control the same accounts"}],"correctOptionId":"c"},
{"id":"aq-key-11","topic":"keys","difficulty":"hard","prompt":"Why is splitting a seed phrase in half across two locations risky?","options":[{"id":"a","text":"Half a phrase dramatically narrows a brute-force search"},{"id":"b","text":"Wallets reject partially stored seeds"},{"id":"c","text":"It invalidates the checksum permanently"}],"correctOptionId":"a"},
{"id":"aq-key-12","topic":"keys","difficulty":"easy","prompt":"A popup says your wallet is 'compromised, migrate now'. What should you do?","options":[{"id":"a","text":"Follow it quickly before funds move"},{"id":"b","text":"Close it — urgency is the oldest trick in the book"},{"id":"c","text":"Enter the seed to check if it is affected"}],"correctOptionId":"b"},
{"id":"aq-exp-01","topic":"explorers","difficulty":"easy","prompt":"What is a block explorer?","options":[{"id":"a","text":"A wallet that browses NFTs"},{"id":"b","text":"A mining tool"},{"id":"c","text":"A website for reading the public chain"}],"correctOptionId":"c"},
{"id":"aq-exp-02","topic":"explorers","difficulty":"easy","prompt":"What is a transaction signature on Solana?","options":[{"id":"a","text":"The transaction's unique identifier"},{"id":"b","text":"The sender's password"},{"id":"c","text":"The validator's vote"}],"correctOptionId":"a"},
{"id":"aq-exp-03","topic":"explorers","difficulty":"medium","prompt":"A transaction shows as 'finalized'. What does that mean?","options":[{"id":"a","text":"It is queued for the next block"},{"id":"b","text":"It is settled and will not be rolled back"},{"id":"c","text":"It succeeded but has not been charged a fee"}],"correctOptionId":"b"},
{"id":"aq-exp-04","topic":"explorers","difficulty":"medium","prompt":"What does a failed transaction still cost you?","options":[{"id":"a","text":"Nothing at all"},{"id":"b","text":"The full amount you tried to send"},{"id":"c","text":"The network fee"}],"correctOptionId":"c"},
{"id":"aq-exp-05","topic":"explorers","difficulty":"easy","prompt":"Can anyone look up your wallet's transaction history?","options":[{"id":"a","text":"Yes — the chain is public"},{"id":"b","text":"Only with your permission"},{"id":"c","text":"Only law enforcement"}],"correctOptionId":"a"},
{"id":"aq-exp-06","topic":"explorers","difficulty":"medium","prompt":"What is an epoch on Solana?","options":[{"id":"a","text":"A single block"},{"id":"b","text":"A period of roughly 2-3 days that staking runs on"},{"id":"c","text":"The time to confirm one transaction"}],"correctOptionId":"b"},
{"id":"aq-exp-07","topic":"explorers","difficulty":"hard","prompt":"An explorer shows 'Token Accounts' under your address. What are they?","options":[{"id":"a","text":"Other wallets you have sent funds to"},{"id":"b","text":"Pending transactions"},{"id":"c","text":"Separate accounts each holding one SPL token balance"}],"correctOptionId":"c"},
{"id":"aq-exp-08","topic":"explorers","difficulty":"medium","prompt":"Why might the same transaction show different times on two explorers?","options":[{"id":"a","text":"One shows block time, the other shows when it indexed it"},{"id":"b","text":"Transactions have no timestamp"},{"id":"c","text":"Explorers randomise timestamps for privacy"}],"correctOptionId":"a"},
{"id":"aq-exp-09","topic":"explorers","difficulty":"easy","prompt":"What is a slot on Solana?","options":[{"id":"a","text":"A staking reward tier"},{"id":"b","text":"A time window in which a leader can produce a block"},{"id":"c","text":"A wallet storage unit"}],"correctOptionId":"b"},
{"id":"aq-exp-10","topic":"explorers","difficulty":"hard","prompt":"You see a token in your wallet you never bought. What is the likely explanation?","options":[{"id":"a","text":"An airdrop or a spam token someone sent to your ATA"},{"id":"b","text":"A bug in the chain"},{"id":"c","text":"Staking rewards paid in a random token"}],"correctOptionId":"a"},
{"id":"aq-exp-11","topic":"explorers","difficulty":"medium","prompt":"What does the fee payer field tell you?","options":[{"id":"a","text":"Which validator produced the block"},{"id":"b","text":"Which account paid the transaction's network fee"},{"id":"c","text":"The largest transfer in the transaction"}],"correctOptionId":"b"},
{"id":"aq-exp-12","topic":"explorers","difficulty":"easy","prompt":"Why are Solana fees usually a fraction of a cent?","options":[{"id":"a","text":"Fees are subsidised by the foundation"},{"id":"b","text":"Fees only apply to transfers over $100"},{"id":"c","text":"High throughput keeps the per-transaction cost low"}],"correctOptionId":"c"},
{"id":"aq-tok-01","topic":"tokens","difficulty":"easy","prompt":"What is an SPL token?","options":[{"id":"a","text":"Any token on Solana built on the shared token standard"},{"id":"b","text":"A token issued only by the Solana Foundation"},{"id":"c","text":"A special kind of NFT"}],"correctOptionId":"a"},
{"id":"aq-tok-02","topic":"tokens","difficulty":"medium","prompt":"Two tokens both display 'USDC'. How do you tell them apart?","options":[{"id":"a","text":"By which wallet shows them"},{"id":"b","text":"By the mint address"},{"id":"c","text":"By the icon"}],"correctOptionId":"b"},
{"id":"aq-tok-03","topic":"tokens","difficulty":"medium","prompt":"What does a token's mint account record?","options":[{"id":"a","text":"Every holder's balance"},{"id":"b","text":"The token's transaction history"},{"id":"c","text":"Supply, decimals, and who may mint more"}],"correctOptionId":"c"},
{"id":"aq-tok-04","topic":"tokens","difficulty":"medium","prompt":"What is an Associated Token Account (ATA)?","options":[{"id":"a","text":"The canonical account holding one wallet's balance of one token"},{"id":"b","text":"A shared account for all your tokens"},{"id":"c","text":"An exchange sub-account"}],"correctOptionId":"a"},
{"id":"aq-tok-05","topic":"tokens","difficulty":"easy","prompt":"Your main wallet address can hold which asset directly?","options":[{"id":"a","text":"Any SPL token"},{"id":"b","text":"SOL only"},{"id":"c","text":"Nothing — everything needs a sub-account"}],"correctOptionId":"b"},
{"id":"aq-tok-06","topic":"tokens","difficulty":"medium","prompt":"Technically, what is an NFT on Solana?","options":[{"id":"a","text":"An image stored on chain"},{"id":"b","text":"A validator-issued certificate"},{"id":"c","text":"A token whose mint has supply 1 and zero decimals"}],"correctOptionId":"c"},
{"id":"aq-tok-07","topic":"tokens","difficulty":"easy","prompt":"How much does it cost a scammer to create a token named after a real one?","options":[{"id":"a","text":"Pennies — anyone can mint any name"},{"id":"b","text":"Thousands of dollars in listing fees"},{"id":"c","text":"It is impossible; names are reserved"}],"correctOptionId":"a"},
{"id":"aq-tok-08","topic":"tokens","difficulty":"hard","prompt":"Why does receiving a brand-new token type cost a tiny amount of SOL?","options":[{"id":"a","text":"A transfer tax"},{"id":"b","text":"Rent-exemption for creating the token account"},{"id":"c","text":"A validator tip"}],"correctOptionId":"b"},
{"id":"aq-tok-09","topic":"tokens","difficulty":"medium","prompt":"What does 'fungible' mean?","options":[{"id":"a","text":"The token can be burned"},{"id":"b","text":"The token has a fixed supply"},{"id":"c","text":"Any unit is interchangeable with any other"}],"correctOptionId":"c"},
{"id":"aq-tok-10","topic":"tokens","difficulty":"medium","prompt":"An NFT's image usually lives where?","options":[{"id":"a","text":"Off chain, with the chain holding a pointer and the ownership record"},{"id":"b","text":"Entirely on chain, pixel by pixel"},{"id":"c","text":"In the owner's wallet app"}],"correctOptionId":"a"},
{"id":"aq-tok-11","topic":"tokens","difficulty":"hard","prompt":"What does a token's 'decimals' field control?","options":[{"id":"a","text":"How many can ever be minted"},{"id":"b","text":"How finely one token can be divided"},{"id":"c","text":"How many decimal places the price shows"}],"correctOptionId":"b"},
{"id":"aq-tok-12","topic":"tokens","difficulty":"easy","prompt":"You hold USDC, BONK and JitoSOL. How many token accounts is that?","options":[{"id":"a","text":"One, shared"},{"id":"b","text":"Zero — they live at the exchange"},{"id":"c","text":"Three, one per mint"}],"correctOptionId":"c"},
{"id":"aq-stk-01","topic":"staking","difficulty":"easy","prompt":"What are you doing when you stake SOL?","options":[{"id":"a","text":"Delegating it to a validator to help secure the network"},{"id":"b","text":"Lending it to a validator to trade with"},{"id":"c","text":"Donating it permanently"}],"correctOptionId":"a"},
{"id":"aq-stk-02","topic":"staking","difficulty":"medium","prompt":"Can a validator spend the SOL you delegated?","options":[{"id":"a","text":"Yes, that is what delegation means"},{"id":"b","text":"No — it stays in your own stake account"},{"id":"c","text":"Only with your PIN"}],"correctOptionId":"b"},
{"id":"aq-stk-03","topic":"staking","difficulty":"medium","prompt":"A validator charges 5% commission. What does it take?","options":[{"id":"a","text":"5% of your staked principal each year"},{"id":"b","text":"5% upfront to delegate"},{"id":"c","text":"5% of the rewards your stake earns"}],"correctOptionId":"c"},
{"id":"aq-stk-04","topic":"staking","difficulty":"easy","prompt":"When does newly delegated stake start earning?","options":[{"id":"a","text":"At the next epoch boundary"},{"id":"b","text":"Instantly"},{"id":"c","text":"After exactly 30 days"}],"correctOptionId":"a"},
{"id":"aq-stk-05","topic":"staking","difficulty":"hard","prompt":"Why should you avoid a validator running 100% commission?","options":[{"id":"a","text":"It will seize your principal"},{"id":"b","text":"You would earn no staking rewards at all"},{"id":"c","text":"It is against network rules"}],"correctOptionId":"b"},
{"id":"aq-stk-06","topic":"staking","difficulty":"medium","prompt":"What is a liquid staking token such as mSOL or JitoSOL?","options":[{"id":"a","text":"A governance token"},{"id":"b","text":"A validator's own coin"},{"id":"c","text":"A tradeable claim on SOL staked in a pool"}],"correctOptionId":"c"},
{"id":"aq-stk-07","topic":"staking","difficulty":"hard","prompt":"Why does a liquid staking token slowly redeem for more SOL?","options":[{"id":"a","text":"Rewards accrue to the pool, so each token's claim grows"},{"id":"b","text":"The pool mints extra SOL"},{"id":"c","text":"Validators tip holders"}],"correctOptionId":"a"},
{"id":"aq-stk-08","topic":"staking","difficulty":"medium","prompt":"What extra risk does liquid staking add over native staking?","options":[{"id":"a","text":"Your principal can be slashed to zero"},{"id":"b","text":"Smart-contract risk from the stake pool"},{"id":"c","text":"Validators can refuse to unstake you"}],"correctOptionId":"b"},
{"id":"aq-stk-09","topic":"staking","difficulty":"easy","prompt":"Where do staking rewards come from?","options":[{"id":"a","text":"The validator's own profits"},{"id":"b","text":"Other stakers' losses"},{"id":"c","text":"New issuance plus a share of transaction fees"}],"correctOptionId":"c"},
{"id":"aq-stk-10","topic":"staking","difficulty":"medium","prompt":"Why is delegating to smaller reliable validators considered healthy?","options":[{"id":"a","text":"It spreads voting power and decentralises the network"},{"id":"b","text":"Smaller validators always pay more"},{"id":"c","text":"It reduces your fees"}],"correctOptionId":"a"},
{"id":"aq-stk-11","topic":"staking","difficulty":"hard","prompt":"What happens to your rewards while a validator is offline a lot?","options":[{"id":"a","text":"They are paid later in full"},{"id":"b","text":"Everyone staked to it earns less"},{"id":"c","text":"Nothing changes"}],"correctOptionId":"b"},
{"id":"aq-stk-12","topic":"staking","difficulty":"easy","prompt":"How do you stop staking?","options":[{"id":"a","text":"You cannot until a year has passed"},{"id":"b","text":"Ask the validator to release you"},{"id":"c","text":"Deactivate; it returns after the epoch turns"}],"correctOptionId":"c"},
{"id":"aq-len-01","topic":"defi-lending","difficulty":"easy","prompt":"What is a lending protocol?","options":[{"id":"a","text":"A pool where depositors earn interest and borrowers post collateral"},{"id":"b","text":"A company that issues credit cards"},{"id":"c","text":"A staking validator"}],"correctOptionId":"a"},
{"id":"aq-len-02","topic":"defi-lending","difficulty":"medium","prompt":"What usually sets the interest rate in a lending pool?","options":[{"id":"a","text":"A monthly committee vote"},{"id":"b","text":"Utilisation — how much of the pool is borrowed"},{"id":"c","text":"The largest depositor"}],"correctOptionId":"b"},
{"id":"aq-len-03","topic":"defi-lending","difficulty":"medium","prompt":"Why must DeFi loans be overcollateralised?","options":[{"id":"a","text":"To pay the protocol's fees"},{"id":"b","text":"To satisfy banking regulations"},{"id":"c","text":"There is no credit check, so collateral is the only guarantee"}],"correctOptionId":"c"},
{"id":"aq-len-04","topic":"defi-lending","difficulty":"hard","prompt":"What happens when a borrower's collateral falls below the liquidation threshold?","options":[{"id":"a","text":"Anyone can liquidate the position to repay the debt"},{"id":"b","text":"The protocol adds collateral automatically"},{"id":"c","text":"The loan is forgiven"}],"correctOptionId":"a"},
{"id":"aq-len-05","topic":"defi-lending","difficulty":"medium","prompt":"What is the main risk of depositing into a lending protocol?","options":[{"id":"a","text":"The network deleting your deposit"},{"id":"b","text":"A smart-contract bug or bad debt in the pool"},{"id":"c","text":"Your principal being staked without consent"}],"correctOptionId":"b"},
{"id":"aq-len-06","topic":"defi-lending","difficulty":"easy","prompt":"Is a quoted DeFi yield guaranteed?","options":[{"id":"a","text":"Yes, it is fixed at deposit"},{"id":"b","text":"Yes, if the protocol is audited"},{"id":"c","text":"No — it is variable and can fall"}],"correctOptionId":"c"},
{"id":"aq-len-07","topic":"defi-lending","difficulty":"hard","prompt":"What does an oracle do for a lending protocol?","options":[{"id":"a","text":"Supplies the prices used to value collateral"},{"id":"b","text":"Chooses which loans to approve"},{"id":"c","text":"Stores user balances off chain"}],"correctOptionId":"a"},
{"id":"aq-len-08","topic":"defi-lending","difficulty":"medium","prompt":"Why might you be unable to withdraw from a lending pool immediately?","options":[{"id":"a","text":"Withdrawals are always queued 24h"},{"id":"b","text":"Utilisation is too high — the funds are lent out"},{"id":"c","text":"Your deposit is locked for a year"}],"correctOptionId":"b"},
{"id":"aq-len-09","topic":"defi-lending","difficulty":"easy","prompt":"What does APY describe?","options":[{"id":"a","text":"The protocol's total value locked"},{"id":"b","text":"The fee charged per transaction"},{"id":"c","text":"The annual return including compounding"}],"correctOptionId":"c"},
{"id":"aq-len-10","topic":"defi-lending","difficulty":"hard","prompt":"What is bad debt in a lending pool?","options":[{"id":"a","text":"Debt left unbacked after collateral fell too fast to liquidate"},{"id":"b","text":"Any loan over 90 days old"},{"id":"c","text":"Interest the protocol has not yet collected"}],"correctOptionId":"a"},
{"id":"aq-len-11","topic":"defi-lending","difficulty":"medium","prompt":"Does an audit guarantee a protocol is safe?","options":[{"id":"a","text":"Yes, audited code cannot be exploited"},{"id":"b","text":"No — it reduces risk but does not remove it"},{"id":"c","text":"Only for protocols over $1bn TVL"}],"correctOptionId":"b"},
{"id":"aq-len-12","topic":"defi-lending","difficulty":"medium","prompt":"Why does borrowing against your collateral not trigger a taxable sale in many places?","options":[{"id":"a","text":"Because crypto is untaxed"},{"id":"b","text":"Because the protocol reports it for you"},{"id":"c","text":"Because you still own the collateral — you have not sold it"}],"correctOptionId":"c"},
{"id":"aq-swp-01","topic":"swaps","difficulty":"easy","prompt":"On an AMM-based DEX, who is on the other side of your trade?","options":[{"id":"a","text":"A liquidity pool"},{"id":"b","text":"A matched human trader"},{"id":"c","text":"The DEX's trading desk"}],"correctOptionId":"a"},
{"id":"aq-swp-02","topic":"swaps","difficulty":"medium","prompt":"In a constant product pool, what stays constant?","options":[{"id":"a","text":"The price of each token"},{"id":"b","text":"The product of the two token balances"},{"id":"c","text":"The number of traders"}],"correctOptionId":"b"},
{"id":"aq-swp-03","topic":"swaps","difficulty":"medium","prompt":"What is price impact?","options":[{"id":"a","text":"The DEX's trading fee"},{"id":"b","text":"Price movement caused by others while you wait"},{"id":"c","text":"The price move your own trade causes along the curve"}],"correctOptionId":"c"},
{"id":"aq-swp-04","topic":"swaps","difficulty":"medium","prompt":"What does a 1% slippage tolerance do?","options":[{"id":"a","text":"Cancels the swap if you would get more than 1% less than quoted"},{"id":"b","text":"Charges a 1% fee"},{"id":"c","text":"Guarantees a 1% better price"}],"correctOptionId":"a"},
{"id":"aq-swp-05","topic":"swaps","difficulty":"easy","prompt":"Your swap reverted for exceeding slippage tolerance. What did it cost?","options":[{"id":"a","text":"The full trade amount"},{"id":"b","text":"Only the network fee"},{"id":"c","text":"Nothing whatsoever"}],"correctOptionId":"b"},
{"id":"aq-swp-06","topic":"swaps","difficulty":"hard","prompt":"In a sandwich attack, what does the bot do?","options":[{"id":"a","text":"Cancels your transaction"},{"id":"b","text":"Drains your wallet directly"},{"id":"c","text":"Buys before you and sells after, profiting from the move"}],"correctOptionId":"c"},
{"id":"aq-swp-07","topic":"swaps","difficulty":"hard","prompt":"Why does a very high slippage tolerance make sandwiching worse?","options":[{"id":"a","text":"It tells bots how much they are allowed to take"},{"id":"b","text":"It slows your confirmation"},{"id":"c","text":"It raises the network fee"}],"correctOptionId":"a"},
{"id":"aq-swp-08","topic":"swaps","difficulty":"medium","prompt":"What is impermanent loss?","options":[{"id":"a","text":"A withdrawal fee"},{"id":"b","text":"Ending with less value than simply holding both tokens"},{"id":"c","text":"Tokens locked forever"}],"correctOptionId":"b"},
{"id":"aq-swp-09","topic":"swaps","difficulty":"medium","prompt":"Why can an aggregator get a better price on a large swap?","options":[{"id":"a","text":"It waits for the price to improve"},{"id":"b","text":"It removes network fees"},{"id":"c","text":"It splits the order across pools so none takes the full impact"}],"correctOptionId":"c"},
{"id":"aq-swp-10","topic":"swaps","difficulty":"easy","prompt":"What do you receive for depositing into a liquidity pool?","options":[{"id":"a","text":"LP tokens representing your share"},{"id":"b","text":"A fixed interest payment"},{"id":"c","text":"An NFT deed to the pool"}],"correctOptionId":"a"},
{"id":"aq-swp-11","topic":"swaps","difficulty":"hard","prompt":"Why can you never fully drain a constant product pool?","options":[{"id":"a","text":"A daily withdrawal cap"},{"id":"b","text":"The curve approaches the axis, so the last unit costs infinity"},{"id":"c","text":"Validators block it"}],"correctOptionId":"b"},
{"id":"aq-swp-12","topic":"swaps","difficulty":"medium","prompt":"No pool holds both token A and token B. What can a router do?","options":[{"id":"a","text":"Nothing — the swap is impossible"},{"id":"b","text":"Create a pool automatically"},{"id":"c","text":"Route through an intermediate token"}],"correctOptionId":"c"},
{"id":"aq-stb-01","topic":"stablecoins","difficulty":"easy","prompt":"What actually holds a stablecoin's price near a dollar?","options":[{"id":"a","text":"A mechanism outside the token, like redemption"},{"id":"b","text":"Code in the token fixing the price"},{"id":"c","text":"A blockchain rule"}],"correctOptionId":"a"},
{"id":"aq-stb-02","topic":"stablecoins","difficulty":"medium","prompt":"How does a new USDC come into existence?","options":[{"id":"a","text":"Validators mint it as a reward"},{"id":"b","text":"Someone gives Circle a dollar and Circle mints one"},{"id":"c","text":"It is created when SOL is staked"}],"correctOptionId":"b"},
{"id":"aq-stb-03","topic":"stablecoins","difficulty":"medium","prompt":"What mainly backs USDC?","options":[{"id":"a","text":"Gold reserves"},{"id":"b","text":"Bitcoin held in trust"},{"id":"c","text":"Short-dated Treasuries and bank cash"}],"correctOptionId":"c"},
{"id":"aq-stb-04","topic":"stablecoins","difficulty":"hard","prompt":"Why did UST's collapse accelerate rather than stabilise?","options":[{"id":"a","text":"Burning UST minted more LUNA, crushing the asset backing it"},{"id":"b","text":"Its bank reserves were frozen"},{"id":"c","text":"The chain ran out of block space"}],"correctOptionId":"a"},
{"id":"aq-stb-05","topic":"stablecoins","difficulty":"hard","prompt":"What caused USDC to fall to about $0.87 in March 2023?","options":[{"id":"a","text":"An algorithmic death spiral"},{"id":"b","text":"Part of its reserves sat in a failed bank over a weekend"},{"id":"c","text":"Circle never held reserves"}],"correctOptionId":"b"},
{"id":"aq-stb-06","topic":"stablecoins","difficulty":"medium","prompt":"Why are crypto-backed stablecoins overcollateralised?","options":[{"id":"a","text":"Regulators require it"},{"id":"b","text":"It makes minting cheaper"},{"id":"c","text":"The collateral is volatile, so a cushion keeps them solvent"}],"correctOptionId":"c"},
{"id":"aq-stb-07","topic":"stablecoins","difficulty":"medium","prompt":"What backs a purely algorithmic stablecoin?","options":[{"id":"a","text":"Essentially nothing but a mechanism and continued demand"},{"id":"b","text":"An equal reserve of Bitcoin"},{"id":"c","text":"Government insurance"}],"correctOptionId":"a"},
{"id":"aq-stb-08","topic":"stablecoins","difficulty":"medium","prompt":"Is a monthly reserve attestation the same as a full audit?","options":[{"id":"a","text":"Yes, the terms are identical"},{"id":"b","text":"No — it is a narrower, point-in-time check"},{"id":"c","text":"No, it is a marketing document with no accountant involved"}],"correctOptionId":"b"},
{"id":"aq-stb-09","topic":"stablecoins","difficulty":"easy","prompt":"Does a stablecoin in your wallet carry deposit insurance?","options":[{"id":"a","text":"Yes, up to $250,000"},{"id":"b","text":"Yes, if the issuer is regulated"},{"id":"c","text":"No — it is a claim, not a bank deposit"}],"correctOptionId":"c"},
{"id":"aq-stb-10","topic":"stablecoins","difficulty":"medium","prompt":"You send USDC to a Solana address over the wrong network. What usually happens?","options":[{"id":"a","text":"The funds are generally unrecoverable"},{"id":"b","text":"It is refunded automatically"},{"id":"c","text":"It arrives, just slower"}],"correctOptionId":"a"},
{"id":"aq-stb-11","topic":"stablecoins","difficulty":"easy","prompt":"What is the safest habit before sending a large amount to a new address?","options":[{"id":"a","text":"Send during business hours"},{"id":"b","text":"Send a small test transfer first"},{"id":"c","text":"Split it into ten transfers"}],"correctOptionId":"b"},
{"id":"aq-stb-12","topic":"stablecoins","difficulty":"hard","prompt":"A stablecoin shields you from crypto volatility. What does it NOT shield you from?","options":[{"id":"a","text":"Network outages"},{"id":"b","text":"Transaction fees"},{"id":"c","text":"Inflation and issuer risk"}],"correctOptionId":"c"}
]
$json$::jsonb;

  ---------------------------------------------------------------------------
  -- Guards. These FAIL the migration; they do not warn.
  ---------------------------------------------------------------------------

  select string_agg(q->>'id', ', ')
    into v_bad
    from jsonb_array_elements(v_spec) as q
   where jsonb_array_length(q->'options') <> 3;
  if v_bad is not null then
    raise exception '0064: question(s) % do not have exactly 3 options.', v_bad;
  end if;

  select string_agg(q->>'id', ', ')
    into v_bad
    from jsonb_array_elements(v_spec) as q
   where not exists (
     select 1 from jsonb_array_elements(q->'options') as o
      where o->>'id' = q->>'correctOptionId'
   );
  if v_bad is not null then
    raise exception
      '0064: correctOptionId is not among its own options for question(s): % — grading would be unwinnable.',
      v_bad;
  end if;

  -- Duplicate option ids would make the key ambiguous.
  select string_agg(q->>'id', ', ')
    into v_bad
    from jsonb_array_elements(v_spec) as q
   where (select count(distinct o->>'id') from jsonb_array_elements(q->'options') as o) <> 3;
  if v_bad is not null then
    raise exception '0064: question(s) % have duplicate option ids.', v_bad;
  end if;

  select string_agg(q->>'id', ', ')
    into v_bad
    from jsonb_array_elements(v_spec) as q
   where coalesce(q->>'prompt', '') = '' or coalesce(q->>'topic', '') = '';
  if v_bad is not null then
    raise exception '0064: question(s) % have an empty prompt or topic.', v_bad;
  end if;

  ---------------------------------------------------------------------------
  -- Insert
  ---------------------------------------------------------------------------
  insert into arena.questions (id, topic, difficulty, prompt, options, correct_option_id)
  select q->>'id', q->>'topic', q->>'difficulty', q->>'prompt',
         q->'options', q->>'correctOptionId'
    from jsonb_array_elements(v_spec) as q
  on conflict (id) do update set
    topic = excluded.topic,
    difficulty = excluded.difficulty,
    prompt = excluded.prompt,
    options = excluded.options,
    correct_option_id = excluded.correct_option_id;

  select count(*) into v_count from arena.questions where id like 'aq-%';

  -- A bank smaller than one match is useless; the engine would refuse to
  -- create matches and the failure would surface as a confusing runtime error
  -- rather than here.
  if v_count < 7 then
    raise exception '0064: only % arena questions seeded — a match needs 7.', v_count;
  end if;

  -- Belt and braces: re-check the stored rows, not just the spec.
  if exists (
    select 1 from arena.questions q
     where q.id like 'aq-%'
       and not exists (
         select 1 from jsonb_array_elements(q.options) as o
          where o->>'id' = q.correct_option_id
       )
  ) then
    raise exception '0064: a stored arena question key does not match its stored options.';
  end if;

  raise notice '0064: arena question bank seeded — % questions across % topics.',
    v_count, (select count(distinct topic) from arena.questions where id like 'aq-%');
end
$seed$;
