# App-Wide BGM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move background music from the village route to a persistent app-wide component and add a dashboard volume control backed by localStorage.

**Architecture:** Create `components/AppBgm.tsx` as the only owner of the `HTMLAudioElement`. Render it once from `AppShell`, and remove the route-scoped effect from `VillageScene` to avoid duplicate audio and restarts across navigation. Share BGM storage constants/helpers with a dashboard `MusicVolumeControl`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest, React Testing Library.

---

### Task 1: Add Shared BGM Settings and Tests

**Files:**
- Create: `web-app/components/appBgmSettings.ts`
- Create: `web-app/__tests__/components/AppBgm.test.tsx`
- Create: `web-app/__tests__/components/MusicVolumeControl.test.tsx`
- Delete: `web-app/__tests__/app/village/VillageScene.test.tsx`

- [ ] **Step 1: Write focused `AppBgm` tests**

Cover mount playback, blocked-autoplay fallback, persisted volume, live volume-change events, looping, and cleanup.

- [ ] **Step 2: Run the focused test before implementation**

Run: `npm test -- __tests__/components/AppBgm.test.tsx __tests__/components/MusicVolumeControl.test.tsx`

Expected: FAIL until the setting helper and volume control exist.

### Task 2: Implement AppBgm, MusicVolumeControl, and Dashboard Wiring

**Files:**
- Create: `web-app/components/AppBgm.tsx`
- Create: `web-app/components/MusicVolumeControl.tsx`
- Modify: `web-app/components/AppShell.tsx`
- Modify: `web-app/app/dashboard/page.tsx`
- Modify: `web-app/app/village/VillageScene.tsx`

- [ ] **Step 1: Create `AppBgm`**

Use the current audio lifecycle logic with `APP_BGM_DEFAULT_VOLUME = 0.0875`, read `localStorage` on mount, and respond to volume-change events.

- [ ] **Step 2: Render `AppBgm` once from `AppShell`**

Place `<AppBgm />` in the shell fragment before the route `<main>`.

- [ ] **Step 3: Add dashboard volume control**

Render `<MusicVolumeControl />` near the bottom of the dashboard before the disconnect footer.

- [ ] **Step 4: Remove BGM logic from `VillageScene`**

Remove the `useEffect` import, BGM constants, and route-scoped audio effect.

- [ ] **Step 5: Run the focused tests**

Run: `npm test -- __tests__/components/AppBgm.test.tsx __tests__/components/MusicVolumeControl.test.tsx`

Expected: PASS.

### Task 3: Verify

**Files:**
- No file edits expected.

- [ ] **Step 1: Run full Vitest suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 3: Run lint**

Run: `npm run lint`

Expected: PASS.
