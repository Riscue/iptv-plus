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
        this.isPlaying = false;

        this.init();
    }

    async init() {
        await this.loadData();
        this.setupKeyboardEvents();
        this.setupSearch();
        this.setupNavigation();
        this.renderFavorites();
        this.renderRecent();
        this.renderCategories();
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
                div.tabIndex = 0;
            } else {
                div.className = 'favorite-item empty';
                div.innerHTML = '<span class="dial-number">' + (i + 1) + '</span>';
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
                return b.count - a.count;
            })
            .slice(0, 10);

        if (sortedChannels.length === 0) {
            grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: #666; padding: 20px;">Henüz kanal izlenmedi</div>';
            return;
        }

        grid.innerHTML = sortedChannels.map(function(item) {
            var globalIndex = self.channels.indexOf(item.channel);
            return '<div class="recent-item" data-index="' + globalIndex + '" tabindex="0">' +
                   '<div class="channel-name">' + item.name + '</div>' +
                   '<div class="watch-count">' + item.count + ' izlenme</div>' +
                   '</div>';
        }).join('');

        // Click handler
        grid.onclick = function(e) {
            var item = e.target.closest('.recent-item');
            if (item) {
                var index = parseInt(item.dataset.index);
                self.playChannel(self.channels[index]);
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
                    self.playChannel(self.channels[index]);
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
    }

    showCategoriesView() {
        this.currentCategory = null;
        document.getElementById('categories-view').classList.remove('hidden');
        document.getElementById('channels-view').classList.add('hidden');
        document.getElementById('back-nav').classList.add('hidden');
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
    }

    setupKeyboardEvents() {
        var self = this;
        var input = document.getElementById('search-input');

        document.addEventListener('keydown', function(e) {
            // Number keys 1-9 for favorites
            if (e.key >= '1' && e.key <= '9') {
                var index = parseInt(e.key) - 1;

                // If input is focused and has content, let typing work
                if (document.activeElement === input && input.value.length > 0) {
                    return;
                }

                // Otherwise, trigger favorite
                if (self.favorites[index]) {
                    e.preventDefault();
                    if (document.activeElement === input) {
                        input.value = '';
                        input.blur();
                    }
                    self.playChannel(self.favorites[index]);
                }
                return;
            }

            // Escape/Exit/Back key
            if (e.key === 'Escape' || e.key === 'Exit' || e.keyCode === 1001 || e.keyCode === 1009 || e.keyCode === 461) {
                if (document.activeElement === input) {
                    input.value = '';
                    input.blur();
                    if (self.currentCategory) {
                        self.showCategoriesView();
                    }
                } else if (self.currentCategory) {
                    self.showCategoriesView();
                }
                return;
            }

            // Letter keys focus search input
            if (document.activeElement.tagName !== 'INPUT' && input && e.key.length === 1) {
                var code = e.key.charCodeAt(0);
                if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) {
                    input.focus();
                }
            }
        });
    }

    playChannel(channel) {
        if (this.isPlaying) return;
        this.isPlaying = true;

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
                    sessionStorage.setItem('navigatingFromHome', 'true');
                    window.location.href = '/player';
                })
                .catch(function(err) {
                    console.error('Failed to change channel:', err);
                    self.isPlaying = false;
                });
        } else {
            console.error('Channel not found:', channel.name);
            this.isPlaying = false;
        }
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    window.homePage = new HomePage();
});
