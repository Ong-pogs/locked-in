# App-Wide BGM Design

## Goal

Play `web-app/public/bgm/Midnight_in_the_Scriptorium.mp3` as looping background music across the whole app.

## Scope

- Use the public asset URL `/bgm/Midnight_in_the_Scriptorium.mp3`.
- Play one persistent audio instance from the app shell, not from `/village`.
- Keep playback at `0.0875` volume, which is 50% quieter than the previous `0.175` setting.
- Add a dashboard-only music volume control.
- Persist the selected music volume in `localStorage`.
- Apply dashboard volume changes to the already-mounted app-wide audio immediately.
- Attempt playback as soon as the app shell mounts.
- If the browser blocks audible autoplay, start playback on the first pointer or keyboard gesture.
- Stop and clean up the audio when the app shell unmounts.

## Architecture

Create a small `AppBgm` Client Component that owns the audio lifecycle. Render it once from `AppShell`, which is already mounted by the root layout and persists across normal App Router navigation. Remove the route-scoped BGM effect from `VillageScene` so route changes do not create duplicate audio instances or restart the track.

Keep BGM setting constants and `localStorage` helpers in a shared module. `AppBgm` reads the saved volume on mount and listens for a browser event when the dashboard writes a new value. The dashboard renders a compact `MusicVolumeControl` card near the bottom of the page.

## Error Handling

Autoplay failures are expected browser behavior. `AppBgm` catches `play()` rejections and installs one-time gesture listeners. Load or playback errors do not block route rendering.

## Testing

Add focused Vitest coverage for `AppBgm`:

- creates the audio element with the public asset URL;
- sets loop mode and `0.0875` volume;
- reads persisted volume from `localStorage`;
- responds to live volume-change events;
- attempts playback on mount;
- retries on first user gesture when autoplay is blocked;
- pauses and removes fallback listeners on unmount.

Add focused Vitest coverage for `MusicVolumeControl`:

- initializes from the default or stored volume;
- writes the changed value to `localStorage`;
- dispatches the app-wide volume-change event.

Run the full web-app Vitest suite, typecheck, and lint after the move.

## Approval

User approved moving BGM app-wide and lowering volume by another 50% on 2026-06-22.
