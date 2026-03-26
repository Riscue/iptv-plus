class HomePage {
    static escapeHtml(unsafe) {
        if (typeof unsafe !== 'string') return unsafe;
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    constructor() {
        this.categories = [];
        this.channels = [];
        this.currentCategory = null;
        this.favorites = this.loadFavorites();
        this.searchTimeout = null;
        this.watchHistory = this.loadWatchHistory();
        this.currentRecording = null;

        this.init();
    }

    async init() {
        await this.loadData();
        await this.loadBufferStatus();
        this.setupKeyboardEvents();
        this.setupSearch();
        this.setupNavigation();
        this.setupPageShowHandler();
        this.setupFullscreenFocusRestore();
        this.renderFavorites();
        this.renderRecent();
        this.renderCategories();
    }

    setupPageShowHandler() {
        var self = this;
        window.addEventListener('pageshow', async function (e) {
            await self.loadBufferStatus();
            self.renderRecent();

            if (e.persisted) {
                self.loadData();
            }

            setTimeout(function () {
                var active = document.activeElement;
                if (!active || active === document.body || !document.body.contains(active)) {
                    var firstItem = document.querySelector('.favorite-item:not(.empty), .recent-item, .category-item');
                    if (firstItem) {
                        firstItem.focus();
                    }
                }
            }, 100);
        });
    }

    setupFullscreenFocusRestore() {
        var handler = function () {
            setTimeout(function () {
                document.body.focus();
            }, 100);
        };
        document.addEventListener('fullscreenchange', handler);
        document.addEventListener('webkitfullscreenchange', handler);
        document.addEventListener('mozfullscreenchange', handler);
        document.addEventListener('MSFullscreenChange', handler);
    }

    async loadData() {
        try {
            var res = await fetch('/api/channels');
            var data = await res.json();
            this.channels = data.channels || [];

            var catRes = await fetch('/api/categories');
            var catData = await catRes.json();
            this.categories = catData.categories || [];

            console.log('Loaded ' + this.channels.length + ' channels, ' + this.categories.length + ' categories');
        } catch (err) {
            console.error('Failed to load data:', err);
        }
    }

    async loadBufferStatus() {
        try {
            var res = await fetch('/api/buffer/status');
            var data = await res.json();
            if (data.isRecording && data.currentChannel) {
                this.currentRecording = this.channels.find(function (ch) {
                    return ch.name === data.currentChannel;
                });
            } else {
                this.currentRecording = null;
            }
        } catch (err) {
            this.currentRecording = null;
        }
    }

    loadFavorites() {
        var stored = localStorage.getItem(StorageKeys.FAVORITES);
        if (stored) {
            try {
                return JSON.parse(stored);
            } catch (e) {
                console.error('Failed to parse favorites:', e);
            }
        }
        return Array(UIConstants.MAX_FAVORITES).fill(null);
    }

    saveFavorites() {
        localStorage.setItem(StorageKeys.FAVORITES, JSON.stringify(this.favorites));
    }

    loadWatchHistory() {
        try {
            var stored = localStorage.getItem(StorageKeys.WATCH_HISTORY);
            if (stored) {
                return JSON.parse(stored);
            }
        } catch (e) {
        }
        return {};
    }

    saveWatchHistory() {
        localStorage.setItem(StorageKeys.WATCH_HISTORY, JSON.stringify(this.watchHistory));
    }

    addToWatchHistory(channel) {
        if (!this.watchHistory[channel.name]) {
            this.watchHistory[channel.name] = {count: 0, lastWatched: Date.now()};
        }
        this.watchHistory[channel.name].count++;
        this.watchHistory[channel.name].lastWatched = Date.now();

        var keys = Object.keys(this.watchHistory);
        if (keys.length > UIConstants.MAX_WATCH_HISTORY) {
            var self = this;
            var sortedKeys = keys.sort(function (a, b) {
                return self.watchHistory[b].lastWatched - self.watchHistory[a].lastWatched;
            });
            for (var i = UIConstants.MAX_WATCH_HISTORY; i < sortedKeys.length; i++) {
                delete this.watchHistory[sortedKeys[i]];
            }
        }

        this.saveWatchHistory();
        this.renderRecent();
    }

    addToFavorites(channel) {
        var emptyIndex = this.favorites.indexOf(null);
        if (emptyIndex === -1) {
            var existingIndex = this.favorites.findIndex(function (f) {
                return f && f.name === channel.name;
            });
            if (existingIndex !== -1) {
                this.favorites[existingIndex] = null;
                this.showNotification(Messages.REMOVED_FROM_FAVORITES);
                this.saveFavorites();
                this.renderFavorites();
                return;
            } else {
                this.showNotification(Messages.FAVORITE_SLOTS_FULL);
                return;
            }
        }

        this.favorites[emptyIndex] = channel;
        this.saveFavorites();
        this.renderFavorites();
        this.showNotification(Messages.ADDED_TO_FAVORITES);
    }

    showNotification(message) {
        var notification = document.createElement('div');
        notification.className = 'notification';
        notification.textContent = message;
        notification.style.cssText = 'position: fixed; bottom: 100px; left: 50%; transform: translateX(-50%); background: rgba(0, 212, 255, 0.9); color: #fff; padding: 12px 24px; border-radius: 8px; z-index: 10000; font-weight: 500;';
        document.body.appendChild(notification);

        setTimeout(function () {
            notification.remove();
        }, 2000);
    }

    renderFavorites() {
        var grid = document.getElementById('favorites-grid');
        if (!grid) return;

        grid.innerHTML = '';
        var self = this;

        for (var i = 0; i < 9; i++) {
            var channel = this.favorites[i];
            var div = document.createElement('div');
            div.className = 'favorite-item';
            div.dataset.index = i;

            if (channel) {
                div.innerHTML = '<span class="dial-number">' + (i + 1) + '</span>' + '<span class="channel-name">' + HomePage.escapeHtml(channel.name) + '</span>';
                div.tabIndex = 0;
            } else {
                div.className = 'favorite-item empty';
                div.innerHTML = '<span class="dial-number">' + (i + 1) + '</span>';
            }

            grid.appendChild(div);
        }

        grid.onclick = function (e) {
            var item = e.target.closest('.favorite-item');
            if (item && !item.classList.contains('empty')) {
                var index = parseInt(item.dataset.index);
                if (self.favorites[index]) {
                    self.playChannel(self.favorites[index]);
                }
            }
        };

        grid.onkeydown = function (e) {
            if (e.key === PCKeyCodes.ENTER) {
                var item = e.target.closest('.favorite-item');
                if (item && !item.classList.contains('empty')) {
                    var index = parseInt(item.dataset.index);
                    if (self.favorites[index]) {
                        self.playChannel(self.favorites[index]);
                    }
                }
            }
        };
    }

    renderRecent() {
        var grid = document.getElementById('recent-grid');
        if (!grid) return;

        var self = this;

        var sortedChannels = Object.keys(this.watchHistory)
            .map(function (name) {
                var channel = self.channels.find(function (ch) {
                    return ch.name === name;
                });
                if (!channel) return null;
                return {
                    name: name,
                    count: self.watchHistory[name].count,
                    lastWatched: self.watchHistory[name].lastWatched,
                    channel: channel
                };
            })
            .filter(function (item) {
                return item !== null;
            })
            .sort(function (a, b) {
                return b.lastWatched - a.lastWatched;
            })
            .slice(0, UIConstants.MAX_WATCH_HISTORY);

        if (this.currentRecording) {
            var existingIndex = sortedChannels.findIndex(function (item) {
                return item.name === self.currentRecording.name;
            });
            var recordingItem;
            if (existingIndex !== -1) {
                recordingItem = sortedChannels.splice(existingIndex, 1)[0];
            } else {
                recordingItem = {
                    name: this.currentRecording.name, count: 0, lastWatched: Date.now(), channel: this.currentRecording
                };
            }
            sortedChannels.unshift(recordingItem);
            sortedChannels = sortedChannels.slice(0, UIConstants.MAX_WATCH_HISTORY);
        }

        if (sortedChannels.length === 0) {
            grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: #666; padding: 20px;">' + Messages.NO_CHANNELS_WATCHED + '</div>';
            return;
        }

        grid.innerHTML = sortedChannels.map(function (item) {
            var globalIndex = self.channels.indexOf(item.channel);
            var isRecording = self.currentRecording && item.name === self.currentRecording.name;
            var timeStr = new Date(item.lastWatched).toLocaleTimeString('tr-TR', {hour: '2-digit', minute: '2-digit'});
            var recordingBadge = isRecording ? '<div class="recording-badge">' + Messages.RECORDING + '</div>' : '<div class="watch-count">' + Messages.TIME_PREFIX + ' ' + timeStr + '</div>';
            return '<div class="recent-item' + (isRecording ? ' recording' : '') + '" data-index="' + globalIndex + '" data-recording="' + isRecording + '" tabindex="0">' + '<div class="channel-name">' + HomePage.escapeHtml(item.name) + '</div>' + recordingBadge + '</div>';
        }).join('');

        grid.onclick = function (e) {
            var item = e.target.closest('.recent-item');
            if (item) {
                var index = parseInt(item.dataset.index);
                var isRecording = item.dataset.recording === 'true';
                if (isRecording) {
                    self.resumeChannel(self.channels[index]);
                } else {
                    self.playChannel(self.channels[index]);
                }
            }
        };

        grid.onkeydown = function (e) {
            if (e.key === PCKeyCodes.ENTER) {
                var item = e.target.closest('.recent-item');
                if (item) {
                    var index = parseInt(item.dataset.index);
                    var isRecording = item.dataset.recording === 'true';
                    if (isRecording) {
                        self.resumeChannel(self.channels[index]);
                    } else {
                        self.playChannel(self.channels[index]);
                    }
                }
            }
        };
    }

    renderCategories() {
        var grid = document.getElementById('categories-grid');
        if (!grid) return;

        var self = this;

        grid.innerHTML = this.categories.map(function (cat) {
            return '<div class="category-item" data-category="' + HomePage.escapeHtml(cat.name) + '" tabindex="0">' + '<div class="category-name">' + HomePage.escapeHtml(cat.name) + '</div>' + '<div class="category-count">' + cat.count + ' channels</div>' + '</div>';
        }).join('');

        grid.onclick = function (e) {
            var item = e.target.closest('.category-item');
            if (item) {
                var category = item.dataset.category;
                self.showCategory(category);
            }
        };

        grid.onkeydown = function (e) {
            if (e.key === PCKeyCodes.ENTER) {
                var item = e.target.closest('.category-item');
                if (item) {
                    var category = item.dataset.category;
                    self.showCategory(category);
                }
            }
        };
    }

    showCategory(categoryName) {
        this.currentCategory = categoryName;
        var catChannels = this.channels.filter(function (ch) {
            return ch.category === categoryName;
        });

        document.getElementById('categories-view').classList.add('hidden');
        document.getElementById('channels-view').classList.remove('hidden');
        document.getElementById('back-nav').classList.remove('hidden');
        document.getElementById('current-category-name').textContent = categoryName;
        document.getElementById('channels-title').textContent = categoryName + ' - Channels';

        this.renderChannels(catChannels);

        setTimeout(function () {
            var firstChannel = document.querySelector('.channel-item');
            if (firstChannel) firstChannel.focus();
        }, 50);
    }

    showCategoriesView() {
        var categoryName = this.currentCategory;
        var input = document.getElementById('search-input');
        var wasInSearch = document.activeElement === input;

        this.currentCategory = null;
        document.getElementById('categories-view').classList.remove('hidden');
        document.getElementById('channels-view').classList.add('hidden');
        document.getElementById('back-nav').classList.add('hidden');

        if (wasInSearch) {
            return;
        }

        setTimeout(function () {
            var categoryItems = Array.from(document.querySelectorAll('.category-item'));
            var targetCategory = categoryItems.find(function (el) {
                return el.dataset.category === categoryName;
            });
            if (targetCategory) {
                targetCategory.focus();
                targetCategory.scrollIntoView({behavior: 'smooth', block: 'center'});
            } else if (categoryItems.length > 0) {
                categoryItems[0].focus();
            }
        }, 50);
    }

    renderChannels(channelsList) {
        var grid = document.getElementById('channels-grid');
        if (!grid) return;

        var channels = channelsList || this.channels;
        var self = this;

        grid.innerHTML = channels.map(function (ch) {
            var globalIndex = self.channels.indexOf(ch);
            return '<div class="channel-item" data-index="' + globalIndex + '" tabindex="0">' + '<div class="channel-name">' + HomePage.escapeHtml(ch.name) + '</div>' + '</div>';
        }).join('');

        grid.onclick = function (e) {
            var item = e.target.closest('.channel-item');
            if (item) {
                var index = parseInt(item.dataset.index);
                self.playChannel(self.channels[index]);
            }
        };

        grid.onkeydown = function (e) {
            if (e.key === PCKeyCodes.ENTER) {
                var item = e.target.closest('.channel-item');
                if (item) {
                    var index = parseInt(item.dataset.index);
                    self.playChannel(self.channels[index]);
                }
            }
        };
    }

    setupNavigation() {
        var self = this;
        var btnBack = document.getElementById('btn-back');
        if (btnBack) {
            btnBack.addEventListener('click', function () {
                self.showCategoriesView();
            });
        }
    }

    setupSearch() {
        var self = this;
        var input = document.getElementById('search-input');
        if (!input) return;

        input.addEventListener('input', function () {
            clearTimeout(self.searchTimeout);
            self.searchTimeout = setTimeout(function () {
                self.performSearch(input.value);
            }, UIConstants.SEARCH_DEBOUNCE);
        });
    }

    performSearch(query) {
        if (!query || query.length < 2) {
            this.showCategoriesView();
            return;
        }

        var self = this;
        var filtered = this.channels.filter(function (ch) {
            return ch.name.toLowerCase().indexOf(query.toLowerCase()) !== -1;
        });

        document.getElementById('categories-view').classList.add('hidden');
        document.getElementById('channels-view').classList.remove('hidden');
        document.getElementById('back-nav').classList.remove('hidden');
        document.getElementById('current-category-name').textContent = Messages.SEARCH_PREFIX + ' ' + query;
        document.getElementById('channels-title').textContent = Messages.SEARCH_RESULTS;

        this.renderChannels(filtered.slice(0, 100));
    }

    setupKeyboardEvents() {
        var self = this;
        var input = document.getElementById('search-input');

        document.addEventListener('keydown', function (e) {
            if (e.key >= '1' && e.key <= '9') {
                var idx = parseInt(e.key) - 1;
                if (self.favorites[idx]) {
                    if (!(document.activeElement === input && input.value.length > 0)) {
                        e.preventDefault();
                        self.playChannel(self.favorites[idx]);
                    }
                }
                return;
            }

            if (e.key === PCKeyCodes.ESCAPE || e.keyCode === TVKeyCodes.BACK) {
                if (self.currentCategory) {
                    self.showCategoriesView();
                } else if (document.activeElement === input) {
                    input.value = '';
                    input.blur();
                }
                return;
            }

            if ((e.key === PCKeyCodes.ENTER || e.key === PCKeyCodes.OK) && document.activeElement === input) {
                e.preventDefault();
                if (input.value.length >= 2) {
                    var firstChannel = document.querySelector('.channel-item');
                    if (firstChannel) {
                        firstChannel.focus();
                        firstChannel.scrollIntoView({behavior: 'smooth', block: 'center'});
                    }
                } else {
                    input.blur();
                }
                return;
            }

            if (e.keyCode === 404) {
                e.preventDefault();
                var recordingEl = document.querySelector('.recent-item.recording');
                if (recordingEl) {
                    recordingEl.click();
                }
                return;
            }

            if (e.keyCode === 403 || e.keyCode === 405) {
                e.preventDefault();
                var active = document.activeElement;
                var channel = null;

                if (active.classList.contains('favorite-item') && !active.classList.contains('empty')) {
                    var index = parseInt(active.dataset.index);
                    self.favorites[index] = null;
                    self.saveFavorites();
                    self.renderFavorites();
                    self.showNotification(Messages.REMOVED_FROM_FAVORITES);
                } else if (active.classList.contains('recent-item') || active.classList.contains('channel-item')) {
                    var index = parseInt(active.dataset.index);
                    channel = self.channels[index];
                    if (channel) {
                        self.addToFavorites(channel);
                    }
                }

                if (active) {
                    active.focus();
                }
                return;
            }

            if (document.activeElement !== input && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
                var code = e.key.charCodeAt(0);
                if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) {
                    input.focus();
                    return;
                }
            }

            if (e.key === PCKeyCodes.ARROW_UP || e.key === PCKeyCodes.ARROW_DOWN || e.key === PCKeyCodes.ARROW_LEFT || e.key === PCKeyCodes.ARROW_RIGHT) {
                if (document.activeElement === input) {
                    if (e.key === PCKeyCodes.ARROW_DOWN) {
                        e.preventDefault();
                        if (input.value.length >= 2) {
                            var firstChannel = document.querySelector('.channel-item');
                            if (firstChannel) {
                                firstChannel.focus();
                                firstChannel.scrollIntoView({behavior: 'smooth', block: 'center'});
                            }
                        } else {
                            var firstFavorite = document.querySelector('.favorite-item:not(.empty)');
                            if (firstFavorite) {
                                firstFavorite.focus();
                                firstFavorite.scrollIntoView({behavior: 'smooth', block: 'center'});
                            }
                        }
                    }
                    return;
                }

                e.preventDefault();
                var current = document.activeElement;

                if (current.tagName === 'BODY' || !current.matches('.favorite-item:not(.empty), .recent-item, .category-item, .channel-item')) {
                    var firstItem = document.querySelector('.favorite-item:not(.empty), .recent-item, .category-item, .channel-item');
                    if (firstItem) {
                        firstItem.focus();
                        firstItem.scrollIntoView({behavior: 'smooth', block: 'center'});
                    }
                    return;
                }

                var grids = ['#favorites-grid', '#recent-grid', '#categories-grid', '#channels-grid']
                    .map(function (id) {
                        return document.querySelector(id);
                    })
                    .filter(function (g) {
                        return g && g.offsetParent !== null;
                    });

                var grid = current.closest('#favorites-grid, #recent-grid, #categories-grid, #channels-grid');
                if (!grid) return;

                var gridIdx = grids.indexOf(grid);
                if (gridIdx === -1) return;

                var items = Array.from(grid.children).filter(function (el) {
                    return !el.classList.contains('empty') && el.offsetParent !== null;
                });
                var idx = items.indexOf(current);
                if (idx === -1) return;

                var firstY = items[0].getBoundingClientRect().top;
                var cols = 0;
                for (var i = 0; i < items.length; i++) {
                    if (Math.abs(items[i].getBoundingClientRect().top - firstY) < 10) cols++; else break;
                }
                if (cols === 0) cols = 3;

                var row = Math.floor(idx / cols);
                var col = idx % cols;
                var target = idx;
                var targetGrid = null;

                if (e.key === PCKeyCodes.ARROW_RIGHT) {
                    if (col < cols - 1 && idx + 1 < items.length) target = idx + 1;
                } else if (e.key === PCKeyCodes.ARROW_LEFT) {
                    if (col > 0) target = idx - 1;
                } else if (e.key === PCKeyCodes.ARROW_DOWN) {
                    target = idx + cols;
                    if (target >= items.length) {
                        if (gridIdx < grids.length - 1) {
                            var searchGridIdx = gridIdx + 1;
                            while (searchGridIdx < grids.length) {
                                targetGrid = grids[searchGridIdx];
                                var nextItems = Array.from(targetGrid.children).filter(function (el) {
                                    return !el.classList.contains('empty') && el.offsetParent !== null;
                                });
                                if (nextItems.length > 0) {
                                    if (searchGridIdx === 1) {
                                        target = 0;
                                    } else {
                                        target = Math.min(col, nextItems.length - 1);
                                    }
                                    break;
                                }
                                searchGridIdx++;
                            }
                            if (searchGridIdx >= grids.length) {
                                target = idx;
                            }
                        } else target = idx;
                    }
                } else if (e.key === PCKeyCodes.ARROW_UP) {
                    if (row > 0) {
                        target = idx - cols;
                    } else if (gridIdx === 0) {
                        input.focus();
                        return;
                    } else if (gridIdx > 0) {
                        var searchGridIdx = gridIdx - 1;
                        while (searchGridIdx >= 0) {
                            targetGrid = grids[searchGridIdx];
                            var prevItems = Array.from(targetGrid.children).filter(function (el) {
                                return !el.classList.contains('empty') && el.offsetParent !== null;
                            });
                            if (prevItems.length > 0) {
                                var pFirstY = prevItems[0].getBoundingClientRect().top;
                                var pCols = 0;
                                for (var i = 0; i < prevItems.length; i++) {
                                    if (Math.abs(prevItems[i].getBoundingClientRect().top - pFirstY) < 10) pCols++; else break;
                                }
                                var pRows = Math.ceil(prevItems.length / pCols);
                                var pRowStart = (pRows - 1) * pCols;
                                target = Math.min(pRowStart + col, prevItems.length - 1);
                                break;
                            }
                            searchGridIdx--;
                        }
                        if (searchGridIdx < 0) {
                            var searchInput = document.getElementById('search-input');
                            if (searchInput) {
                                searchInput.focus();
                                return;
                            }
                            target = idx;
                        }
                    }
                }

                if (targetGrid) {
                    var tItems = Array.from(targetGrid.children).filter(function (el) {
                        return !el.classList.contains('empty') && el.offsetParent !== null;
                    });
                    if (target >= 0 && target < tItems.length) {
                        tItems[target].focus();
                        tItems[target].scrollIntoView({behavior: 'smooth', block: 'center'});
                    }
                } else if (target !== idx && target >= 0 && target < items.length) {
                    items[target].focus();
                    items[target].scrollIntoView({behavior: 'smooth', block: 'nearest'});
                }
                return;
            }

            if (e.key === PCKeyCodes.ENTER || e.key === PCKeyCodes.OK) {
                if (document.activeElement.tagName !== 'INPUT') {
                    e.preventDefault();
                    document.activeElement.click();
                }
            }
        });
    }

    resumeChannel(channel) {
        console.log('Resuming channel:', channel.name, '(keeping recording alive)');
        this.addToWatchHistory(channel);
        window.location.href = '/player';
    }

    playChannel(channel) {
        var self = this;
        var index = this.channels.findIndex(function (ch) {
            return ch.name === channel.name;
        });

        if (index !== -1) {
            console.log('Playing channel:', channel.name, 'at index:', index);
            fetch('/api/channel/change?index=' + index)
                .then(function (response) {
                    console.log('Channel change response:', response.status);
                    return response.json();
                })
                .then(function () {
                    self.addToWatchHistory(self.channels[index]);
                    window.location.href = '/player';
                })
                .catch(function (err) {
                    console.error('Failed to change channel:', err);
                });
        } else {
            console.error('Channel not found:', channel.name);
        }
    }
}

document.addEventListener('DOMContentLoaded', function () {
    window.homePage = new HomePage();
});
