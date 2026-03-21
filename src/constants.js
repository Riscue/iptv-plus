const path = require('path');

module.exports = {
    // M3U8 Playlist
    playlistUrl: process.env.PLAYLIST_URL || "https://example.com/playlist.m3u8",
    playlistFile: process.env.PLAYLIST_FILE || "/tmp/playlist.m3u8",

    // Buffer / DVR - absolute path
    bufferDir: process.env.BUFFER_DIR || path.join(__dirname, '../../tmp/iptv-buffer'),
    bufferDurationMinutes: 180, // 3 saat

    // Server
    port: process.env.PORT || 3000,

    // Segment settings
    segmentDuration: 5, // seconds
    maxRetries: 3
};
