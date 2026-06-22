# Lesson BGM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Play lesson-specific music on `/lessons` routes at half of the saved app music volume.

**Architecture:** Keep one app-wide `AppBgm` controller. Use the current pathname to select either the default app track or the lesson track, then derive the effective playback volume from the stored base volume and the selected track's volume scale.

**Tech Stack:** Next.js App Router, React Client Components, browser `Audio`, Vitest, React Testing Library.

---

### Task 1: Route-Aware App Music

**Files:**
- Modify: `web-app/components/appBgmSettings.ts`
- Modify: `web-app/components/AppBgm.tsx`
- Test: `web-app/__tests__/components/AppBgm.test.tsx`
- Modify: `docs/superpowers/specs/2026-06-22-app-wide-bgm-design.md`

- [x] **Step 1: Write failing AppBgm tests**

Add tests that mock `next/navigation` and verify `/lessons/sf-2` uses `/bgm/Peak_Resistance.mp3` at `storedVolume * 0.5`, while non-lesson routes use `/bgm/Midnight_in_the_Scriptorium.mp3` at full stored volume.

- [x] **Step 2: Run focused tests and verify RED**

Run: `npm test -- __tests__/components/AppBgm.test.tsx`

Expected: fails because `usePathname`, lesson track selection, and lesson volume scaling are not implemented yet.

- [x] **Step 3: Implement minimal route-aware audio**

Add constants and helpers for the lesson track. Update `AppBgm` to read `usePathname`, create audio for the current track, and apply `baseVolume * volumeScale`.

- [x] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- __tests__/components/AppBgm.test.tsx`

Expected: all AppBgm tests pass.

- [x] **Step 5: Run full verification**

Run:

```bash
npm test
npm run typecheck
npm run lint
```

Expected: all commands exit 0.
