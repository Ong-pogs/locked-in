# Founding 100 launch design

Status: approved on 2026-09-19.

## Outcome

Recruit the first 100 verified Locked In users quickly while keeping a strict
separation between acquisition, account creation, and real-money activation.
The product is positioned as a capped, unaudited mainnet beta and not as a
guaranteed-return product.

The primary success metric is **100 distinct verified sign-ins**. These are
reported separately:

1. unique landing visitors;
2. Founding 100 CTA clicks;
3. verified sign-ins;
4. course selections;
5. funded lock positions;
6. first completed lesson;
7. day-two and day-seven returning learners;
8. invitations shared and accepted.

No vanity aggregate should be substituted for a later funnel stage.

## Narrative

Headline:

> Stop collecting courses. Finish one.

Subhead:

> Lock $10-$50 USDC behind a course. Complete the work to unlock your position.
> If you fall off after your shields are gone, part of the yield rewards
> learners who stayed consistent.

Primary CTA: **Join the Founding 100**

Trust line:

> Mainnet capped beta · Variable yield · $1,000 TVL cap · Unaudited software ·
> Funds remain exposed to smart-contract, Kamino, USDC, and Solana risks.

Copy must not use "guaranteed", "risk free", "every cent back", or
"learn-to-earn". APY is live and variable; it is never hardcoded into campaign
copy.

## Product surface

Anonymous visitors land in the existing village experience. A compact Founding
100 invitation explains the product in one screen, links to risk details, and
sends the primary CTA to the course catalog. The course-selection flow remains
the point at which an anonymous visitor is asked to sign in.

Vercel Web Analytics measures privacy-scrubbed page views and coarse CTA events.
Wallet addresses, invite codes, match IDs, lesson IDs, course query parameters,
and transaction data are never sent as analytics properties.

## Acquisition sequence

### Wave 1: 20 concierge users

- Founder-led direct outreach to people already learning Solana or DeFi.
- Watch each person attempt sign-in, course selection, funding, and lesson one.
- Resolve every repeated confusion before expanding the cohort.

### Wave 2: 30 community users

- Publish one short product demonstration and one transparent build/mainnet
  post in relevant Solana developer and learner communities.
- Link to the same measurable Founding 100 entry point.
- Ask each activated user for one direct introduction, not a public spam post.

### Wave 3: 50 referral and partner users

- Give early users a copyable invitation to challenge one friend in the Arena.
- Approach course creators and community operators with a five-user test cohort
  rather than an open-ended partnership pitch.
- Expand only while support response time and transaction monitoring remain
  manageable.

Paid acquisition waits until the sign-in-to-first-lesson path converts and the
legal/security follow-ups below are resolved.

## Daily operating loop

Every day during the push:

1. run the read-only live canary;
2. record each funnel count separately;
3. review failed sign-ins, abandoned course selections, and support reports;
4. contact five to ten high-intent prospects personally;
5. publish one concrete learner outcome or product demonstration;
6. ship only fixes tied to observed drop-off;
7. stop acquisition if health, signing, custody, claim, or yield checks drift.

## Release gates and unresolved risk

- Production is already mainnet; this work hardens and explains the existing
  release rather than performing the first cutover.
- No automated test in the launch harness moves funds.
- Legal pages are still drafts and need qualified review before broad paid
  distribution.
- The programs and application describe themselves as unaudited. That warning
  stays prominent.
- Dependency advisories require reachability triage; a raw advisory count is
  not equivalent to a demonstrated exploit.
- The first cohort keeps the existing per-position and aggregate caps.
