module.exports = {
    playlistUrl: process.env.PLAYLIST_URL || "https://example.com/playlist.m3u8",
    playlistFile: process.env.PLAYLIST_FILE || "/tmp/playlist.m3u8",
    playlistCacheDuration: 24 * 60 * 60 * 1000,

    bufferDir: process.env.BUFFER_DIR || "/tmp/iptv-buffer",
    bufferDurationMinutes: 180,

    segmentDuration: 5,
    maxRetries: 3,
    retryBaseDelay: 1000,

    activityTimeout: 300000,
    activityCheckInterval: 30000,
    cleanupInterval: 5 * 60 * 1000,

    gracefulShutdownTimeout: 2000,
    forceKillTimeout: 500,
    forceRecoveryTimeout: 1000,
};
