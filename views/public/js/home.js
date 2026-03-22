// IPTV Player - Home Page

class HomePage {
    constructor() {
        this.categories = [];
        this.channels = [];
        this.currentCategory = null;
        this.favorites = this.loadFavorites();
        this.searchTimeout = null;
        this.watchHistory = this.loadWatchHistory();
        this.longPressTimer = null;
        this.currentRecording = null; // Currently recording channel

        this.init();
    }

    async init() {
        await this.loadData();
        await this.loadBufferStatus();
        this.setupKeyboardEvents();
        this.setupSearch();
        this.setupNavigation();
        this.setupPageShowHandler();
        this.renderFavorites();
        this.renderRecent();
        this.renderCategories();
    }

    setupPageShowHandler() {
        var self = this;
        window.addEventListener('pageshow', async function(e) {
            // Refresh buffer status when returning from player
            await self.loadBufferStatus();
            self.renderRecent();

            if (e.persisted) {
                // Page loaded from cache, refresh data but keep instance
                self.loadData();
            }
        });
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
                this.currentRecording = this.channels.find(function(ch) { return ch.name === data.currentChannel; });
            } else {
                this.currentRecording = null;
            }
        } catch (err) {
            this.currentRecording = null;
        }
    }

    loadFavorites() {
        var stored = localStorage.getItem('iptv-favorites');
        if (stored) {
            try {
                return JSON.parse(stored);
            } catch (e) {
                console.error('Failed to parse favorites:', e);
            }
        }
        return Array(9).fill(null);
    }

    saveFavorites() {
        localStorage.setItem('iptv-favorites', JSON.stringify(this.favorites));
    }

    loadWatchHistory() {
        try {
            var stored = localStorage.getItem('iptv-watch-history');
            if (stored) {
                return JSON.parse(stored);
            }
        } catch (e) {}
        return {};
    }

    saveWatchHistory() {
        localStorage.setItem('iptv-watch-history', JSON.stringify(this.watchHistory));
    }

    addToWatchHistory(channel) {
        if (!this.watchHistory[channel.name]) {
            this.watchHistory[channel.name] = { count: 0, lastWatched: Date.now() };
        }
        this.watchHistory[channel.name].count++;
        this.watchHistory[channel.name].lastWatched = Date.now();
        
        // Sadece son 9 kanalı tut (lastWatched'a göre sıralayıp fazlalıkları sil)
        var keys = Object.keys(this.watchHistory);
        if (keys.length > 9) {
            var self = this;
            var sortedKeys = keys.sort(function(a, b) {
                return self.watchHistory[b].lastWatched - self.watchHistory[a].lastWatched;
            });
            for (var i = 9; i < sortedKeys.length; i++) {
                delete this.watchHistory[sortedKeys[i]];
            }
        }
        
        this.saveWatchHistory();
        this.renderRecent();
    }

    addToFavorites(channel) {
        var emptyIndex = this.favorites.indexOf(null);
        if (emptyIndex === -1) {
            var existingIndex = this.favorites.findIndex(function(f) {
                return f && f.name === channel.name;
            });
            if (existingIndex !== -1) {
                this.favorites[existingIndex] = null;
                this.showNotification('Favoriden çıkarıldı');
                this.saveFavorites();
                this.renderFavorites();
                return;
            } else {
                this.showNotification('Favori slotları dolu!');
                return;
            }
        }

        this.favorites[emptyIndex] = channel;
        this.saveFavorites();
        this.renderFavorites();
        this.showNotification('Favorilere eklendi');
    }

    showNotification(message) {
        var notification = document.createElement('div');
        notification.className = 'notification';
        notification.textContent = message;
        notification.style.cssText = 'position: fixed; bottom: 100px; left: 50%; transform: translateX(-50%); background: rgba(0, 212, 255, 0.9); color: #fff; padding: 12px 24px; border-radius: 8px; z-index: 10000; font-weight: 500;';
        document.body.appendChild(notification);

        setTimeout(function() {
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
                div.innerHTML = '<span class="dial-number">' + (i + 1) + '</span>' +
                               '<span class="channel-name">' + channel.name + '</span>';
                div.tabIndex = 0; // Only filled items focusable
            } else {
                div.className = 'favorite-item empty';
                div.innerHTML = '<span class="dial-number">' + (i + 1) + '</span>';
                // No tabindex for empty items
            }

            grid.appendChild(div);
        }

        // Click handler
        grid.onclick = function(e) {
            var item = e.target.closest('.favorite-item');
            if (item && !item.classList.contains('empty')) {
                var index = parseInt(item.dataset.index);
                if (self.favorites[index]) {
                    self.playChannel(self.favorites[index]);
                }
            }
        };

        // Long press handler
        grid.onmousedown = function(e) {
            var item = e.target.closest('.favorite-item');
            if (item && !item.classList.contains('empty')) {
                self.longPressTimer = setTimeout(function() {
                    var index = parseInt(item.dataset.index);
                    self.favorites[index] = null;
                    self.saveFavorites();
                    self.renderFavorites();
                    self.showNotification('Favoriden çıkarıldı');
                }, 800);
            }
        };

        grid.onmouseup = function() {
            if (self.longPressTimer) {
                clearTimeout(self.longPressTimer);
                self.longPressTimer = null;
            }
        };

        grid.onmouseleave = function() {
            if (self.longPressTimer) {
                clearTimeout(self.longPressTimer);
                self.longPressTimer = null;
            }
        };

        // Keyboard handler
        grid.onkeydown = function(e) {
            if (e.key === 'Enter') {
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
            .map(function(name) {
                var channel = self.channels.find(function(ch) { return ch.name === name; });
                if (!channel) return null;
                return {
                    name: name,
                    count: self.watchHistory[name].count,
                    lastWatched: self.watchHistory[name].lastWatched,
                    channel: channel
                };
            })
            .filter(function(item) { return item !== null; })
            .sort(function(a, b) {
                return b.lastWatched - a.lastWatched;
            })
            .slice(0, 9);

        // Add currently recording channel at the top if not already in list
        if (this.currentRecording) {
            var existingIndex = sortedChannels.findIndex(function(item) { return item.name === self.currentRecording.name; });
            var recordingItem;
            if (existingIndex !== -1) {
                // Remove from current position
                recordingItem = sortedChannels.splice(existingIndex, 1)[0];
            } else {
                // Create new item
                recordingItem = {
                    name: this.currentRecording.name,
                    count: 0,
                    lastWatched: Date.now(),
                    channel: this.currentRecording
                };
            }
            // Add at the beginning
            sortedChannels.unshift(recordingItem);
            // Keep only 9 items
            sortedChannels = sortedChannels.slice(0, 9);
        }

        if (sortedChannels.length === 0) {
            grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: #666; padding: 20px;">Henüz kanal izlenmedi</div>';
            return;
        }

        grid.innerHTML = sortedChannels.map(function(item) {
            var globalIndex = self.channels.indexOf(item.channel);
            var isRecording = self.currentRecording && item.name === self.currentRecording.name;
            var recordingBadge = isRecording ? '<div class="recording-badge"><svg class="svg-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/></svg> Devam ediyor</div>' : '';
            var timeStr = new Date(item.lastWatched).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
            var izlenmeMetni = isRecording ? 'Kayıt devam ediyor' : 'Saat: ' + timeStr;
            return '<div class="recent-item' + (isRecording ? ' recording' : '') + '" data-index="' + globalIndex + '" data-recording="' + isRecording + '" tabindex="0">' +
                   '<div class="channel-name">' + item.name + '</div>' +
                   '<div class="watch-count">' + izlenmeMetni + '</div>' +
                   recordingBadge +
                   '</div>';
        }).join('');

        // Click handler
        grid.onclick = function(e) {
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

        // Long press handler
        grid.onmousedown = function(e) {
            var item = e.target.closest('.recent-item');
            if (item) {
                item.classList.add('pressing');
                self.longPressTimer = setTimeout(function() {
                    var index = parseInt(item.dataset.index);
                    self.addToFavorites(self.channels[index]);
                    item.classList.remove('pressing');
                    self.showNotification('Favorilere eklendi');
                }, 800);
            }
        };

        grid.onmouseup = function() {
            if (self.longPressTimer) {
                clearTimeout(self.longPressTimer);
                self.longPressTimer = null;
            }
        };

        grid.onmouseleave = function() {
            if (self.longPressTimer) {
                clearTimeout(self.longPressTimer);
                self.longPressTimer = null;
            }
            grid.querySelectorAll('.recent-item').forEach(function(item) {
                item.classList.remove('pressing');
            });
        };

        // Keyboard handler
        grid.onkeydown = function(e) {
            if (e.key === 'Enter') {
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

        grid.innerHTML = this.categories.map(function(cat) {
            return '<div class="category-item" data-category="' + cat.name + '" tabindex="0">' +
                   '<div class="category-name">' + cat.name + '</div>' +
                   '<div class="category-count">' + cat.count + ' kanal</div>' +
                   '</div>';
        }).join('');

        grid.onclick = function(e) {
            var item = e.target.closest('.category-item');
            if (item) {
                var category = item.dataset.category;
                self.showCategory(category);
            }
        };

        grid.onkeydown = function(e) {
            if (e.key === 'Enter') {
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
        var catChannels = this.channels.filter(function(ch) { return ch.category === categoryName; });

        document.getElementById('categories-view').classList.add('hidden');
        document.getElementById('channels-view').classList.remove('hidden');
        document.getElementById('back-nav').classList.remove('hidden');
        document.getElementById('current-category-name').textContent = categoryName;
        document.getElementById('channels-title').textContent = categoryName + ' - Kanallar';

        this.renderChannels(catChannels);

        // Focus first channel
        setTimeout(function() {
            var firstChannel = document.querySelector('.channel-item');
            if (firstChannel) firstChannel.focus();
        }, 50);
    }

    showCategoriesView() {
        var categoryName = this.currentCategory;
        this.currentCategory = null;
        document.getElementById('categories-view').classList.remove('hidden');
        document.getElementById('channels-view').classList.add('hidden');
        document.getElementById('back-nav').classList.add('hidden');

        // Focus the category we just came from
        setTimeout(function() {
            var categoryItems = Array.from(document.querySelectorAll('.category-item'));
            var targetCategory = categoryItems.find(function(el) {
                return el.dataset.category === categoryName;
            });
            if (targetCategory) {
                targetCategory.focus();
                targetCategory.scrollIntoView({ behavior: 'smooth', block: 'center' });
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

        grid.innerHTML = channels.map(function(ch) {
            var globalIndex = self.channels.indexOf(ch);
            return '<div class="channel-item" data-index="' + globalIndex + '" tabindex="0">' +
                   '<div class="channel-name">' + ch.name + '</div>' +
                   '</div>';
        }).join('');

        // Click handler
        grid.onclick = function(e) {
            var item = e.target.closest('.channel-item');
            if (item) {
                var index = parseInt(item.dataset.index);
                self.playChannel(self.channels[index]);
            }
        };

        // Long press handler
        grid.onmousedown = function(e) {
            var item = e.target.closest('.channel-item');
            if (item) {
                item.classList.add('pressing');
                self.longPressTimer = setTimeout(function() {
                    var index = parseInt(item.dataset.index);
                    self.addToFavorites(self.channels[index]);
                    item.classList.remove('pressing');
                    self.showNotification('Favorilere eklendi');
                }, 800);
            }
        };

        grid.onmouseup = function() {
            if (self.longPressTimer) {
                clearTimeout(self.longPressTimer);
                self.longPressTimer = null;
            }
        };

        grid.onmouseleave = function() {
            if (self.longPressTimer) {
                clearTimeout(self.longPressTimer);
                self.longPressTimer = null;
            }
            grid.querySelectorAll('.channel-item').forEach(function(item) {
                item.classList.remove('pressing');
            });
        };

        // Keyboard handler
        grid.onkeydown = function(e) {
            if (e.key === 'Enter') {
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
            btnBack.addEventListener('click', function() {
                self.showCategoriesView();
            });
        }
    }

    setupSearch() {
        var self = this;
        var input = document.getElementById('search-input');
        if (!input) return;

        input.addEventListener('input', function() {
            clearTimeout(self.searchTimeout);
            self.searchTimeout = setTimeout(function() {
                self.performSearch(input.value);
            }, 300);
        });
    }

    performSearch(query) {
        if (!query || query.length < 2) {
            this.showCategoriesView();
            return;
        }

        var self = this;
        var filtered = this.channels.filter(function(ch) {
            return ch.name.toLowerCase().indexOf(query.toLowerCase()) !== -1;
        });

        document.getElementById('categories-view').classList.add('hidden');
        document.getElementById('channels-view').classList.remove('hidden');
        document.getElementById('back-nav').classList.remove('hidden');
        document.getElementById('current-category-name').textContent = 'Arama: ' + query;
        document.getElementById('channels-title').textContent = 'Arama Sonuçları';

        this.renderChannels(filtered.slice(0, 100));

        // Focus first result
        setTimeout(function() {
            var firstChannel = document.querySelector('.channel-item');
            if (firstChannel) firstChannel.focus();
        }, 50);
    }

    setupKeyboardEvents() {
        var self = this;
        var input = document.getElementById('search-input');

        document.addEventListener('keydown', function(e) {
            // Number keys 1-9
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

            // Escape/Back
            if (e.key === 'Escape' || e.key === 'Exit' || e.keyCode === 1001 || e.keyCode === 1009 || e.keyCode === 461) {
                if (self.currentCategory) {
                    self.showCategoriesView();
                } else if (document.activeElement === input) {
                    input.value = '';
                    input.blur();
                }
                return;
            }

            // Letter keys focus search
            if (document.activeElement.tagName !== 'INPUT' && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
                var code = e.key.charCodeAt(0);
                if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) {
                    input.focus();
                    return;
                }
            }

            // Arrow navigation
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                if (document.activeElement === input) return;

                e.preventDefault();
                var current = document.activeElement;

                // First keypress - focus first item
                if (current.tagName === 'BODY' || !current.matches('.favorite-item:not(.empty), .recent-item, .category-item, .channel-item')) {
                    var firstItem = document.querySelector('.favorite-item:not(.empty), .recent-item, .category-item, .channel-item');
                    if (firstItem) {
                        firstItem.focus();
                        firstItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                    return;
                }

                // Get all visible grids
                var grids = ['#favorites-grid', '#recent-grid', '#categories-grid', '#channels-grid']
                    .map(function(id) { return document.querySelector(id); })
                    .filter(function(g) { return g && g.offsetParent !== null; });

                var grid = current.closest('#favorites-grid, #recent-grid, #categories-grid, #channels-grid');
                if (!grid) return;

                var gridIdx = grids.indexOf(grid);
                if (gridIdx === -1) return;

                // Get items in current grid
                var items = Array.from(grid.children).filter(function(el) {
                    return !el.classList.contains('empty') && el.offsetParent !== null;
                });
                var idx = items.indexOf(current);
                if (idx === -1) return;

                // Count columns
                var firstY = items[0].getBoundingClientRect().top;
                var cols = 0;
                for (var i = 0; i < items.length; i++) {
                    if (Math.abs(items[i].getBoundingClientRect().top - firstY) < 10) cols++;
                    else break;
                }
                if (cols === 0) cols = 3;

                var row = Math.floor(idx / cols);
                var col = idx % cols;
                var target = idx;
                var targetGrid = null;

                if (e.key === 'ArrowRight') {
                    if (col < cols - 1 && idx + 1 < items.length) target = idx + 1;
                } else if (e.key === 'ArrowLeft') {
                    if (col > 0) target = idx - 1;
                } else if (e.key === 'ArrowDown') {
                    target = idx + cols;
                    if (target >= items.length) {
                        if (gridIdx < grids.length - 1) {
                            targetGrid = grids[gridIdx + 1];
                            var nextItems = Array.from(targetGrid.children).filter(function(el) {
                                return !el.classList.contains('empty') && el.offsetParent !== null;
                            });
                            target = Math.min(col, nextItems.length - 1);
                        } else target = idx;
                    }
                } else if (e.key === 'ArrowUp') {
                    if (row > 0) {
                        target = idx - cols;
                    } else if (gridIdx > 0) {
                        targetGrid = grids[gridIdx - 1];
                        var prevItems = Array.from(targetGrid.children).filter(function(el) {
                            return !el.classList.contains('empty') && el.offsetParent !== null;
                        });
                        var pFirstY = prevItems[0].getBoundingClientRect().top;
                        var pCols = 0;
                        for (var i = 0; i < prevItems.length; i++) {
                            if (Math.abs(prevItems[i].getBoundingClientRect().top - pFirstY) < 10) pCols++;
                            else break;
                        }
                        var pRows = Math.ceil(prevItems.length / pCols);
                        var pRowStart = (pRows - 1) * pCols;
                        target = Math.min(pRowStart + col, prevItems.length - 1);
                    }
                }

                // Focus
                if (targetGrid) {
                    var tItems = Array.from(targetGrid.children).filter(function(el) {
                        return !el.classList.contains('empty') && el.offsetParent !== null;
                    });
                    if (target >= 0 && target < tItems.length) {
                        tItems[target].focus();
                        tItems[target].scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                } else if (target !== idx && target >= 0 && target < items.length) {
                    items[target].focus();
                    items[target].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
                return;
            }

            // Enter/OK
            if (e.key === 'Enter' || e.key === 'OK') {
                if (document.activeElement.tagName !== 'INPUT') {
                    e.preventDefault();
                    document.activeElement.click();
                }
            }
        });
    }

    resumeChannel(channel) {
        // Resume playing without killing the recording - just go to player
        console.log('Resuming channel:', channel.name, '(keeping recording alive)');
        this.addToWatchHistory(channel);
        window.location.href = '/player';
    }

    playChannel(channel) {
        var self = this;
        var index = this.channels.findIndex(function(ch) { return ch.name === channel.name; });

        if (index !== -1) {
            console.log('Playing channel:', channel.name, 'at index:', index);
            fetch('/api/channel/change?index=' + index)
                .then(function(response) {
                    console.log('Channel change response:', response.status);
                    return response.json();
                })
                .then(function() {
                    self.addToWatchHistory(self.channels[index]);
                    window.location.href = '/player';
                })
                .catch(function(err) {
                    console.error('Failed to change channel:', err);
                });
        } else {
            console.error('Channel not found:', channel.name);
        }
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    window.homePage = new HomePage();
});

// Removed duplicate pageshow listener
