var ChannelUtils = {
    escapeHtml: function (unsafe) {
        if (typeof unsafe !== 'string') return unsafe;
        return unsafe
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    },

    getSafeName: function (name) {
        return name.replace(/[^a-zA-Z0-9ğüşıöçĞÜŞİÖÇ_-]/g, '_');
    },

    loadFavorites: function () {
        try {
            var stored = localStorage.getItem(StorageKeys.FAVORITES);
            if (stored) return JSON.parse(stored);
        } catch (e) {
        }
        return Array(UIConstants.MAX_FAVORITES).fill(null);
    },

    saveFavorites: function (favorites) {
        localStorage.setItem(StorageKeys.FAVORITES, JSON.stringify(favorites));
    },

    loadWatchHistory: function () {
        try {
            var stored = localStorage.getItem(StorageKeys.WATCH_HISTORY);
            if (stored) return JSON.parse(stored);
        } catch (e) {
        }
        return {};
    },

    saveWatchHistory: function (watchHistory) {
        localStorage.setItem(StorageKeys.WATCH_HISTORY, JSON.stringify(watchHistory));
    },

    addToWatchHistory: function (watchHistory, channelName) {
        if (!watchHistory[channelName]) {
            watchHistory[channelName] = {count: 0, lastWatched: Date.now()};
        }
        watchHistory[channelName].count++;
        watchHistory[channelName].lastWatched = Date.now();

        var keys = Object.keys(watchHistory);
        if (keys.length > UIConstants.MAX_WATCH_HISTORY) {
            var sortedKeys = keys.sort(function (a, b) {
                return watchHistory[b].lastWatched - watchHistory[a].lastWatched;
            });
            for (var i = UIConstants.MAX_WATCH_HISTORY; i < sortedKeys.length; i++) {
                delete watchHistory[sortedKeys[i]];
            }
        }

        ChannelUtils.saveWatchHistory(watchHistory);
        return watchHistory;
    },

    setupFullscreenFocusRestore: function () {
        var handler = function () {
            setTimeout(function () {
                document.body.focus();
            }, 100);
        };
        document.addEventListener('fullscreenchange', handler);
        document.addEventListener('webkitfullscreenchange', handler);
        document.addEventListener('mozfullscreenchange', handler);
        document.addEventListener('MSFullscreenChange', handler);
    },

    formatTime: function (seconds) {
        if (!seconds || isNaN(seconds)) return '0:00';
        var mins = Math.floor(seconds / 60);
        var secs = Math.floor(seconds % 60);
        return mins + ':' + (secs < 10 ? '0' : '') + secs;
    },
};
