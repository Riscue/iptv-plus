# IPTV Plus

[![License][license-shield]](LICENSE.md)

[license-shield]: https://img.shields.io/github/license/Riscue/iptv-plus.svg?style=for-the-badge

[![GitHub Downloads (all assets, latest release)](https://img.shields.io/github/downloads/Riscue/iptv-plus/latest/total?label=downloads&style=for-the-badge)](https://github.com/Riscue/iptv-plus/releases)

[![GitHub Release](https://img.shields.io/github/release/Riscue/iptv-plus.svg?style=for-the-badge)](https://github.com/Riscue/iptv-plus/releases)
[![GitHub Activity](https://img.shields.io/github/commit-activity/y/Riscue/iptv-plus.svg?style=for-the-badge)](https://github.com/Riscue/iptv-plus/commits/master)

A modern IPTV player featuring advanced memory management (memory-leak-safe), seamless DVR functionality, and Smart TV
compatibility with full TV remote and keyboard support.

Pause, rewind, and return to live broadcast at any time while watching your favorite channels.

## Features

- **Hardware & Software HLS Support** - Native HLS or HLS.js playback based on device codec capabilities
- **180-Minute Continuous DVR** - Live streams are recorded to disk via FFmpeg. Rewind up to 3 hours into the past
- **Smart TV D-Pad Navigation** - Advanced matrix coordinate system for smooth navigation using keyboard arrow keys or
  TV remote control
- **VOD Filtering** - Automatically filters out VOD content (`.mp4`, `.mkv` files and movie/cinema categories) to show
  only live TV channels
- **Concurrency Protection** - Download lock architecture prevents playlist file conflicts when multiple users access
  simultaneously
- **Auto Heartbeat & Resource Saving** - When user exits, FFmpeg process stops after 5 minutes of inactivity, saving
  bandwidth and system resources
- **Favorite Channels** - Quick access slots 1-9 with long-press assignment for fast favorite management
- **Smart Watch History** - Prioritizes most-watched channels and currently recording (DVR active) channels at the top
- **Debug Panel** - Built-in debugging interface (`Ctrl/Cmd + Shift + D`) for keyboard event logging and console output

## TV Remote & Keyboard Shortcuts

### Home Page (Anasayfa)

| PC Keyboard | TV Remote    | Function                                  |
|-------------|--------------|-------------------------------------------|
| 1-9         | 1-9          | Quick jump to favorite channels           |
| Arrow Keys  | D-Pad (↑↓←→) | Navigation                                |
| Enter       | OK           | Select focused item                       |
| Escape      | Back         | Return to category / Clear search         |
| A-Z         | -            | Auto-focus search box                     |
| -           | Yellow       | Add/Remove current channel from favorites |
| -           | Green        | Resume currently recording channel        |

### Player (Oynatıcı)

| PC Keyboard      | TV Remote       | Function                                             |
|------------------|-----------------|------------------------------------------------------|
| Arrow Left/Right | D-Pad (←→)      | Seek 10s backward/forward (when UI hidden)           |
| Arrow Up/Down    | D-Pad (↑↓)      | Navigate controls OR hide/show UI (up from top)      |
| Enter            | OK              | Play/Pause OR execute planned seek (on progress bar) |
| Space            | Play/Pause      | Play/Pause                                           |
| Escape           | Back            | Return to Home page                                  |
| Page Up/Down     | Channel Up/Down | Switch to next/previous channel                      |
| F                | Yellow          | Toggle Fullscreen                                    |
| -                | Red             | Jump to 'LIVE' from rewound position                 |
| -                | Blue            | Toggle Channel List sidebar                          |

### Channel List (Kanal Listesi)

| PC Keyboard   | TV Remote  | Function                   |
|---------------|------------|----------------------------|
| Arrow Up/Down | D-Pad (↑↓) | Navigate channel list      |
| Enter         | OK         | Switch to selected channel |
| Escape        | Back       | Close channel list         |

### Debug Panel (All Pages)

| PC Keyboard          | TV Remote | Function                                    |
|----------------------|-----------|---------------------------------------------|
| Ctrl/Cmd + Shift + D | -         | Toggle debug panel (keyboard events & logs) |

## Technical Stack

- **Backend:** Node.js + Express
- **Video Processing:** FFmpeg (real-time `.ts` segmentation to buffer directory)
- **Frontend:** Vanilla JavaScript, CSS3 Glassmorphism (TV-optimized large fonts and overlay priority system)
- **Security:** Regex-protected PID validation for FFmpeg start/stop operations, zombie process cleanup

## Installation

### Running Locally (Native)

```bash
# Install dependencies
npm install

# Create .env file
echo "PLAYLIST_URL=https://playlist-url.m3u8" > .env

# Start server (FFmpeg must be installed on your system)
npm start
```

Open in browser: `http://localhost:3000`

### Running with Docker (Recommended)

Docker image automatically installs FFmpeg, ensuring OS-independent operation.

```bash
# Create .env file
cat > .env << EOF
PLAYLIST_URL=https://your-playlist-url.m3u8
TZ=Europe/Istanbul
EOF

# Build and run
docker build -f docker/Dockerfile -t iptv-plus .
docker run -d \
  -p 3000:3000 \
  --env-file .env \
  -v $(pwd)/tmp:/tmp/iptv-buffer \
  --name iptv-plus \
  iptv-plus
```

## Environment Variables

| Variable       | Required | Default          | Description                                |
|----------------|----------|------------------|--------------------------------------------|
| `PLAYLIST_URL` | Yes      | -                | Your IPTV provider's M3U8 playlist URL     |
| `BUFFER_DIR`   | No       | /tmp/iptv-buffer | Directory where FFmpeg writes stream files |
| `TZ`           | No       | Europe/Istanbul  | Application timezone                       |

## Usage

1. **Watching:** Select a category from the home page and start any channel
2. **Adding Favorites:** Long-press (1 second) on any channel box with mouse or OK button on remote
3. **Using DVR:** While in player, use remote left/right arrows or on-screen buttons to rewind and skip commercials
4. **Resource Saving:** When you close the tab, orphaned buffer segments and FFmpeg recording processes are
   automatically detected and cleaned up

## API Endpoints

| Endpoint                | Method | Description                      |
|-------------------------|--------|----------------------------------|
| `/api/channels`         | GET    | Get all channels with categories |
| `/api/categories`       | GET    | Get category list with counts    |
| `/api/channels/search`  | GET    | Search channels by name          |
| `/api/channel/current`  | GET    | Get current playing channel      |
| `/api/channel/change`   | GET    | Change channel                   |
| `/api/buffer/status`    | GET    | Get recording status             |
| `/api/buffer/heartbeat` | GET    | Update activity heartbeat        |
| `/api/buffer/stop`      | POST   | Stop recording                   |
| `/api/build-info`       | GET    | Get build version info           |

## Known Bugs

- **Focus issue on TV**: On initial launch and after exiting fullscreen, key mappings don't work until the user clicks
  somewhere on the screen to regain focus.
- **Media keys not working on TV**: Hardware media keys (play, pause, etc.) are unresponsive on TV devices.
- **Codec support**: Some video codecs are not supported, causing playback failures on certain channels.

## License

MIT © [Riscue](https://github.com/riscue)
