# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

IPTV Plus is an IPTV player with DVR (rewind up to 180 min) and Smart TV remote support.
- **Backend**: Node.js + Express. Parses the M3U8 playlist and runs FFmpeg to record the live stream to disk as HLS.
- **Frontend**: Vanilla JavaScript + HLS.js. D-Pad navigation built for TVs.
- **Runtime dependency**: `ffmpeg` and `ps` (procps) must be on PATH.

## Commands

```bash
npm install
npm run dev          # node --watch src/index.js
npm start            # node src/index.js
npm run build:info   # writes src/build-info.json from git (gitignored; /api/build-info falls back to "unknown")

docker build -f docker/Dockerfile -t iptv-plus .
docker run -d -p 3000:3000 --env-file .env -v $(pwd)/tmp:/tmp/iptv-buffer --name iptv-plus iptv-plus
```

- There are no tests, linter, or frontend build step.
- `.env` is **not** loaded automatically because there is no dotenv. Locally, export the vars yourself or run `node --env-file=.env src/index.js`.
- The port is hardcoded to 3000 in `src/index.js`.

## Environment Variables

- `PLAYLIST_URL` (required): M3U8 playlist URL from the IPTV provider
- `BUFFER_DIR` (default `/tmp/iptv-buffer`): FFmpeg HLS output, served at `/buffer/...`
- `PLAYLIST_FILE` (default `/tmp/playlist.m3u8`): local playlist cache (24h TTL)
- `TZ` (default `Europe/Istanbul`)

All tunables (buffer duration, segment length, retry, and timeouts) are in `src/constants.js`.

## Architecture

### Backend (`src/`)

`index.js` wires the routes to two static-class controllers. Their state lives in module-level variables.

- **channel-controller.js**: downloads, caches, and parses the playlist, filters out VOD, and holds `currentChannel`. Every handler calls `ensureChannels()`, which reloads the list once it is older than 24h. Downloads go through a promise singleton and are written to a `.tmp` file, then renamed into place. A failed download falls back to the stale cache, and an empty or unparseable playlist is discarded. The two controllers stay in sync through `BufferController.setOnStop()`.
- **buffer-controller.js**: owns **a single global `ffmpegProcess`**. Only one channel records at a time across the whole server, and every client shares it. Switching channels kills the previous recording.
  - FFmpeg runs `-c copy -f hls` into `{BUFFER_DIR}/{safeName}/live.m3u8` with `%08d.ts` segments. `-hls_list_size` and `delete_segments` enforce the 180-min window, and a periodic `cleanupOldSegments` acts as a backstop.
  - State changes (`changeChannel`, `stopBuffer`, and the respawn step of `autoRestart`) are serialized through `withLock()`. Internal callers that already hold the lock use `stopBufferUnlocked()`. `changeChannel` is a no-op when the target channel is already recording.
  - A `generation` counter is bumped on every spawn and stop. Exit handlers ignore any process that is no longer `ffmpegProcess`, and `autoRestart` gives up if the generation changed during its backoff.
  - Retries happen only in `autoRestart`, which runs when FFmpeg exits unexpectedly. There is no attempt cap. Backoff doubles from 1s up to `retryMaxDelay` (30s), and retries continue until the viewer has been inactive past `activityTimeoutMs`. At that point the recording is stopped cleanly. The counter resets after 30s of stable recording. FFmpeg gets `-rw_timeout` so that a stalled source exits instead of hanging forever. Auto-restarts deliberately do not call `updateActivity()`. `spawn` never throws, so startup failures always surface through this exit path. A missing binary (`ENOENT`) emits `error` without `exit`, so the `error` handler clears the state instead.
  - Inactivity auto-stop: `checkActivity` stops recording when no heartbeat has arrived for `activityTimeoutMs` (default 5 min). The player can change this through `/api/buffer/set-timeout`. `changeChannel` resets it to the default, but auto-restarts do not.
  - Shutdown: SIGTERM, then SIGKILL after `gracefulShutdownTimeout`.
- **Startup is destructive**: before `listen`, `index.js` awaits `cleanupOrphanedProcesses()`, then runs `cleanupAllBuffers()`, which deletes every channel buffer directory. DVR history does not survive a restart. Orphan detection uses `ps aux | grep 'ffmpeg.*BUFFER_DIR'`, which matches *any* process whose command line contains both strings, including shells. Keep this in mind when testing natively.
- Channel names become directory names through `getSafeName`: `[^a-zA-Z0-9ğüşıöçĞÜŞİÖÇ_-]` → `_`.

### Frontend (`views/`)

- `index.html` (home) and `player.html` load plain `<script>` tags that share globals. There are no modules and no bundler, so **script order matters**: `constants.js` → `utils.js` → `messages.js` → page script → `debug.js`. HLS.js is an exact-pinned npm dependency served by Express at `/public/vendor/hls/hls.min.js`.
- The code mostly uses ES5 style (`var`, `var self = this`). Match it.
- UI strings are Turkish (`lang="tr"`). Dynamic strings live in `messages.js`, and static labels are in the HTML. The debug panel stays English. Key codes and time constants (such as `HEARTBEAT_INTERVAL`) are in `public/js/constants.js`.
- **home.js** (`HomePage`): has a recording card, favorites (9-slot array in localStorage, `null` = empty, added with the Yellow/Red key), recents, and a categories grid. The recording card polls `/api/buffer/state`, which returns the same payload as the heartbeat (including `stopsIn`) without counting as activity. "Devam et" and the Green key go straight to `/player` and never call `/api/channel/change`, because that would restart a recording that is retrying. "Kaydı durdur" needs two presses. `handleArrowKeys()` works out the column count from element positions, so 2D navigation spans the stacked grids listed in `getVisibleGrids()`. `#recording-card-actions` is the first of those grids.
- **player.js** (`IPTVPlayer`): plays `/buffer/{safeName}/live.m3u8` with HLS.js. For DVR seeking, it maps progress bar positions to times relative to the buffer start reported by the server, and handles the discontinuity when returning to LIVE. Every 5s it sends a heartbeat to `/api/buffer/heartbeat`, which also returns `BufferController.getState()`: `state` (`idle`/`recording`/`retrying`/`failed`), `attempt`, `nextRetryIn`, and `lastError`. `lastError` is taken from FFmpeg stderr, and `formatFfmpegError()` strips URLs from it because provider URLs embed credentials. The player uses this state for the stall/loading text and for 'recording failed/stopped' errors. Server-provided text must go through `escapeHtml`, since overlays use `innerHTML`.
- **utils.js**: holds the localStorage helpers, `escapeHtml`, and `setupFullscreenFocusRestore`. TVs lose focus after exiting fullscreen, so this function restores it.
- **debug.js**: debug panel, toggled with `Ctrl/Cmd + Shift + D`.

## Known Bugs

- **TV Focus**: On first launch and after exiting fullscreen, keys don't respond until the user clicks the screen.
- **Media Keys**: Hardware play and pause keys don't work on TVs.
- **Codec Support**: Some codecs make playback fail on certain channels.

## Implementation Notes

- VOD filtering drops `.mp4` and `.mkv` URLs. It also drops categories containing "film", "movie", "vod", "sinema", or "cinema".
- The Docker build copies `.git` in to run `build:info`, then deletes it.
