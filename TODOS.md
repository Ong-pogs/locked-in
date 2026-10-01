# TODOS

## Growth

### Measure the activation and retention funnel

**What:** Record verified sign-ins, course selections, funded positions, first lessons, day-two/day-seven returns, and invitation outcomes as separate funnel stages.

**Why:** The Founding 100 campaign needs conversion and retention evidence, not only landing-page views and CTA clicks.

**Context:** Privacy-safe page and CTA analytics are live. Extend reporting after the first acquisition push so wallet addresses, invite codes, transaction signatures, and other user identifiers never become analytics properties.

**Effort:** M
**Priority:** P1
**Depends on:** Initial Founding 100 traffic

## Security

### Triage production dependency advisory reachability

**What:** Trace current high and moderate production advisories through the web and backend runtime paths, then upgrade or mitigate reachable findings.

**Why:** Raw advisory counts do not prove exploitability, but unresolved reachability should not be ignored before broader paid acquisition.

**Context:** The current production audit has no critical advisories. Direct affected packages include Privy, Solana, and Kamino dependencies, and several suggested fixes are breaking, invalid, or unavailable.

**Effort:** L
**Priority:** P1
**Depends on:** None

## Legal

### Obtain qualified review of public legal pages

**What:** Have qualified counsel review the Terms, Privacy, and Risk pages before removing their draft notices.

**Why:** Locked In moves real value on mainnet and should not scale paid acquisition on unapproved legal language.

**Context:** The release canary intentionally fails if the public legal pages lose their visible `DRAFT - PENDING LEGAL REVIEW` notice before approval.

**Effort:** M
**Priority:** P1
**Depends on:** Qualified legal counsel

## Testing

### Close the remaining launch-harness edge cases

**What:** Add coverage for malformed beta-cap configuration, live request failures and invalid JSON, on-chain profile drift, reduced-motion and wake behavior, Arena proposal timers, and stake-panel cancellation/refetch behavior.

**Why:** These paths are the remaining gaps in the current launch-focused coverage audit.

**Context:** The current audit covers 24 of 30 identified paths. On-chain drift belongs in an explicitly provisioned integration lane; production smoke checks must remain read-only.

**Effort:** M
**Priority:** P2
**Depends on:** Explicit integration-test environment for on-chain drift

## Completed
