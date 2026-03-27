class HomePage {
    constructor() {
        this.categories = [];
        this.channels = [];
        this.currentCategory = null;
        this.favorites = ChannelUtils.loadFavorites();
        this.searchTimeout = null;
        this.watchHistory = ChannelUtils.loadWatchHistory();
        this.currentRecording = null;

        this.els = {
            contentLoading: document.getElementById('content-loading'),
            favorites: document.getElementById('favorites'),
            recent: document.getElementById('recent'),
            categoriesView: document.getElementById('categories-view'),
            channelsView: document.getElementById('channels-view'),
            favoritesGrid: document.getElementById('favorites-grid'),
            recentGrid: document.getElementById('recent-grid'),
            categoriesGrid: document.getElementById('categories-grid'),
            channelsGrid: document.getElementById('channels-grid'),
            backNav: document.getElementById('back-nav'),
            currentCategoryName: document.getElementById('current-category-name'),
            channelsTitle: document.getElementById('channels-title'),
            searchInput: document.getElementById('search-input'),
            btnBack: document.getElementById('btn-back')
        };

        this.init();
    }

    async init() {
        this.showLoading();
        await this.loadData();
        await this.loadBufferStatus();
        this.hideLoading();
        this.setupKeyboardEvents();
        this.setupSearch();
        this.setupNavigation();
        this.setupPageShowHandler();
        this.setupFullscreenFocusRestore();
        this.renderFavorites();
        this.renderRecent();
        this.renderCategories();
    }

    showLoading() {
        if (this.els.contentLoading) this.els.contentLoading.classList.remove('hidden');
    }

    hideLoading() {
        if (this.els.contentLoading) this.els.contentLoading.classList.add('hidden');

        this.els.favorites.classList.remove('hidden');
        this.els.recent.classList.remove('hidden');
        this.els.categoriesView.classList.remove('hidden');
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
        ChannelUtils.setupFullscreenFocusRestore();
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

    addToWatchHistory(channel) {
        this.watchHistory = ChannelUtils.addToWatchHistory(this.watchHistory, channel.name);
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
                ChannelUtils.saveFavorites(this.favorites);
                this.renderFavorites();
                return;
            } else {
                this.showNotification(Messages.FAVORITE_SLOTS_FULL);
                return;
            }
        }

        this.favorites[emptyIndex] = channel;
        ChannelUtils.saveFavorites(this.favorites);
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
        var grid = this.els.favoritesGrid;
        if (!grid) return;

        grid.innerHTML = '';
        var self = this;

        for (var i = 0; i < 9; i++) {
            var channel = this.favorites[i];
            var div = document.createElement('div');
            div.className = 'favorite-item';
            div.dataset.index = i;

            if (channel) {
                div.innerHTML = '<span class="dial-number">' + (i + 1) + '</span>' + '<span class="channel-name">' + ChannelUtils.escapeHtml(channel.name) + '</span>';
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
        var grid = this.els.recentGrid;
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
            var timeStr = new Date(item.lastWatched).toLocaleTimeString('en-US', {hour: '2-digit', minute: '2-digit'});
            var recordingBadge = isRecording ? '<div class="recording-badge">' + Messages.RECORDING + '</div>' : '<div class="watch-count">' + Messages.TIME_PREFIX + ' ' + timeStr + '</div>';
            return '<div class="recent-item' + (isRecording ? ' recording' : '') + '" data-index="' + globalIndex + '" data-recording="' + isRecording + '" tabindex="0">' + '<div class="channel-name">' + ChannelUtils.escapeHtml(item.name) + '</div>' + recordingBadge + '</div>';
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
        var grid = this.els.categoriesGrid;
        if (!grid) return;

        var self = this;

        grid.innerHTML = this.categories.map(function (cat) {
            return '<div class="category-item" data-category="' + ChannelUtils.escapeHtml(cat.name) + '" tabindex="0">' + '<div class="category-name">' + ChannelUtils.escapeHtml(cat.name) + '</div>' + '<div class="category-count">' + cat.count + ' channels</div>' + '</div>';
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

        this.els.categoriesView.classList.add('hidden');
        this.els.channelsView.classList.remove('hidden');
        this.els.backNav.classList.remove('hidden');
        this.els.currentCategoryName.textContent = categoryName;
        this.els.channelsTitle.textContent = categoryName + ' - Channels';

        this.renderChannels(catChannels);

        setTimeout(function () {
            var firstChannel = document.querySelector('.channel-item');
            if (firstChannel) firstChannel.focus();
        }, 50);
    }

    showCategoriesView() {
        var categoryName = this.currentCategory;
        var wasInSearch = document.activeElement === this.els.searchInput;

        this.currentCategory = null;
        this.els.categoriesView.classList.remove('hidden');
        this.els.channelsView.classList.add('hidden');
        this.els.backNav.classList.add('hidden');

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
        var grid = this.els.channelsGrid;
        if (!grid) return;

        var channels = channelsList || this.channels;
        var self = this;

        grid.innerHTML = channels.map(function (ch) {
            var globalIndex = self.channels.indexOf(ch);
            return '<div class="channel-item" data-index="' + globalIndex + '" tabindex="0">' + '<div class="channel-name">' + ChannelUtils.escapeHtml(ch.name) + '</div>' + '</div>';
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
        if (this.els.btnBack) {
            this.els.btnBack.addEventListener('click', function () {
                self.showCategoriesView();
            });
        }
    }

    setupSearch() {
        var self = this;
        if (!this.els.searchInput) return;

        this.els.searchInput.addEventListener('input', function () {
            clearTimeout(self.searchTimeout);
            self.searchTimeout = setTimeout(function () {
                self.performSearch(self.els.searchInput.value);
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

        this.els.categoriesView.classList.add('hidden');
        this.els.channelsView.classList.remove('hidden');
        this.els.backNav.classList.remove('hidden');
        this.els.currentCategoryName.textContent = Messages.SEARCH_PREFIX + ' ' + query;
        this.els.channelsTitle.textContent = Messages.SEARCH_RESULTS;

        this.renderChannels(filtered.slice(0, 100));
    }

    setupKeyboardEvents() {
        var self = this;
        document.addEventListener('keydown', function (e) {
            if (self.handleDigitKey(e)) return;
            if (self.handleBackKey(e)) return;
            if (self.handleSearchEnter(e)) return;
            if (self.handleColorKeys(e)) return;
            if (self.handleLetterToSearch(e)) return;
            if (self.handleArrowKeys(e)) return;
            if (self.handleEnterKey(e)) return;
        });
    }

    handleDigitKey(e) {
        if (e.key < '1' || e.key > '9') return false;
        var idx = parseInt(e.key) - 1;
        if (this.favorites[idx] && !(document.activeElement === this.els.searchInput && this.els.searchInput.value.length > 0)) {
            e.preventDefault();
            this.playChannel(this.favorites[idx]);
        }
        return true;
    }

    handleBackKey(e) {
        if (e.key !== PCKeyCodes.ESCAPE && e.keyCode !== TVKeyCodes.BACK) return false;
        if (this.currentCategory) {
            this.showCategoriesView();
        } else if (document.activeElement === this.els.searchInput) {
            this.els.searchInput.value = '';
            this.els.searchInput.blur();
        }
        return true;
    }

    handleSearchEnter(e) {
        if (e.key !== PCKeyCodes.ENTER && e.key !== PCKeyCodes.OK) return false;
        if (document.activeElement !== this.els.searchInput) return false;
        e.preventDefault();
        if (this.els.searchInput.value.length >= 2) {
            var firstChannel = document.querySelector('.channel-item');
            if (firstChannel) {
                firstChannel.focus();
                firstChannel.scrollIntoView({behavior: 'smooth', block: 'center'});
            }
        } else {
            this.els.searchInput.blur();
        }
        return true;
    }

    handleColorKeys(e) {
        if (e.keyCode === TVKeyCodes.GREEN) {
            e.preventDefault();
            var recordingEl = document.querySelector('.recent-item.recording');
            if (recordingEl) recordingEl.click();
            return true;
        }

        if (e.keyCode === TVKeyCodes.RED || e.keyCode === TVKeyCodes.YELLOW) {
            e.preventDefault();
            var active = document.activeElement;
            if (active.classList.contains('favorite-item') && !active.classList.contains('empty')) {
                var index = parseInt(active.dataset.index);
                this.favorites[index] = null;
                ChannelUtils.saveFavorites(this.favorites);
                this.renderFavorites();
                this.showNotification(Messages.REMOVED_FROM_FAVORITES);
            } else if (active.classList.contains('recent-item') || active.classList.contains('channel-item')) {
                var index = parseInt(active.dataset.index);
                var channel = this.channels[index];
                if (channel) this.addToFavorites(channel);
            }
            if (active) active.focus();
            return true;
        }

        return false;
    }

    handleLetterToSearch(e) {
        if (document.activeElement === this.els.searchInput) return false;
        if (e.key.length !== 1 || e.ctrlKey || e.metaKey) return false;
        var code = e.key.charCodeAt(0);
        if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) {
            this.els.searchInput.focus();
            return true;
        }
        return false;
    }

    getVisibleGrids() {
        return ['#favorites-grid', '#recent-grid', '#categories-grid', '#channels-grid']
            .map((id) => document.querySelector(id))
            .filter((g) => g && g.offsetParent !== null);
    }

    getGridItems(grid) {
        return Array.from(grid.children).filter(function (el) {
            return !el.classList.contains('empty') && el.offsetParent !== null;
        });
    }

    getGridColumnCount(items) {
        var firstY = items[0].getBoundingClientRect().top;
        var cols = 0;
        for (var i = 0; i < items.length; i++) {
            if (Math.abs(items[i].getBoundingClientRect().top - firstY) < 10) cols++;
            else break;
        }
        return cols || 3;
    }

    handleArrowKeys(e) {
        var arrowKeys = [PCKeyCodes.ARROW_UP, PCKeyCodes.ARROW_DOWN, PCKeyCodes.ARROW_LEFT, PCKeyCodes.ARROW_RIGHT];
        if (arrowKeys.indexOf(e.key) === -1) return false;

        if (document.activeElement === this.els.searchInput) {
            if (e.key === PCKeyCodes.ARROW_DOWN) {
                e.preventDefault();
                var target = this.els.searchInput.value.length >= 2
                    ? document.querySelector('.channel-item')
                    : document.querySelector('.favorite-item:not(.empty)');
                if (target) {
                    target.focus();
                    target.scrollIntoView({behavior: 'smooth', block: 'center'});
                }
            }
            return true;
        }

        e.preventDefault();
        var current = document.activeElement;
        var itemSelector = '.favorite-item:not(.empty), .recent-item, .category-item, .channel-item';

        if (current.tagName === 'BODY' || !current.matches(itemSelector)) {
            var firstItem = document.querySelector(itemSelector);
            if (firstItem) {
                firstItem.focus();
                firstItem.scrollIntoView({behavior: 'smooth', block: 'center'});
            }
            return true;
        }

        var grids = this.getVisibleGrids();
        var grid = current.closest('#favorites-grid, #recent-grid, #categories-grid, #channels-grid');
        if (!grid) return true;

        var gridIdx = grids.indexOf(grid);
        if (gridIdx === -1) return true;

        var items = this.getGridItems(grid);
        var idx = items.indexOf(current);
        if (idx === -1) return true;

        var cols = this.getGridColumnCount(items);
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
            if (target >= items.length && gridIdx < grids.length - 1) {
                var gi;
                for (gi = gridIdx + 1; gi < grids.length; gi++) {
                    targetGrid = grids[gi];
                    var nextItems = this.getGridItems(targetGrid);
                    if (nextItems.length > 0) {
                        target = gi === 1 ? 0 : Math.min(col, nextItems.length - 1);
                        break;
                    }
                }
                if (gi >= grids.length) target = idx;
            } else if (target >= items.length) {
                target = idx;
            }
        } else if (e.key === PCKeyCodes.ARROW_UP) {
            if (row > 0) {
                target = idx - cols;
            } else if (gridIdx === 0) {
                input.focus();
                return true;
            } else if (gridIdx > 0) {
                var gi;
                for (gi = gridIdx - 1; gi >= 0; gi--) {
                    targetGrid = grids[gi];
                    var prevItems = this.getGridItems(targetGrid);
                    if (prevItems.length > 0) {
                        var pCols = this.getGridColumnCount(prevItems);
                        var pRows = Math.ceil(prevItems.length / pCols);
                        target = Math.min((pRows - 1) * pCols + col, prevItems.length - 1);
                        break;
                    }
                }
                if (gi < 0) {
                    if (this.els.searchInput) {
                        this.els.searchInput.focus();
                        return true;
                    }
                    target = idx;
                }
            }
        }

        if (targetGrid) {
            var tItems = this.getGridItems(targetGrid);
            if (target >= 0 && target < tItems.length) {
                tItems[target].focus();
                tItems[target].scrollIntoView({behavior: 'smooth', block: 'center'});
            }
        } else if (target !== idx && target >= 0 && target < items.length) {
            items[target].focus();
            items[target].scrollIntoView({behavior: 'smooth', block: 'nearest'});
        }
        return true;
    }

    handleEnterKey(e) {
        if (e.key !== PCKeyCodes.ENTER && e.key !== PCKeyCodes.OK) return false;
        if (document.activeElement.tagName === 'INPUT') return false;
        e.preventDefault();
        document.activeElement.click();
        return true;
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
