# Locked In — Development README

> Locking tf In by building habits through monetary motivators & gamification.
> A Solana-native learning platform where your money works when you do.

---

## Table of Contents

- [Tech Stack](#tech-stack)
- [Architecture Overview](#architecture-overview)
- [App Flow & Navigation](#app-flow--navigation)
- [Screen Specifications](#screen-specifications)
- [Core Systems](#core-systems)
- [3D Implementation](#3d-implementation)
- [State Management](#state-management)
- [Service Layer](#service-layer)
- [Project Structure](#project-structure)

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Runtime** | React Native + Expo SDK 54 | Cross-platform mobile app (iOS/Android) |
| **Language** | TypeScript (strict) | Type safety across the codebase |
| **3D Engine** | Three.js + React Three Fiber (@react-three/fiber) | Full 3D room scenes — the main hub |
| **3D Helpers** | @react-three/drei | Pre-built 3D components (controls, loaders, text, lighting) |
| **3D Native Bridge** | expo-gl + expo-asset | OpenGL context for R3F on native + asset loading |
| **3D Models** | GLTF/GLB (created in Blender) | Stylized low-poly models for room objects |
| **Styling** | NativeWind (Tailwind CSS for RN) | Utility-first styling for all flat UI screens |
| **Navigation** | React Navigation (stack + bottom tabs) | Screen routing and transitions |
| **State** | Zustand | Global state management (works natively with R3F) |
| **Animations** | React Native Reanimated | Micro-animations on flat UI screens |
| **Storage** | AsyncStorage | Persistent local data (streaks, preferences, cache) |
| **Blockchain** | @solana/web3.js, @coral-xyz/anchor, SPL Token | Solana wallet, transactions, token operations |
| **Wallet** | @solana-mobile/mobile-wallet-adapter | Phantom/Solflare wallet connection on mobile |
| **Web Code Display** | react-syntax-highlighter | Syntax-highlighted code snippets in lessons |

### Packages to Install

```bash
# 3D Engine
npx expo install expo-gl expo-asset
npm install three @react-three/fiber @react-three/drei

# Lesson content
npm install react-syntax-highlighter
npm install --save-dev @types/react-syntax-highlighter

# WebView (for future code editor if needed)
npx expo install react-native-webview
```

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│                      App Entry                           │
│                    (index.js)                             │
│              Polyfills + Registration                    │
└──────────────────┬───────────────────────────────────────┘
                   │
┌──────────────────▼───────────────────────────────────────┐
│                   App.tsx                                │
│         Providers: Navigation, Zustand, Wallet           │
└──────────────────┬───────────────────────────────────────┘
                   │
┌──────────────────▼───────────────────────────────────────┐
│              Navigation Router                           │
│                                                          │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐   │
│  │  Auth Stack  │  │  Onboarding  │  │   Main Stack  │   │
│  │  (Wallet)    │  │  (Week 1)    │  │   (Post-Gaunt)│   │
│  └─────────────┘  └──────────────┘  └────────────────┘   │
│                                            │             │
│                              ┌─────────────┴──────────┐  │
│                              │    3D Room Hub         │  │
│                              │  (React Three Fiber)   │  │
│                              │                        │  │
│                              │  Bookshelf → Courses   │  │
│                              │  Fireplace → Flame     │  │
│                              │  Alchemy   → M Tokens  │  │
│                              │  Board     → Leaders   │  │
│                              │  Character → Profile   │  │
│                              └────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

---

## App Flow & Navigation

### Phase 1: Onboarding & Wallet Connect
1. **Splash Screen** — App logo, loading assets
2. **Wallet Connect Screen** — Connect Phantom/Solflare. Crypto-native audience, wallet-first.
3. **Course Selection** — Choose first skill track (Solana/Web3 dev initially)
4. **Deposit & Lock** — Lock USDC/USDT for course duration (front-end mock for now)
5. **Enter Week 1 Gauntlet**

### Phase 2: Week 1 — The Commitment Gauntlet
- **Visual style:** Bright, chill, Stardew Valley-inspired room. Warm colors, soft lighting.
- **Mechanics:** No savers, no yield yet. Maximum stakes. Break streak = lockup extension + full yield redirect.
- **Purpose:** Establish the daily habit before the real experience begins.
- **Room:** Simple, cozy room with basic interactive elements (desk with lessons, window showing progress).
- **Duration:** 7 consecutive days of completed daily quests.

### Phase 3: The Fall (Transition Cutscene)
- After completing Week 1, a narrative event triggers.
- The character is pushed or falls into a deep cavern.
- Cutscene: falling animation → blackout → wake up underground.
- **Implementation:** Animated sequence using R3F camera path animation or pre-rendered video overlay.
- This marks the tonal shift from "chill" to "dark dungeon."

### Phase 4: The Underground Room (Main Hub)
- **Visual style:** Dark, rocky, atmospheric. Scorn/Dead Cells/Hades 2 aesthetic.
- **The permanent hub** for the rest of the user's journey.
- Fixed camera viewpoints (snap between angles by swiping).
- Interactive 3D objects serve as navigation:
  - **Bookshelf** → Course browser / lesson selection
  - **Fireplace** → Flame status, feed M tokens, view streak
  - **Alchemy Table** → M token management, cosmetic upgrades, Flame skins
  - **Notice Board** → Leaderboard, community pot status
  - **Character** (resting on floor) → Profile, wallet, settings
- The Flame in the fireplace visually reflects actual Flame state (burning bright, sputtering, dead).

---

## Screen Specifications

### 1. Wallet Connect Screen
**File:** `src/screens/WalletConnectScreen.tsx`

| Function | What It Does | Implementation |
|----------|-------------|----------------|
| `connectWallet()` | Initiates wallet connection via Mobile Wallet Adapter | Calls `@solana-mobile/mobile-wallet-adapter-protocol`. Opens Phantom/Solflare for auth. Returns public key. |
| `disconnectWallet()` | Disconnects active wallet session | Clears wallet state in Zustand store, resets to connect screen. |
| `checkExistingSession()` | Auto-reconnects if user has previous session | Reads cached wallet pubkey from AsyncStorage on mount. If valid, skips to next screen. |

**UI:** Dark branded screen with "Connect Wallet" CTA. Supports Phantom, Solflare. Seedless wallet option for lower friction (future).

---

### 2. Course Selection Screen
**File:** `src/screens/CourseSelectionScreen.tsx`

| Function | What It Does | Implementation |
|----------|-------------|----------------|
| `fetchCourses()` | Loads available skill tracks | Reads from local course data (JSON/constants) initially. API-backed later. |
| `selectCourse(courseId)` | Sets user's active course | Updates Zustand `userStore` with selected course. Navigates to deposit screen. |
| `getCourseDetails(courseId)` | Returns course metadata | Duration, lesson count, difficulty, description, lock period. |

**UI:** Card-based course browser. First track: "Solana & Web3 Development." Shows lock duration, estimated daily commitment.

---

### 3. Deposit & Lock Screen
**File:** `src/screens/DepositScreen.tsx`

| Function | What It Does | Implementation |
|----------|-------------|----------------|
| `fetchBalance()` | Gets user's USDC/USDT balance | Calls `@solana/web3.js` to read SPL token accounts for connected wallet. |
| `setDepositAmount(amount)` | User inputs how much to lock | Local state. Validates against balance. Minimum deposit enforced. |
| `confirmDeposit()` | Locks funds into smart contract | Builds and sends Anchor transaction to lock program (mocked for front-end). Stores lock details in Zustand. |
| `calculateProjectedYield(amount, duration)` | Shows estimated yield earnings | Pure function. `amount * APY * (duration / 365)`. Display only. |

**UI:** Amount input, balance display, yield projection, duration display, confirm button. Clear disclosure of lock terms.

---

### 4. Week 1 Gauntlet Room (3D)
**File:** `src/screens/GauntletRoomScreen.tsx`

| Function | What It Does | Implementation |
|----------|-------------|----------------|
| `loadGauntletScene()` | Initializes the Week 1 3D room | Loads GLTF models for the chill room. Sets warm lighting, soft ambient audio cues. |
| `checkGauntletProgress()` | Tracks days completed in Week 1 | Reads from `streakStore`. If 7 consecutive days done, triggers transition. |
| `triggerFallCutscene()` | Plays the falling transition | Camera animation path (R3F `useFrame` + lerp) or video overlay. Navigates to underground hub. |
| `handleObjectTap(objectId)` | Responds to tapping room objects | Raycasting via R3F `onClick` on mesh. Maps objectId to navigation action. |

**3D Scene:** Cozy room — wooden desk, window with sunlight, small plant, basic lesson book on desk. Character sitting at desk. Warm orange/yellow lighting.

---

### 5. Underground Room Hub (3D) — Main Hub
**File:** `src/screens/UndergroundHubScreen.tsx`

This is the core screen of the app post-gauntlet.

| Function | What It Does | Implementation |
|----------|-------------|----------------|
| `loadUndergroundScene()` | Initializes the dungeon room 3D scene | Loads GLTF models: room shell, bookshelf, fireplace, alchemy table, notice board, character. Dark ambient lighting + fireplace point light. |
| `updateFlameVisuals(flameState)` | Syncs fireplace visuals with Flame data | Reads `flameStore` state. Adjusts particle intensity, light color/radius, ember count. Bright = healthy Flame. Dim/out = dead Flame. |
| `setCameraViewpoint(viewpointId)` | Snaps camera to a fixed angle | Pre-defined camera positions array. Lerp transition between positions using `useFrame`. Swipe gesture maps to next/prev viewpoint. |
| `handleObjectInteraction(objectId)` | Handles tap on interactive object | Raycasting click detection. Object highlight on hover/focus. Maps to: `bookshelf` → CourseScreen, `fireplace` → FlameScreen, `alchemy` → TokenScreen, `board` → LeaderboardScreen, `character` → ProfileScreen. |
| `getActiveViewpoint()` | Returns which object the camera faces | Determines which UI overlay to show based on current camera angle. |
| `animateCharacter(state)` | Sets character idle animation | Plays looping idle animation on character model (resting on floor). State changes: sleeping, sitting, meditating based on streak health. |

**3D Scene Details:**
- **Room:** Carved rock cavern, rough stone walls, ambient fog. Low ceiling with stalactites.
- **Bookshelf:** Wooden shelf against wall. Books glow faintly. Tapping opens course browser overlay.
- **Fireplace:** Central feature. Real-time particle system for flames. Light casts dynamic shadows. Flame intensity = user's Flame state.
- **Alchemy Table:** Wooden table with vials, M token crystals. Interaction opens token management UI.
- **Notice Board:** Parchment/scrolls pinned to rock wall. Shows leaderboard rankings.
- **Character:** Stylized figure resting near fireplace. Low-frame idle animation (Forgive Me Father 2 choppy charm).

**Camera Viewpoints (fixed, swipe to rotate):**
1. **Overview** — Wide shot of entire room
2. **Bookshelf** — Close-up, books visible
3. **Fireplace** — Close-up, Flame dominant
4. **Alchemy Table** — Close-up, tokens visible
5. **Notice Board** — Close-up, leaderboard visible

---

### 6. Course Browser Screen (from Bookshelf)
**File:** `src/screens/CourseBrowserScreen.tsx`

| Function | What It Does | Implementation |
|----------|-------------|----------------|
| `fetchUserCourses()` | Gets user's enrolled courses with progress | Reads from `courseStore`. Returns courses with completion %, current lesson index. |
| `fetchAvailableCourses()` | Gets all courses not yet enrolled | Filters course catalog against user's enrolled list. |
| `resumeCourse(courseId)` | Navigates to next incomplete lesson | Looks up last completed lesson index, navigates to `index + 1`. |
| `startLesson(courseId, lessonId)` | Opens a specific lesson | Navigates to LessonScreen with course and lesson params. |

**UI:** Flat screen (NativeWind styled). List of course modules, each with lessons. Progress bars. "Continue" button for active course. Back button returns to 3D room.

---

### 7. Lesson Screen
**File:** `src/screens/LessonScreen.tsx`

| Function | What It Does | Implementation |
|----------|-------------|----------------|
| `loadLesson(courseId, lessonId)` | Fetches lesson content | Reads from local lesson data (structured JSON). Contains: title, content blocks, questions. |
| `renderContentBlock(block)` | Renders a content block | Switch on block type: `text` → markdown render, `code` → syntax-highlighted code block, `image` → image component, `callout` → styled info box. |
| `submitMCQAnswer(questionId, selectedOption)` | Validates a multiple choice answer | Compares selected option against correct answer in lesson data. Updates score. Shows correct/incorrect feedback. |
| `submitTextAnswer(questionId, text)` | Validates a short text answer | Keyword matching against accepted answer patterns. Future: AI grading via API call. Returns score + feedback. |
| `calculateFragmentReward()` | Determines M token fragment earned | Variable reward: 0.1–0.4 fragments based on accuracy and speed. Only awards if saver inventory is full (3/3). |
| `completeLesson()` | Marks lesson as done, awards rewards | Updates `courseStore` progress. Awards M token fragments to `tokenStore`. Awards XP. Checks if daily quest is complete. Navigates to results screen. |
| `checkDailyQuestStatus()` | Checks if user has completed minimum daily requirement | Reads from `questStore`. At least 1 lesson/day = daily quest done = streak maintained. |

**UI:** Scrollable lesson content. Code blocks with syntax highlighting (react-syntax-highlighter). MCQ as tappable option cards. Text input field for written answers. Progress bar at top. Fragment reward animation on completion.

**Lesson Data Structure:**
```typescript
interface Lesson {
  id: string;
  courseId: string;
  title: string;
  order: number;
  contentBlocks: ContentBlock[];
  questions: Question[];
  estimatedMinutes: number;
}

type ContentBlock =
  | { type: 'text'; content: string }        // Markdown text
  | { type: 'code'; language: string; code: string }  // Syntax highlighted
  | { type: 'image'; uri: string; caption?: string }
  | { type: 'callout'; variant: 'info' | 'warning' | 'tip'; content: string };

type Question =
  | { type: 'mcq'; id: string; prompt: string; options: string[]; correctIndex: number; explanation: string }
  | { type: 'text'; id: string; prompt: string; acceptedPatterns: string[]; explanation: string };
```

---

### 8. Flame Dashboard Screen (from Fireplace)
**File:** `src/screens/FlameDashboardScreen.tsx`

| Function | What It Does | Implementation |
|----------|-------------|----------------|
| `getFlameStatus()` | Returns current Flame state | Reads from `flameStore`: isLit, tokensRemaining, burnRate, projectedDaysLeft. |
| `feedFlame(tokenCount)` | Manually feeds M tokens to Flame | Deducts from `tokenStore` wallet, adds to Flame fuel in `flameStore`. Triggers visual feedback. |
| `getStreakInfo()` | Returns streak data | From `streakStore`: currentStreak, longestStreak, saverCount, saverRecoveryProgress. |
| `getYieldInfo()` | Returns yield accumulation data | From `yieldStore`: totalAccrued, currentRate, communityPotContribution, projectedMonthly. |
| `getSaverStatus()` | Returns streak saver inventory | Count (0–3), recovery mode active?, lessons until next saver earned back. |

**UI:** Central Flame visualization (can be 2D animated here or a smaller R3F canvas). Streak counter. M token balance. Saver inventory (3 shield icons). Yield accumulation ticker. Days projection. Feed button.

---

### 9. M Token / Alchemy Screen (from Alchemy Table)
**File:** `src/screens/AlchemyScreen.tsx`

| Function | What It Does | Implementation |
|----------|-------------|----------------|
| `getTokenBalance()` | Returns M token wallet balance | Reads `tokenStore`: fragments, fullTokens, walletCap (7–14). |
| `getTokenHistory()` | Returns earn/spend history | Array of token transactions: earned (lesson, amount, date), spent (flame, cosmetic). |
| `purchaseCosmetic(cosmeticId)` | Buys a Flame skin or streak animation | Deducts M tokens from wallet. Unlocks cosmetic in `cosmeticStore`. |
| `getAvailableCosmetics()` | Lists purchasable cosmetics | Flame skins, streak animations, room decorations. Each with M token price. |
| `boostFlameIntensity(extraTokens)` | Burns extra tokens for temporary yield boost | (Speculative feature) Increases burn rate but amplifies yield multiplier temporarily. |

**UI:** Token wallet display. Earn history timeline. Cosmetic shop grid. Flame skin previews. Purchase confirmation modal.

---

### 10. Leaderboard Screen (from Notice Board)
**File:** `src/screens/LeaderboardScreen.tsx`

| Function | What It Does | Implementation |
|----------|-------------|----------------|
| `fetchLeaderboard(type)` | Gets ranked user list | Type: `global`, `friends`, `course`. Composite score: streak length × deposit size × M tokens earned. |
| `getCommunityPotStatus()` | Returns current pot info | Total pot value, next distribution date, user's projected share. |
| `getUserRank()` | Gets current user's position | Finds user in leaderboard, returns rank + surrounding users. |
| `addFriend(publicKey)` | Adds a user to friends list | Stores friend's wallet pubkey. Enables friends leaderboard filtering. |

**UI:** Ranked list with position, username/wallet, streak, deposit, composite score. Community pot card showing total + next distribution. Tabs: Global / Friends / Course. User's own rank pinned at bottom.

---

### 11. Profile & Wallet Screen (from Character)
**File:** `src/screens/ProfileScreen.tsx`

| Function | What It Does | Implementation |
|----------|-------------|----------------|
| `getUserProfile()` | Returns user data | Wallet address, display name, avatar, joined date, courses enrolled. |
| `getWalletDetails()` | Returns wallet/lock info | Locked amount, lock duration remaining, yield earned, unlock date. |
| `getAchievements()` | Returns unlocked achievements | Array of achievement objects: title, description, icon, unlockedDate. |
| `updateDisplayName(name)` | Sets user's display name | Updates `userStore`. Persists to AsyncStorage (and API when backend exists). |
| `getActiveCosmetics()` | Returns equipped cosmetics | Current Flame skin, streak animation, room decorations. |
| `equipCosmetic(cosmeticId)` | Equips a cosmetic item | Updates `cosmeticStore` active items. Reflects immediately in 3D room. |

**UI:** Wallet address (truncated with copy). Lock status card. Achievement grid. Cosmetic loadout. Stats summary (total lessons, total streak days, total yield). Settings gear icon.

---

## Core Systems

### 1. Flame System

The Flame is the central mechanic. It represents financial momentum — while it burns, yield accrues. When it dies, yield stops.

```
Flame State Machine:
┌─────────┐  earn M token  ┌──────────┐  1 token/day burn  ┌───────────┐
│  COLD   │ ──────────────► │  LIT     │ ◄────────────────► │  BURNING  │
│ (no yield)│              │ (earning) │                    │ (earning) │
└─────────┘  ◄──────────── └──────────┘ ──────────────────► └───────────┘
              tokens = 0                    tokens = 0         │
                                                               │ buffer
                                                               │ depleted
                                          ┌──────────┐        │
                                          │ SPUTTERING│ ◄──────┘
                                          │ (warning) │
                                          └──────────┘
```

| Property | Value |
|----------|-------|
| Burn rate | 1 M token / day |
| Daily earn cap | 1 M token (in fragments: 0.1–0.4 per lesson) |
| Wallet cap | 7–14 tokens (A/B test) |
| Flame states | COLD, LIT, BURNING, SPUTTERING |
| Yield behavior | Active only when Flame is LIT or BURNING |

**Implementation:** `src/stores/flameStore.ts` — Zustand store tracking: `isLit`, `tokenBuffer`, `burnRatePerDay`, `lastBurnTimestamp`, `flameState`. A `tickFlame()` function runs on app open to calculate elapsed burns.

---

### 2. Streak System

Tracks daily presence. Independent from the Flame.

| Property | Value |
|----------|-------|
| Streak increment | Complete at least 1 lesson per day |
| Streak savers | 3 granted on Day 8 |
| Saver recovery | Lessons earn savers back faster than 1/day |
| Max savers | 3 |

**Streak Saver Penalty Escalation:**
| Saver Used | Yield Penalty |
|-----------|---------------|
| 1st saver | 10% → community pot |
| 2nd saver | 20% → community pot |
| 3rd saver | 20% → community pot |
| No savers left | 100% yield redirect + lockup extension |

**Implementation:** `src/stores/streakStore.ts` — Zustand store tracking: `currentStreak`, `longestStreak`, `saverCount`, `saverRecoveryMode`, `lastCompletedDate`, `saversUsedSequence`.

---

### 3. M Token Economy

Non-tradeable, non-transferable utility tokens. Fuel for the Flame.

| Property | Value |
|----------|-------|
| Earn method | Lesson/quiz completion (variable fragments) |
| Fragment range | 0.1–0.4 per activity |
| Daily cap | 1.0 full token |
| Earning condition | Saver inventory must be full (3/3) |
| Spend methods | Flame fuel, cosmetics, intensity boost (speculative) |
| Wallet cap | 7–14 tokens |
| Tradeable | NO — explicitly non-transferable |

**Implementation:** `src/stores/tokenStore.ts` — tracks: `fragments`, `fullTokens`, `dailyEarned`, `walletTotal`, `earnHistory`, `spendHistory`. `awardFragment(amount)` enforces daily cap and saver-full condition.

---

### 4. Saver Recovery System

When a saver is consumed, the user enters recovery mode.

```
Normal Mode                    Recovery Mode
┌─────────────────┐           ┌──────────────────────┐
│ Lessons earn     │  saver   │ Lessons earn SAVERS   │
│ M token fragments│ ────────►│ (not M tokens)        │
│                  │ consumed │ Until inventory = 3/3  │
└─────────────────┘           └──────────────────────┘
                                        │
                                        │ 3/3 restored
                                        ▼
                              ┌──────────────────────┐
                              │ Back to Normal Mode   │
                              │ M token earning       │
                              │ resumes               │
                              └──────────────────────┘
```

**Implementation:** Handled within `streakStore.ts`. When `saverRecoveryMode === true`, lesson completion calls `recoverSaver()` instead of `awardFragment()`.

---

### 5. Yield System (Front-End Mock)

For front-end purposes, yield is simulated.

| Property | Value |
|----------|-------|
| Base APY | 2–8% (modeled at 2% base case) |
| Accrual | Continuous while Flame is active |
| Platform fee | 10–20% of yield |
| Community pot | Receives forfeited yield |
| Distribution | Monthly to active streak holders, weighted by streak × deposit |

**Implementation:** `src/stores/yieldStore.ts` — mock yield calculator: `lockedAmount * APY * elapsedDays / 365`. Tracks: `totalAccrued`, `forfeited`, `communityPotContribution`, `projectedMonthly`.

---

## 3D Implementation

### Technology: React Three Fiber (R3F) + Three.js

R3F lets us write 3D scenes as React components. Zustand state drives visual updates reactively.

### Scene Architecture

```
<Canvas>                              // R3F canvas (expo-gl on native)
  <ambientLight />                    // Base ambient light
  <pointLight position={fireplace} /> // Dynamic: intensity = flame state
  <fog />                             // Atmospheric depth

  <RoomShell />                       // GLTF: rock walls, floor, ceiling
  <Bookshelf onClick={→ courses} />   // GLTF: interactive
  <Fireplace flameState={state} />    // GLTF + particle system
  <AlchemyTable onClick={→ tokens} /> // GLTF: interactive
  <NoticeBoard onClick={→ leaders} /> // GLTF: interactive
  <Character animState={idle} />      // GLTF + animation mixer

  <CameraController viewpoint={current} /> // Fixed viewpoint system
</Canvas>
```

### Camera System (Fixed Viewpoints)

```typescript
// src/components/3d/CameraController.tsx

const VIEWPOINTS = {
  overview:  { position: [0, 5, 10], lookAt: [0, 0, 0] },
  bookshelf: { position: [-4, 2, 3], lookAt: [-6, 1, 0] },
  fireplace: { position: [0, 2, 4],  lookAt: [0, 1, 0] },
  alchemy:   { position: [4, 2, 3],  lookAt: [6, 1, 0] },
  board:     { position: [0, 3, -3], lookAt: [0, 2, -6] },
};

// Swipe left/right cycles through viewpoints
// Camera lerps smoothly between positions using useFrame
```

### Flame Particle System

The fireplace flame visually reflects the user's Flame state:

| Flame State | Particle Intensity | Light Color | Light Radius |
|-------------|-------------------|-------------|--------------|
| BURNING (healthy) | High — many particles, bright | Warm orange #FF6B00 | Large radius |
| LIT (normal) | Medium | Amber #FFB800 | Medium |
| SPUTTERING (warning) | Low, flickering | Dim red #CC3300 | Small, unstable |
| COLD (dead) | None — embers only | Dark #331100 | Minimal glow |

**Implementation:** Custom particle component using `THREE.Points` or instanced meshes. Particle count and behavior driven by `flameStore.flameState`.

### Art Direction Notes

- **Aesthetic:** Dark dungeon. Scorn (biomechanical subtlety), Dead Cells (roguelike dungeon), Hades 2 (stylish dark), Forgive Me Father 2 (choppy frame animation charm).
- **Models:** Low-poly, hand-painted textures. Optimized for mobile (< 50k triangles total scene).
- **Animations:** Deliberately choppy/low-frame for character idle (3–6 fps animation, not smooth). This is a stylistic choice inspired by Forgive Me Father 2.
- **Lighting:** Dominant point light from fireplace. Subtle ambient fill. Fog for depth. The fireplace is literally the light source — when your Flame dies, the room gets darker.
- **Color palette:** Deep purples, dark blues, stone greys. Warm fire colors as accent. Occasional teal/cyan for UI elements and M token glow.

### Week 1 Room (Gauntlet) — Separate Scene

- **Aesthetic:** Stardew Valley / cozy. Warm, bright, inviting.
- **Models:** Wooden desk, window with sunlight streaming in, small bookshelf, potted plant, comfy chair.
- **Lighting:** Warm directional light (sunlight from window) + soft ambient.
- **Purpose:** Contrast. When the user falls into the underground, the tonal shift is dramatic and memorable.

---

## State Management

All state managed via Zustand stores in `src/stores/`.

### Store Overview

| Store | File | Responsibility |
|-------|------|---------------|
| `useUserStore` | `userStore.ts` | Wallet pubkey, display name, profile, onboarding phase |
| `useStreakStore` | `streakStore.ts` | Current streak, longest streak, savers, recovery mode |
| `useFlameStore` | `flameStore.ts` | Flame state, token buffer, burn tracking |
| `useTokenStore` | `tokenStore.ts` | M token wallet, fragments, earn/spend history |
| `useCourseStore` | `courseStore.ts` | Enrolled courses, lesson progress, active course |
| `useYieldStore` | `yieldStore.ts` | Yield accrual (mocked), forfeitures, community pot |
| `useLeaderboardStore` | `leaderboardStore.ts` | Rankings, friends, community pot status |
| `useCosmeticStore` | `cosmeticStore.ts` | Unlocked cosmetics, equipped items |
| `useSceneStore` | `sceneStore.ts` | Current 3D viewpoint, room phase (gauntlet vs underground), scene loading state |

### Persistence Strategy

- **AsyncStorage** for: streak data, token balances, lesson progress, preferences.
- **On-chain** (future): locked amounts, yield, community pot — read from Solana.
- Zustand middleware (`persist`) with AsyncStorage adapter for automatic hydration.

---

## Service Layer

### `src/services/solana/`

| Service | File | Purpose |
|---------|------|---------|
| `walletService.ts` | Wallet connection, session management, pubkey retrieval |
| `balanceService.ts` | Read USDC/USDT balances from wallet |
| `lockService.ts` | Lock/unlock fund transactions (mocked initially) |
| `yieldService.ts` | Yield calculation and tracking (mocked initially) |

### `src/services/api/`

| Service | File | Purpose |
|---------|------|---------|
| `courseService.ts` | Course catalog, lesson content fetching |
| `leaderboardService.ts` | Leaderboard data, community pot status |
| `userService.ts` | User profile CRUD, achievements |
| `answerValidationService.ts` | MCQ validation + text answer keyword matching |

---

## Project Structure

```
src/
├── components/
│   ├── common/                    # Reusable flat UI components
│   │   ├── Button.tsx
│   │   ├── Card.tsx
│   │   ├── ProgressBar.tsx
│   │   ├── Modal.tsx
│   │   └── Badge.tsx
│   ├── wallet/                    # Wallet-related components
│   │   ├── WalletButton.tsx
│   │   └── BalanceDisplay.tsx
│   ├── lesson/                    # Lesson content components
│   │   ├── ContentBlock.tsx       # Renders text/code/image/callout
│   │   ├── MCQQuestion.tsx        # Multiple choice question card
│   │   ├── TextQuestion.tsx       # Text input question
│   │   ├── CodeBlock.tsx          # Syntax highlighted code
│   │   └── LessonProgress.tsx     # Top progress bar
│   ├── flame/                     # Flame-related UI components
│   │   ├── FlameIndicator.tsx     # Flame status badge (used in headers)
│   │   ├── FlameVisual2D.tsx      # 2D animated flame for flat screens
│   │   └── TokenWallet.tsx        # M token balance display
│   ├── streak/                    # Streak UI components
│   │   ├── StreakCounter.tsx
│   │   ├── SaverInventory.tsx
│   │   └── RecoveryProgress.tsx
│   └── 3d/                        # React Three Fiber components
│       ├── scenes/
│       │   ├── GauntletRoom.tsx   # Week 1 cozy room scene
│       │   └── UndergroundRoom.tsx # Main dungeon hub scene
│       ├── objects/
│       │   ├── Bookshelf.tsx      # Interactive bookshelf model
│       │   ├── Fireplace.tsx      # Fireplace + flame particles
│       │   ├── AlchemyTable.tsx   # Interactive alchemy table model
│       │   ├── NoticeBoard.tsx    # Interactive notice board model
│       │   └── Character.tsx      # Idle character model + animation
│       ├── effects/
│       │   ├── FlameParticles.tsx # Particle system for fireplace
│       │   ├── AmbientFog.tsx     # Atmospheric fog
│       │   └── EmberGlow.tsx      # Floating ember particles
│       └── CameraController.tsx   # Fixed viewpoint camera system
├── screens/
│   ├── WalletConnectScreen.tsx
│   ├── CourseSelectionScreen.tsx
│   ├── DepositScreen.tsx
│   ├── GauntletRoomScreen.tsx     # Week 1 3D room
│   ├── UndergroundHubScreen.tsx   # Main 3D hub (post-gauntlet)
│   ├── CourseBrowserScreen.tsx    # Flat screen from bookshelf
│   ├── LessonScreen.tsx           # Lesson content + questions
│   ├── LessonResultScreen.tsx     # Post-lesson rewards/XP
│   ├── FlameDashboardScreen.tsx   # From fireplace
│   ├── AlchemyScreen.tsx          # From alchemy table
│   ├── LeaderboardScreen.tsx      # From notice board
│   └── ProfileScreen.tsx          # From character
├── navigation/
│   ├── AppNavigator.tsx           # Root navigator (auth → onboarding → main)
│   ├── AuthStack.tsx              # Wallet connect flow
│   ├── OnboardingStack.tsx        # Course selection → deposit → gauntlet
│   └── MainStack.tsx              # Hub + all post-gauntlet screens
├── stores/
│   ├── userStore.ts
│   ├── streakStore.ts
│   ├── flameStore.ts
│   ├── tokenStore.ts
│   ├── courseStore.ts
│   ├── yieldStore.ts
│   ├── leaderboardStore.ts
│   ├── cosmeticStore.ts
│   └── sceneStore.ts
├── hooks/
│   ├── useFlame.ts                # Flame state derived hooks
│   ├── useStreak.ts               # Streak logic hooks
│   ├── useDailyQuest.ts           # Daily quest completion check
│   └── useWallet.ts               # Wallet connection hooks
├── services/
│   ├── solana/
│   │   ├── walletService.ts
│   │   ├── balanceService.ts
│   │   ├── lockService.ts
│   │   └── yieldService.ts
│   └── api/
│       ├── courseService.ts
│       ├── leaderboardService.ts
│       ├── userService.ts
│       └── answerValidationService.ts
├── constants/
│   ├── colors.ts                  # Color palette (dark dungeon theme)
│   ├── flame.ts                   # Flame config (burn rate, caps, states)
│   ├── streak.ts                  # Streak config (saver penalties, etc.)
│   └── courses/                   # Course content data (JSON)
│       └── solana-web3/
│           ├── index.ts           # Course metadata
│           └── lessons/
│               ├── lesson-01.ts
│               ├── lesson-02.ts
│               └── ...
├── types/
│   ├── lesson.ts                  # Lesson, ContentBlock, Question types
│   ├── flame.ts                   # FlameState, FlameConfig types
│   ├── streak.ts                  # Streak, Saver types
│   ├── token.ts                   # MToken, Fragment types
│   ├── course.ts                  # Course, Module types
│   ├── user.ts                    # User, Profile types
│   └── scene.ts                   # Viewpoint, SceneState types
└── utils/
    ├── formatters.ts              # Address truncation, number formatting
    ├── yieldCalculator.ts         # Yield projection math
    └── fragmentReward.ts          # Variable fragment reward calculation
```

---

## Getting Started (Dev)

```bash
# Install dependencies
npm install

# Install 3D packages
npx expo install expo-gl expo-asset
npm install three @react-three/fiber @react-three/drei

# Install lesson content packages
npm install react-syntax-highlighter
npm install --save-dev @types/react-syntax-highlighter

# Start dev server
npx expo start
```

---

## Design References

| Reference | What to Take From It |
|-----------|---------------------|
| [forged.build](https://forged.build) | 3D room as navigation hub — interactive objects map to app sections |
| Scorn | Biomechanical texture subtlety, oppressive atmosphere (use sparingly) |
| Forgive Me Father 2 | Choppy low-frame animation style, hand-painted/cel-shaded aesthetic |
| Dead Cells | Dungeon roguelike vibe, dark color palette with vibrant accents |
| Noita | Creative use of resources and systems interacting |
| Hades 2 | Stylish dark aesthetic, strong UI design within dark theme |
| Stardew Valley | Week 1 gauntlet room vibe — warm, cozy, inviting |

---

## Key Design Principles

1. **The Flame is the center of everything.** Every product decision asks: "Does this make keeping the Flame alive feel natural, achievable, and worth protecting?"
2. **Consequence, not punishment.** Yield redirection is opportunity cost, not confiscation. Principal is always safe.
3. **Two rooms, two moods.** Week 1 is cozy. Post-gauntlet is dark. The fall is the narrative bridge.
4. **Choppy is charming.** Low-frame animations are a deliberate stylistic choice, not a performance issue.
5. **Financial momentum is visible.** The literal brightness of your room depends on your Flame. Consistency = light. Neglect = darkness.
