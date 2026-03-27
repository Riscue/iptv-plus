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
    }
};
