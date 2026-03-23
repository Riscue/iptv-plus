const path = require('path');

module.exports = {
    playlistUrl: process.env.PLAYLIST_URL || "https://example.com/playlist.m3u8",
    playlistFile: process.env.PLAYLIST_FILE || "/tmp/playlist.m3u8",

    bufferDir: process.env.BUFFER_DIR || "/tmp/iptv-buffer",
    bufferDurationMinutes: 180,

    segmentDuration: 5,
    maxRetries: 3
};
