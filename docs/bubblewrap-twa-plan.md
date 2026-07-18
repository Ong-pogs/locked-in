# Bubblewrap TWA Plan — Locked In on Google Play

Research + integration plan for packaging the Locked In PWA (https://www.lockedin.quest) as an
Android app via Trusted Web Activity (TWA). Written 2026-07-18.

---

## 1. What Bubblewrap / TWA is, and current state

A **Trusted Web Activity** is an Android activity that renders your live website full-screen in
the user's Chrome (no WebView, no bundled web code). Chrome verifies via **Digital Asset Links**
that the app and the site belong to the same owner; when verification passes, the browser UI
(URL bar) is hidden and it behaves like a native app. The app on Play is a thin signed shell
(~1 MB); **all content ships from the web and updates instantly with every Vercel deploy — no
Play release needed for web changes** (confirmed: TWA renders the live site).

**Bubblewrap** (`@bubblewrap/cli`, GoogleChromeLabs) generates, builds, and updates that Android
shell project from your web manifest.

- Current version: **1.24.1** (npm, released 2025-09-29). Node >= 14.15; on first run it offers
  to auto-download **JDK 17** and the Android SDK build tools for you.
- Maintenance status (July 2026): alive but slow-cadence. Active issue tracker (issues opened
  May 2026), monthly public office hours, no deprecation/archive notice. It is the engine under
  PWABuilder's Android output, so it is de-facto the canonical path. "Not an officially
  supported Google product" per the repo disclaimer.

### Alternatives compared

| | Bubblewrap CLI | PWABuilder | Capacitor |
|---|---|---|---|
| What it is | CLI that generates a TWA Android project | Web GUI; Android output is Bubblewrap under the hood | Native shell with WebView + native plugin APIs |
| Platforms | Android only | Android (solid), iOS (experimental, frequent 4.2 rejections) | Android + iOS |
| Web code location | Live site (auto-updates) | Live site (auto-updates) | Bundled in app (rebuild + store review per release) |
| Rendering | Real Chrome (full web platform, OAuth-safe) | Real Chrome | WebView (Google OAuth blocked, quirks) |
| Native APIs | None beyond web platform | Same as Bubblewrap | Full native plugin ecosystem |
| Effort | Low (hours) | Lowest (minutes) | Medium-high (real native project) |
| Fit for Locked In | **Best for Android** — Privy OAuth works, zero release friction | Fine shortcut; less control over `twa-manifest.json` | Only worth it for iOS later |

**Recommendation: Bubblewrap CLI for Android.** The TWA-is-real-Chrome property matters for this
app specifically: Privy's Google/social OAuth flows are blocked in plain WebViews
(`disallowed_useragent`) but work in a TWA. Keep the generated project in-repo for repeatable
builds instead of relying on PWABuilder's web UI.

---

## 2. Requirements checklist

**Web side**
- HTTPS (have it), valid web app manifest with `name`, `short_name`, `start_url`, `display:
  standalone`, `theme_color`, `background_color`, icons **192 + 512** (have all of these), plus
  a **512 maskable icon** (missing — Android adaptive icons look cropped/letterboxed without it).
- Service worker with a working **offline fallback** (serwist is installed; verify the offline
  page — Play reviewers open the app in airplane mode, and a raw Chrome dino page looks broken).
- Lighthouse PWA-installable; aim >= 80 performance.
- `/.well-known/assetlinks.json` on the **exact host the TWA opens** (see gotcha below).

**Android/Play side**
- Signing keystore (Bubblewrap generates one) + **Play App Signing** (Google re-signs with its
  own key — the source of the #1 TWA bug, see §5 step 4).
- Play Console: one-time **$25** registration. **Personal accounts created after Nov 2023 must
  run a closed test with >= 12 opted-in testers for 14 consecutive days before applying for
  production access** (down from 20; org accounts exempt). Identity verification ~2 business
  days. Budget 2–4 weeks wall-clock for first publish.
- Store listing: privacy policy URL, Data safety form (wallet addresses + email via Privy =
  collected user data), Financial features declaration (see §4), screenshots, feature graphic.
- Target API level must stay within ~1 year of the latest Android release → expect **one
  mandatory shell rebuild per year** (`bubblewrap update` + bump `appVersionCode`).

---

## 3. Verified current state of the Locked In PWA

Checked live on 2026-07-18:

- Apex `lockedin.quest` **308-redirects to `www.lockedin.quest`**. The TWA host and assetlinks
  must therefore use **`www.lockedin.quest`** — a redirect at launch or on the assetlinks fetch
  breaks verification (URL bar appears).
- Manifest is served at **`https://www.lockedin.quest/manifest.webmanifest`** (App Router
  `web-app/app/manifest.ts`). `/manifest.json` is a **404** — use the `.webmanifest` URL in
  `bubblewrap init`.
- Manifest content: name/short_name `Locked-In`, `start_url: /`, `display: standalone`,
  theme `#0ea5e9`, bg `#0a0a0a`, icons 192+512 (`web-app/public/icons/`). **Missing:** `id`,
  `scope`, `orientation`, maskable icon, screenshots, categories.
- `/.well-known/assetlinks.json` → **404** (expected; must be added).
- Service worker: serwist via `@serwist/turbopack` in `web-app/next.config.ts`.
- Auth: **Privy** (`@privy-io/react-auth`) — embedded wallets + social login, JWT into Zustand.
  Solana stack is `@solana/kit` + `@solana/react-hooks` (wallet-standard era).

---

## 4. Gotchas for a crypto/wallet PWA in a TWA

**Wallet connectivity**
- No injected extension wallets exist on mobile Chrome/TWA — `window.phantom` etc. will be
  absent. Flows that work: Privy embedded wallets (pure web — works), OAuth socials (works,
  real Chrome), Mobile Wallet Adapter, and wallet deep links.
- **Solana Mobile Wallet Adapter** works from Android Chrome (and therefore from a TWA): it
  fires a `solana-wallet:` intent to a local wallet app and talks over a localhost WebSocket.
  Two caveats: the intent **must originate from an explicit user gesture** (Chrome blocks
  programmatic navigation), and it's only tested against Chrome — fine here since TWA = Chrome.
- **Phantom deep links / universal links** (`https://phantom.app/ul/...`, `phantom://`) open
  the Phantom app *outside* the TWA, then return via your URL. Return URLs on
  `www.lockedin.quest` re-enter the TWA (verified links), so round-trips work — but test the
  full out-and-back on device; if the return lands on a different host it opens the browser.
- Since Locked In's primary path is Privy embedded wallets, wallet UX inside the TWA should be
  identical to mobile web today. Verify on device before assuming.

**Sessions & storage**
- The TWA shares the **user's Chrome profile storage** with the browser: cookies, localStorage,
  IndexedDB are the same origin store. Upside: a user logged in on mobile web is logged in in
  the app. Downside: "Clear Chrome browsing data" wipes app state (Privy session, Zustand
  persist) — never keep anything unrecoverable client-side (already true: auth is
  challenge-sign + JWT).
- If the user's default browser doesn't support the TWA protocol (rare — non-Chrome defaults),
  Android falls back to a Custom Tab with visible browser UI. Cosmetic, not functional.
- **WebAuthn/passkeys work** (it's Chrome on Android with platform authenticator support) —
  relevant if passkeys are ever added on top of Privy.

**iOS (TWA is Android-only)**
- Options in 2026: (a) stay pure PWA — Safari supports Add-to-Home-Screen install and **web
  push for installed PWAs** (not in-browser Safari); promote install in-app for iOS visitors;
  (b) **Capacitor** native shell for the App Store — real work, and Apple's Guideline 4.2
  ("repackaged website") rejections are common for thin wrappers; PWABuilder's iOS output hits
  the same wall; (c) Apple's crypto rules (Guideline 3.1.5) are stricter than Google's —
  exchange-like functionality requires licensing, and earning-crypto-for-tasks mechanics have
  historically been rejected; a "complete lessons → earn yield/tokens" app is squarely in
  review-risk territory on iOS.
- **Recommendation: ship Android TWA now, keep iOS as installed-PWA-from-Safari, defer any
  App Store attempt** until the product is past capped beta and worth a native investment.

---

## 5. Play Store crypto policy — honest risk assessment

Per Google's current "Cryptocurrency Exchanges and Software Wallets" policy (checked July 2026):

- Scope = **exchanges and custodial software wallets**. "Non-custodial wallets are out of scope."
  In ~18 jurisdictions (US, UK, Canada, EU member states, Japan, South Korea, HK, UAE, etc.)
  in-scope apps must hold licenses and file location-specific forms (MiCA authorization for EU).
- Every crypto-touching app must complete the **Financial Features Declaration** in Play
  Console, and the **Blockchain-based Content** declaration. Undeclared crypto features are a
  takedown reason on their own.
- NFTs/tokens must not be used to **wager or stake for prizes of real-world monetary value**.

**Where Locked In sits:** users sign transactions from their own (Privy embedded, self-custodial)
wallet into an audited program; the app never takes custody. That is a genuine "out of scope"
argument. But honestly flagged risks:

1. **Yield on locked USDC is exchange/financial-service-adjacent.** A reviewer who classifies
   the app as facilitating a regulated financial product in a licensed jurisdiction can demand
   license proof you don't have. This is the single biggest listing risk.
2. **Lapse penalties redirecting yield to a community pot** could be read as staking/wagering
   (losing money based on outcomes). Your counter: outcome is entirely user skill/consistency,
   no chance element — but write the store description carefully (habit app with deposits, not
   "earn yield").
3. Mitigations that materially de-risk: **restrict country availability in Play Console to
   jurisdictions outside the licensed list** for the capped beta (e.g. Malaysia/SEA ex-Indonesia,
   ex-Philippines, ex-Thailand); keep the existing $50/$1k caps; fill both declarations
   truthfully emphasizing non-custodial; privacy policy + risk disclosures on the site.

Verdict: **medium policy risk — plausible to pass as a declared, non-custodial, geo-restricted
app; do not ship worldwide on day one.** Rejection costs little (fix and resubmit); running
undeclared risks account strikes — always declare.

---

## 6. Step-by-step integration plan

### Phase 0 — Web-side prep (in `web-app/`, deploy before init)

1. Harden `web-app/app/manifest.ts`: add `id: '/'`, `scope: '/'`, `orientation: 'portrait'`,
   `categories: ['education', 'finance']`, and a maskable 512 icon entry
   (`purpose: 'maskable'`, new asset `public/icons/icon-512-maskable.png` — logo inside the
   80% safe zone).
2. Verify the serwist offline fallback page renders something branded in airplane mode.
3. Add the assetlinks file (fingerprints filled in Phase 2/3):

   `web-app/public/.well-known/assetlinks.json` — Next.js serves `public/` verbatim, so this
   comes out at `https://www.lockedin.quest/.well-known/assetlinks.json` on Vercel with JSON
   content-type and no redirect (there is no middleware in the project to intercept it).

   ```json
   [{
     "relation": ["delegate_permission/common.handle_all_urls"],
     "target": {
       "namespace": "android_app",
       "package_name": "quest.lockedin.twa",
       "sha256_cert_fingerprints": ["UPLOAD_KEY_SHA256", "PLAY_SIGNING_SHA256"]
     }
   }]
   ```

### Phase 1 — Generate the Android project

```bash
npm i -g @bubblewrap/cli        # 1.24.1; first run offers to install JDK 17 + Android SDK
mkdir android-twa && cd android-twa
bubblewrap init --manifest=https://www.lockedin.quest/manifest.webmanifest
```

Prompt answers: domain `www.lockedin.quest` (the www host — apex redirects and would break
verification), package id `quest.lockedin.twa`, display `standalone`, status/nav bar colors from
theme (`#0ea5e9` / `#0a0a0a`), fallback `customtabs`. Let it create `android.keystore` with a
strong password.

Repo hygiene: commit `android-twa/twa-manifest.json` + generated project; **gitignore
`android.keystore`** and back it up (password manager + offline copy). Losing it only costs the
upload key (Play can reset those), but treat it like a secret regardless.

### Phase 2 — Build and local test

```bash
bubblewrap build          # → app-release-signed.apk + app-release-bundle.aab
bubblewrap install        # or: adb install app-release-signed.apk
bubblewrap fingerprint    # prints the local/upload key SHA-256
```

Put the printed SHA-256 into `assetlinks.json` (first slot), deploy Vercel, reinstall, relaunch.
No URL bar = verification works.

### Phase 3 — Play Console

1. Register ($25 one-time). If registering fresh as a personal account: plan for the
   **12-testers × 14-consecutive-days closed test** gate before production access.
2. Create app → upload the **`.aab`** to Closed testing. Enroll in **Play App Signing**
   (default).
3. **Critical gotcha:** Play Console → *Test and release > Setup > App signing* (App integrity)
   → copy the **App signing key certificate SHA-256** (Google's key, ≠ your upload key) into
   the second slot of `assetlinks.json` and redeploy. Skipping this is the classic "app shows
   browser address bar in production" bug. Keep both fingerprints (local builds + Play builds).
4. Fill: Data safety (wallet address, email, usage data), **Financial features declaration**,
   **Blockchain-based content declaration**, privacy policy URL, content rating.
5. **Countries: start with a geo-restricted list excluding the crypto-licensed jurisdictions**
   (§5) for the capped beta.
6. Recruit 12+ testers (Superteam/Colosseum circles are the natural pool), run 14 days, apply
   for production.

### Phase 4 — Ongoing updates

- **Web deploys need nothing** — the TWA shows the live site immediately.
- Shell re-release only when: app name/icons/colors/orientation change, or the annual Play
  target-SDK bump. Flow: edit `twa-manifest.json` (or re-run against the live manifest) →
  `bubblewrap update` → bump `appVersionCode`/`appVersion` → `bubblewrap build` → upload `.aab`.
- If the domain ever changes, both the TWA host and assetlinks must move in lockstep.

### Testing checklist (physical Android device)

- [ ] Launch: full-screen, no URL bar (assetlinks verified); check
      `adb shell pm get-app-links quest.lockedin.twa` shows `verified`
- [ ] Cold start splash: correct icon/bg color; maskable icon looks right in launcher
- [ ] Privy login: email, **Google OAuth** (the flow WebViews break), wallet
- [ ] Session persists across app kills; shared with Chrome tab session
- [ ] Deposit flow end-to-end: sign transaction with embedded wallet inside TWA
- [ ] If external-wallet path exists: Phantom deep link out → sign → return lands back in TWA
- [ ] Offline (airplane mode): branded fallback, not a Chrome error page
- [ ] Android back button navigates history, exits cleanly at root
- [ ] 3D village (`web/dungeon` iframe) renders and performs on a mid-range device
- [ ] Push notifications if/when added (web push works in TWA)
- [ ] Fresh-install test on a second device with no prior Chrome session

---

## 7. Sources

- Bubblewrap repo/CLI: https://github.com/GoogleChromeLabs/bubblewrap · https://www.npmjs.com/package/@bubblewrap/cli
- TWA integration guide: https://developer.chrome.com/docs/android/trusted-web-activity/integration-guide
- Android concepts for web devs (Play App Signing fingerprint gotcha): https://developer.chrome.com/docs/android/trusted-web-activity/android-for-web-devs
- PWABuilder assetlinks doc: https://github.com/pwa-builder/pwabuilder-google-play/blob/main/Asset-links.md
- Play crypto policy: https://support.google.com/googleplay/android-developer/answer/16329703 · Blockchain content: https://support.google.com/googleplay/android-developer/answer/13607354
- New-account testing requirements: https://support.google.com/googleplay/android-developer/answer/14151465
- Mobile Wallet Adapter on web: https://docs.solanamobile.com/developers/mobile-wallet-adapter-web
- Phantom deeplinks: https://phantom.com/learn/blog/the-complete-guide-to-phantom-deeplinks
- PWA→store landscape 2026: https://www.mobiloud.com/blog/publishing-pwa-app-store · iOS PWA limits: https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide
