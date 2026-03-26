class IPTVPlayer {
    constructor() {
        this.hls = null;
        this.video = document.getElementById('video');
        this.currentChannel = null;
        this.currentCategory = null;
        this.channels = [];
        this.channelIndex = 0;
        this.channelListVisible = false;
        this.seekAmount = TimeConstants.SEEK_AMOUNT;
        this.idleTimer = null;
        this.idleTimeout = TimeConstants.IDLE_TIMEOUT;
        this.heartbeatInterval = null;
        this.isLoading = false;
        this.currentUrl = null;
        this.bufferStartTime = null;
        this.plannedSeekPosition = null;
        this.autoFullscreenDone = false;
        this.overlayTimer = null;
        this.overlayType = null;
        this.debugKeyPresses = 0;
        this.debugKeySequence = [];
        this.debugKeyTimer = null;

        this.indicatorPriority = IndicatorPriority;

        this.init();
    }

    async init() {
        this.checkCodecSupport();
        await this.loadChannels();
        this.setupAllListeners();

        var self = this;
        setInterval(function () {
            self.updateTimeDisplay();
        }, TimeConstants.SECOND);

        var res = await fetch('/api/buffer/status');
        var data = await res.json();

        if (data.isRecording && data.currentChannel) {
            this.bufferStartTime = data.bufferStartTime;
            var channel = this.channels.find(function (ch) {
                return ch.name === data.currentChannel;
            });
            if (channel) {
                this.currentChannel = channel;
                this.channelIndex = this.channels.indexOf(channel);
                this.updateChannelInfo();
                this.loadVideoFromBuffer();
                return;
            }
        }

        if (!this.currentChannel && this.channels.length > 0) {
            this.playChannel(0);
            return;
        }

        this.updateChannelInfo();
        this.loadVideoFromBuffer();
    }

    checkCodecSupport() {
        var video = document.getElementById('video');
        var support = [];

        if (video.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"')) {
            support.push('H.264');
        }

        if (video.canPlayType('video/mp4; codecs="hev1.1.6.L93.B0"')) {
            support.push('H.265/HEVC');
        }

        if (Hls.isSupported()) {
            support.push('HLS (hls.js)');
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            support.push('HLS (Native)');
        }

        console.log('Supported codecs:', support);

        if (support.length === 0) {
            this.showIndicator(IndicatorTypes.ERROR_PERMANENT, {message: Messages.VIDEO_CODEC_NOT_SUPPORTED});
        }
    }

    async loadChannels() {
        try {
            const res = await fetch('/api/channels');
            const data = await res.json();
            this.channels = data.channels;
            this.channelIndex = data.index || 0;
            this.currentChannel = data.current;
            this.currentCategory = data.currentCategory || null;
        } catch (err) {
            console.error('Failed to load channels:', err);
        }
    }

    setupAllListeners() {
        this.setupKeyboardEvents();
        this.setupMediaKeyEvents();
        this.setupRemoteButtons();
        this.setupIdleDetection();
        this.setupHeartbeat();
        this.setupVideoListeners();
        this.setupFullscreenFocusRestore();
    }

    setupVideoListeners() {
        var self = this;

        this.video.addEventListener('play', function () {
            if (!self.autoFullscreenDone) {
                self.autoFullscreenDone = true;
                self.toggleFullscreen();
            }
            self.updatePlayButtons();
        }, {once: true});

        this.video.addEventListener('click', function () {
            self.togglePlay();
        });

        this.video.addEventListener('play', function () {
            self.updatePlayButtons();
        });
        this.video.addEventListener('pause', function () {
            self.updatePlayButtons();
        });

        this.video.addEventListener('waiting', function () {
            self.showIndicator(IndicatorTypes.LOADING, {message: Messages.LOADING});
        });

        this.video.addEventListener('playing', function () {
            self.hideIndicator(IndicatorTypes.LOADING);
        });

        this.video.addEventListener('canplay', function () {
            self.hideIndicator(IndicatorTypes.LOADING);
        });

        var focusableSelector = 'button, [tabindex]:not(.channel-item)';
        document.addEventListener('focus', function (e) {
            if (e.target && e.target.matches && e.target.matches(focusableSelector)) {
                document.body.classList.remove('idle');
            }
        }, true);
    }

    loadVideoFromBuffer() {
        if (!this.currentChannel) return;

        var bufferUrl = '/buffer/' + this.getSafeName(this.currentChannel.name) + '/live.m3u8';
        this.showIndicator(IndicatorTypes.LOADING, {message: Messages.LOADING});

        this.waitForBuffer(bufferUrl)
            .then(() => {
                return fetch('/api/buffer/status');
            })
            .then(res => res.json())
            .then(data => {
                this.bufferStartTime = data.bufferStartTime;
                return this.loadVideo(bufferUrl);
            })
            .catch(() => {
                this.hideIndicator();
                this.showIndicator(IndicatorTypes.ERROR_PERMANENT, {message: Messages.CHANNEL_FAILED_TO_LOAD});
            });
    }

    loadVideo(url) {
        if (this.isLoading && this.currentUrl === url) {
            return;
        }

        this.isLoading = true;
        this.currentUrl = url;
        console.log('[PLAYER] Loading:', url);

        if (Hls.isSupported()) {
            this.setupHls(url);
        } else if (this.video.canPlayType('application/vnd.apple.mpegurl')) {
            this.setupNativeHls(url);
        }
    }

    setupHls(url) {
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }

        this.hls = new Hls({
            maxBufferLength: HLSConfig.MAX_BUFFER_LENGTH,
            maxMaxBufferLength: HLSConfig.MAX_MAX_BUFFER_LENGTH,
            maxLoadingDelay: HLSConfig.MAX_LOADING_DELAY,
            maxRetry: HLSConfig.MAX_RETRY,
        });

        this.hls.loadSource(url);
        this.hls.attachMedia(this.video);

        var firstFragmentLoaded = false;

        this.hls.on(Hls.Events.FRAG_LOADED, () => {
            if (!firstFragmentLoaded) {
                firstFragmentLoaded = true;
                this.isLoading = false;
                this.hideIndicator(IndicatorTypes.LOADING);
                this.hideIndicator(IndicatorTypes.ERROR);
                this.video.play().catch(() => {
                });
                this.updatePlayButtons();
            } else {
                this.hideIndicator(IndicatorTypes.LOADING);
                this.hideIndicator(IndicatorTypes.ERROR);
            }
        });

        this.hls.on(Hls.Events.BUFFER_STALLED, () => {
            if (firstFragmentLoaded) {
                this.showIndicator(IndicatorTypes.LOADING, {message: Messages.WAITING});
            }
        });

        this.hls.on(Hls.Events.BUFFER_APPENDED, () => {
            this.hideIndicator(IndicatorTypes.LOADING);
        });

        this.hls.on(Hls.Events.ERROR, (event, data) => {
            var details = data.details || '';

            if (!data.fatal) {
                switch (details) {
                    case HLSErrorDetails.FRAG_LOAD_ERROR:
                        this.showIndicator(IndicatorTypes.ERROR, {message: Messages.SEGMENT_FAILED_TO_LOAD});
                        break;
                    case HLSErrorDetails.FRAG_LOAD_TIMEOUT:
                    case HLSErrorDetails.MANIFEST_LOAD_TIMEOUT:
                        this.showIndicator(IndicatorTypes.ERROR, {message: Messages.MANIFEST_LOAD_TIMEOUT});
                        break;
                }
                return;
            }

            this.isLoading = false;
            this.updatePlayButtons();

            switch (data.type) {
                case Hls.ErrorTypes.NETWORK_ERROR:
                    console.error('[HLS] Network error:', details);
                    if (details === HLSErrorDetails.MANIFEST_LOAD_ERROR) {
                        this.showIndicator(IndicatorTypes.ERROR, {message: Messages.PLAYLIST_FAILED_TO_LOAD});
                    } else {
                        this.showIndicator(IndicatorTypes.ERROR, {message: Messages.CONNECTION_ERROR_RETRYING});
                    }
                    this.hls.startLoad();
                    break;

                case Hls.ErrorTypes.MEDIA_ERROR:
                    console.error('[HLS] Media error:', details);
                    if (details === HLSErrorDetails.BUFFER_DECODING_ERROR || details === HLSErrorDetails.BUFFER_CODEC_ERROR || details === HLSErrorDetails.MANIFEST_INCOMPATIBLE_CODECS_ERROR) {
                        this.showIndicator(IndicatorTypes.ERROR_PERMANENT, {message: Messages.CODEC_NOT_SUPPORTED_TV});
                    } else {
                        this.showIndicator(IndicatorTypes.ERROR, {message: Messages.PLAYBACK_ERROR_RECOVERING});
                        this.hls.recoverMediaError();
                    }
                    break;

                default:
                    console.error('[HLS] Fatal error:', details);
                    this.showIndicator(IndicatorTypes.ERROR_PERMANENT, {message: Messages.PLAYBACK_ERROR_CHANGE_CHANNEL});
                    break;
            }
        });
    }

    setupNativeHls(url) {
        this.video.src = url;
        this.video.addEventListener('loadedmetadata', () => {
            this.hideIndicator();
            this.video.play().catch(() => {
            });
            this.isLoading = false;
        }, {once: true});
    }

    async playChannel(index) {
        if (index < 0 || index >= this.channels.length) return;

        this.channelIndex = index;
        var channel = this.channels[index];
        this.currentChannel = channel;
        this.currentCategory = channel.category || null;

        try {
            var history = {};
            var stored = localStorage.getItem(StorageKeys.WATCH_HISTORY);
            if (stored) history = JSON.parse(stored);

            if (!history[channel.name]) {
                history[channel.name] = {count: 0, lastWatched: Date.now()};
            }
            history[channel.name].count++;
            history[channel.name].lastWatched = Date.now();

            var keys = Object.keys(history);
            if (keys.length > 9) {
                var sortedKeys = keys.sort(function (a, b) {
                    return history[b].lastWatched - history[a].lastWatched;
                });
                for (var i = 9; i < sortedKeys.length; i++) {
                    delete history[sortedKeys[i]];
                }
            }
            localStorage.setItem(StorageKeys.WATCH_HISTORY, JSON.stringify(history));
        } catch (e) {
            console.error('Watch history error:', e);
        }

        this.updateChannelInfo();

        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }
        this.video.pause();
        this.video.removeAttribute('src');

        this.overlayType = null;
        this.showIndicator(IndicatorTypes.LOADING, {message: Messages.LOADING});

        try {
            var changeUrl = '/api/channel/change?index=' + index;
            var res = await fetch(changeUrl);
            var data = await res.json();

            var statusRes = await fetch('/api/buffer/status');
            var statusData = await statusRes.json();
            this.bufferStartTime = statusData.bufferStartTime;

            await this.waitForBuffer(data.bufferUrl);
            this.loadVideo(data.bufferUrl);
        } catch (err) {
            this.hideIndicator();
            this.showIndicator(IndicatorTypes.ERROR_PERMANENT, {message: Messages.COULD_NOT_CHANGE_CHANNEL});
        }
    }

    channelUp() {
        var newIndex = (this.channelIndex + 1) % this.channels.length;
        this.playChannel(newIndex);
    }

    channelDown() {
        var newIndex = (this.channelIndex - 1 + this.channels.length) % this.channels.length;
        this.playChannel(newIndex);
    }

    togglePlay() {
        if (this.video.paused) {
            this.video.play().catch(() => {
            });
            this.showIndicator(IndicatorTypes.PLAY, {icon: Icons.PLAY});
        } else {
            this.video.pause();
            this.showIndicator(IndicatorTypes.PLAY, {icon: Icons.PAUSE});
        }
    }

    goToLive() {
        if (this.video.duration && !isNaN(this.video.duration) && this.video.duration > 0) {
            this.video.currentTime = this.video.duration;

            if (this.video.paused) {
                this.video.play().catch(() => {
                });
            }

            this.showIndicator(IndicatorTypes.LIVE);
        }
    }

    seekBack() {
        var newTime = Math.max(0, this.video.currentTime - this.seekAmount);
        this.video.currentTime = newTime;
        this.showIndicator(IndicatorTypes.SEEK, {seconds: -this.seekAmount});
    }

    seekForward() {
        var newTime = Math.min(this.video.duration || 0, this.video.currentTime + this.seekAmount);
        this.video.currentTime = newTime;
        this.showIndicator(IndicatorTypes.SEEK, {seconds: this.seekAmount});
    }

    formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return '0:00';
        var mins = Math.floor(seconds / 60);
        var secs = Math.floor(seconds % 60);
        return mins + ':' + (secs < 10 ? '0' : '') + secs;
    }

    getRealTime(videoTimeSeconds) {
        if (this.bufferStartTime && !isNaN(videoTimeSeconds)) {
            var videoTime = new Date(this.bufferStartTime + (videoTimeSeconds * 1000));
            return videoTime.toLocaleTimeString('tr-TR', {hour: '2-digit', minute: '2-digit', second: '2-digit'});
        } else {
            var now = new Date();
            return now.toLocaleTimeString('tr-TR', {hour: '2-digit', minute: '2-digit', second: '2-digit'});
        }
    }

    showIndicator(type, data) {
        data = data || {};
        var overlay = document.getElementById('video-overlay');
        if (!overlay) return;

        if (this.overlayType === IndicatorTypes.ERROR_PERMANENT && type !== IndicatorTypes.ERROR_PERMANENT) {
            return;
        }

        var currentPriority = this.indicatorPriority[this.overlayType] || 0;
        var newPriority = this.indicatorPriority[type] || 0;
        if (this.overlayType && newPriority < currentPriority) {
            return;
        }

        if (this.overlayTimer) {
            clearTimeout(this.overlayTimer);
            this.overlayTimer = null;
        }

        overlay.className = '';
        overlay.innerHTML = '';
        this.overlayType = type;

        var self = this;

        switch (type) {
            case IndicatorTypes.SEEK:
                var prefix = (data.seconds || 0) > 0 ? '+' : '';
                var icon = (data.seconds || 0) > 0 ? Icons.FORWARD : Icons.BACKWARD;
                overlay.innerHTML = icon + ' ' + prefix + (data.seconds || 0) + 's';
                overlay.classList.add('seek-mode', 'active');
                this.overlayTimer = setTimeout(function () {
                    overlay.classList.remove('active');
                    self.overlayType = null;
                }, TimeConstants.OVERLAY_AUTO_HIDE);
                break;

            case IndicatorTypes.PLAN:
                var diff = data.seconds || 0;
                var planPrefix = diff > 0 ? '+' : '';
                var planIcon = diff > 0 ? Icons.FORWARD : Icons.BACKWARD;
                var planTime = data.time || this.getRealTime(this.video.currentTime);
                overlay.innerHTML = '<div class="plan-info">' + planIcon + ' ' + planPrefix + diff + 's</div>' +
                    '<div class="plan-time">' + planTime + '</div>';
                overlay.classList.add('plan-mode', 'active');
                if (data.autoHide) {
                    this.overlayTimer = setTimeout(function () {
                        overlay.classList.remove('active');
                        self.overlayType = null;
                    }, TimeConstants.OVERLAY_AUTO_HIDE);
                }
                break;

            case IndicatorTypes.LOADING:
                overlay.innerHTML = '<div class="loading-content"><div class="spinner"></div>' +
                    '<div class="loading-text">' + (data.message || Messages.LOADING) + '</div></div>';
                overlay.classList.add('loading-mode', 'active');
                break;

            case IndicatorTypes.ERROR:
                overlay.innerHTML = (data.message || Messages.ERROR_LABEL);
                overlay.classList.add('error-mode', 'active');
                break;

            case IndicatorTypes.ERROR_PERMANENT:
                overlay.innerHTML = (data.message || Messages.ERROR_LABEL);
                overlay.classList.add('error-mode', 'active');
                break;

            case IndicatorTypes.LIVE:
                overlay.innerHTML = Messages.LIVE;
                overlay.classList.add('live-mode', 'active');
                this.overlayTimer = setTimeout(function () {
                    overlay.classList.remove('active');
                    self.overlayType = null;
                    if (self.video && self.video.readyState < 3 && !self.video.paused) {
                        self.showIndicator(IndicatorTypes.LOADING);
                    }
                }, TimeConstants.OVERLAY_AUTO_HIDE / 2);
                break;

            case IndicatorTypes.PLAY:
                overlay.innerHTML = '<span class="play-icon">' + (data.icon || Icons.PLAY) + '</span>';
                overlay.classList.add('play-mode', 'active');
                this.overlayTimer = setTimeout(function () {
                    overlay.classList.remove('active');
                    self.overlayType = null;
                }, TimeConstants.OVERLAY_AUTO_HIDE / 2);
                break;
        }
    }

    hideIndicator(filterType) {
        if (filterType && this.overlayType !== filterType) {
            return;
        }
        var overlay = document.getElementById('video-overlay');
        if (overlay) {
            overlay.classList.remove('active');
        }
        this.overlayType = null;
        if (this.overlayTimer) {
            clearTimeout(this.overlayTimer);
            this.overlayTimer = null;
        }
    }

    updateProgressIndicator(time) {
        var positionEl = document.getElementById('progress-position');
        if (!positionEl || !this.video.duration) return;

        var positionPercent = (time / this.video.duration) * 100;
        positionEl.style.width = positionPercent + '%';
        positionEl.style.background = 'rgba(255, 215, 0, 0.8)';
    }

    toggleChannelList(show) {
        var list = document.getElementById('channel-list');
        if (show === undefined) {
            show = list.classList.contains('hidden');
        }
        list.classList.toggle('hidden', !show);
        this.channelListVisible = show;

        if (show) {
            this.renderChannelList();
            var input = document.getElementById('search-input');
            if (input) {
                input.value = '';
            }
            var activeItem = document.querySelector('.channel-item.active');
            if (activeItem) {
                activeItem.scrollIntoView({block: 'center'});
                activeItem.focus();
            } else if (input) {
                input.focus();
            }
        }
    }

    toggleFullscreen() {
        var elem = document.getElementById('app');

        if (window.webOS && webOS.window && webOS.window.setFullScreen) {
            webOS.window.setFullScreen(true);
            return;
        }

        if (!document.fullscreenElement) {
            if (elem.requestFullscreen) {
                elem.requestFullscreen();
            } else if (elem.webkitRequestFullscreen) {
                elem.webkitRequestFullscreen();
            } else if (elem.mozRequestFullScreen) {
                elem.mozRequestFullScreen();
            } else if (elem.msRequestFullscreen) {
                elem.msRequestFullscreen();
            }
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            } else if (document.mozCancelFullScreen) {
                document.mozCancelFullScreen();
            } else if (document.msExitFullscreen) {
                document.msExitFullscreen();
            }
        }
    }

    toggleDebugPanel() {
        var debugPanel = document.getElementById('debug-panel');
        if (debugPanel) {
            debugPanel.classList.toggle('hidden');
        }
    }

    setupFullscreenFocusRestore() {
        var handler = function () {
            setTimeout(function () {
                if (!document.activeElement || document.activeElement === document.body || document.activeElement.tagName === 'IFRAME') {
                    document.body.focus();
                }
            }, 100);
        };
        document.addEventListener('fullscreenchange', handler);
        document.addEventListener('webkitfullscreenchange', handler);
        document.addEventListener('mozfullscreenchange', handler);
        document.addEventListener('MSFullscreenChange', handler);
    }

    updateChannelInfo() {
        var nameEl = document.getElementById('channel-name');
        var numberEl = document.getElementById('channel-number');

        if (this.currentChannel && nameEl && numberEl) {
            nameEl.textContent = this.currentChannel.name;
            numberEl.textContent = (this.channelIndex + 1).toString();
        }
    }

    async waitForBuffer(bufferUrl, maxWait) {
        if (maxWait === undefined) maxWait = TimeConstants.BUFFER_MAX_WAIT;
        var startTime = Date.now();
        var checkInterval = TimeConstants.BUFFER_CHECK_INTERVAL;

        while (Date.now() - startTime < maxWait) {
            try {
                var response = await fetch(bufferUrl);
                if (response.ok) {
                    var content = await response.text();
                    var segmentCount = (content.match(/\.ts/g) || []).length;

                    if (segmentCount >= 1) {
                        return true;
                    }
                }
            } catch (e) {
            }

            await new Promise(resolve => setTimeout(resolve, checkInterval));
        }

        throw new Error('Buffer timeout');
    }

    getSafeName(name) {
        return name.replace(/[^a-zA-Z0-9ğüşıöçĞÜŞİÖÇ_-]/g, '_');
    }

    setupIdleDetection() {
        var self = this;
        this.forceIdle = false;

        var resetIdle = function (e) {
            if (e && (e.type === 'mousemove' || e.type === 'click' || e.type === 'touchstart')) {
                self.forceIdle = false;
            }

            if (self.forceIdle) return;

            document.body.classList.remove('idle');
            clearTimeout(self.idleTimer);
            self.idleTimer = setTimeout(function () {
                if (!self.channelListVisible && !self.video.paused && self.plannedSeekPosition === null) {
                    document.body.classList.add('idle');
                }
            }, self.idleTimeout);
        };

        ['mousemove', 'keydown', 'click', 'touchstart'].forEach(function (event) {
            document.addEventListener(event, resetIdle);
        });

        resetIdle();
    }

    setupHeartbeat() {
        var self = this;
        this.heartbeatInterval = setInterval(function () {
            fetch('/api/buffer/heartbeat', {
                method: 'GET',
                cache: 'no-cache',
                keepalive: true
            }).catch(() => {
            });
        }, TimeConstants.HEARTBEAT_INTERVAL);
    }

    setupKeyboardEvents() {
        var self = this;
        var input = document.getElementById('search-input');

        var getRows = function () {
            return [
                Array.from(document.querySelectorAll('.control-btn')).filter(function (b) {
                    return b.offsetParent !== null;
                }),
                document.getElementById('progress-bar'),
                Array.from(document.querySelectorAll('.live-btn, .fullscreen-btn')).filter(function (b) {
                    return b.offsetParent !== null;
                })
            ];
        };

        document.addEventListener('keydown', function (e) {
            if (self.channelListVisible) {
                if (e.target.id === 'search-input') {
                    if (e.key === PCKeyCodes.ESCAPE || e.keyCode === TVKeyCodes.BACK) {
                        e.preventDefault();
                        self.toggleChannelList(false);
                        return;
                    }
                    if (e.key === PCKeyCodes.ARROW_DOWN) {
                        e.preventDefault();
                        var firstChannel = document.querySelector('.channel-item');
                        if (firstChannel) firstChannel.focus();
                        return;
                    }
                    return;
                }

                if (e.key === PCKeyCodes.ARROW_UP || e.key === PCKeyCodes.ARROW_DOWN) {
                    e.preventDefault();
                    var items = Array.from(document.querySelectorAll('.channel-item'));
                    var currentIndex = items.indexOf(document.activeElement);
                    var targetIndex = (e.key === PCKeyCodes.ARROW_DOWN)
                        ? (currentIndex < items.length - 1 ? currentIndex + 1 : 0)
                        : (currentIndex > 0 ? currentIndex - 1 : items.length - 1);
                    items[targetIndex]?.focus();
                    items[targetIndex]?.scrollIntoView({behavior: 'smooth', block: 'nearest'});
                    return;
                }

                if (e.key === PCKeyCodes.ENTER || e.key === PCKeyCodes.OK) {
                    e.preventDefault();
                    var focused = document.querySelector('.channel-item:focus');
                    if (focused) {
                        var idx = parseInt(focused.dataset.index);
                        self.playChannel(idx);
                        self.toggleChannelList(false);
                    }
                    return;
                }

                if (e.key === PCKeyCodes.ESCAPE || e.keyCode === TVKeyCodes.BACK || e.keyCode === TVKeyCodes.BLUE) {
                    e.preventDefault();
                    self.toggleChannelList(false);
                    return;
                }

                if (e.key === PCKeyCodes.ARROW_LEFT || e.key === PCKeyCodes.ARROW_RIGHT) {
                    e.preventDefault();
                    return;
                }
                return;
            }

            var currentFocus = document.activeElement;
            var isIdle = document.body.classList.contains('idle');

            if (isIdle) {
                self.forceIdle = false;
                switch (e.key) {
                    case PCKeyCodes.ARROW_UP:
                    case PCKeyCodes.ARROW_DOWN:
                        e.preventDefault();
                        document.getElementById('progress-bar')?.focus();
                        document.body.classList.remove('idle');
                        return;
                    case PCKeyCodes.ARROW_LEFT:
                        e.preventDefault();
                        self.seekBack();
                        return;
                    case PCKeyCodes.ARROW_RIGHT:
                        e.preventDefault();
                        self.seekForward();
                        return;
                }
                document.body.classList.remove('idle');
            }

            var rows = getRows();
            var currentRow = -1;
            var currentCol = -1;

            for (var r = 0; r < rows.length; r++) {
                if (rows[r] === null || rows[r].length === 0) continue;

                if (r === 1) {
                    if (currentFocus === rows[r]) {
                        currentRow = r;
                        currentCol = 0;
                        break;
                    }
                } else {
                    var idx = rows[r].indexOf(currentFocus);
                    if (idx !== -1) {
                        currentRow = r;
                        currentCol = idx;
                        break;
                    }
                }
            }

            switch (e.key) {
                case PCKeyCodes.ARROW_UP:
                    e.preventDefault();
                    if (currentRow === -1) {
                        if (rows[0] && rows[0].length > 0) {
                            var midCol = Math.floor(rows[0].length / 2);
                            rows[0][midCol]?.focus();
                        }
                    } else if (currentRow === 0) {
                        self.forceIdle = true;
                        clearTimeout(self.idleTimer);
                        document.body.classList.add('idle');
                        if (document.activeElement && document.activeElement !== document.body) {
                            document.activeElement.blur();
                        }
                    } else if (currentRow === 1) {
                        if (rows[0] && rows[0].length > 0) {
                            var midCol = Math.floor(rows[0].length / 2);
                            rows[0][midCol]?.focus();
                        }
                    } else if (currentRow === 2) {
                        rows[1]?.focus();
                    }
                    break;

                case PCKeyCodes.ARROW_DOWN:
                    e.preventDefault();
                    if (currentRow === -1) {
                        rows[1]?.focus();
                    } else if (currentRow === 0) {
                        rows[1]?.focus();
                    } else if (currentRow === 1) {
                        if (rows[2] && rows[2].length > 0) rows[2][0].focus();
                    } else if (currentRow === 2) {
                        if (rows[2] && rows[2].length > 0) rows[2][0].focus();
                    }
                    break;

                case PCKeyCodes.ARROW_LEFT:
                    e.preventDefault();
                    if (currentRow === -1) {
                        self.seekBack();
                    } else if (currentRow === 1) {
                        var baseTime = self.plannedSeekPosition !== null ? self.plannedSeekPosition : self.video.currentTime;
                        var plannedTime = Math.max(0, baseTime - self.seekAmount);
                        plannedTime = Math.round(plannedTime / TimeConstants.SEEK_AMOUNT) * TimeConstants.SEEK_AMOUNT;
                        plannedTime = Math.max(0, plannedTime);
                        self.plannedSeekPosition = plannedTime;
                        var diff = Math.round(plannedTime - self.video.currentTime);
                        var targetTime = self.bufferStartTime ?
                            new Date(self.bufferStartTime + (Math.round(plannedTime) * 1000)).toLocaleTimeString('tr-TR', {
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit'
                            }) :
                            self.formatTime(plannedTime);
                        self.showIndicator(IndicatorTypes.PLAN, {seconds: diff, time: targetTime});
                        self.updateProgressIndicator(plannedTime);
                    } else if (currentRow !== -1 && rows[currentRow] && rows[currentRow].length > 0) {
                        if (currentCol > 0) {
                            rows[currentRow][currentCol - 1].focus();
                        } else {
                            rows[currentRow][rows[currentRow].length - 1].focus();
                        }
                    }
                    break;

                case PCKeyCodes.ARROW_RIGHT:
                    e.preventDefault();
                    if (currentRow === -1) {
                        self.seekForward();
                    } else if (currentRow === 1) {
                        var baseTime = self.plannedSeekPosition !== null ? self.plannedSeekPosition : self.video.currentTime;
                        var plannedTime = Math.min(self.video.duration || 0, baseTime + self.seekAmount);
                        plannedTime = Math.round(plannedTime / TimeConstants.SEEK_AMOUNT) * TimeConstants.SEEK_AMOUNT;
                        plannedTime = Math.min(self.video.duration || 0, plannedTime);
                        self.plannedSeekPosition = plannedTime;
                        var diff = Math.round(plannedTime - self.video.currentTime);
                        var targetTime = self.bufferStartTime ?
                            new Date(self.bufferStartTime + (Math.round(plannedTime) * 1000)).toLocaleTimeString('tr-TR', {
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit'
                            }) :
                            self.formatTime(plannedTime);
                        self.showIndicator(IndicatorTypes.PLAN, {seconds: diff, time: targetTime});
                        self.updateProgressIndicator(plannedTime);
                    } else if (currentRow !== -1 && rows[currentRow] && rows[currentRow].length > 0) {
                        if (currentCol < rows[currentRow].length - 1) {
                            rows[currentRow][currentCol + 1].focus();
                        } else {
                            rows[currentRow][0].focus();
                        }
                    }
                    break;

                case PCKeyCodes.ENTER:
                case PCKeyCodes.OK:
                    e.preventDefault();
                    if (currentRow === 1) {
                        if (self.plannedSeekPosition !== null) {
                            self.video.currentTime = self.plannedSeekPosition;
                            self.plannedSeekPosition = null;
                            self.hideIndicator();
                        } else {
                            self.togglePlay();
                        }
                    } else if (currentRow !== -1) {
                        currentFocus.click();
                    } else {
                        self.togglePlay();
                    }
                    break;

                case PCKeyCodes.ESCAPE:
                    e.preventDefault();
                    history.back();
                    break;

                case PCKeyCodes.F_KEY:
                case PCKeyCodes.F_KEY_UPPER:
                    e.preventDefault();
                    self.toggleFullscreen();
                    break;

                case PCKeyCodes.SPACE:
                    e.preventDefault();
                    self.togglePlay();
                    break;
            }

            if (e.keyCode === TVKeyCodes.BACK) {
                e.preventDefault();
                history.back();
            }

            if (e.keyCode === TVKeyCodes.DIGIT_0) {
                clearTimeout(self.debugKeyTimer);
                self.debugKeySequence.push(TVKeyCodes.DIGIT_0);
                if (self.debugKeySequence.length > 3) {
                    self.debugKeySequence.shift();
                }
                self.debugKeyTimer = setTimeout(function () {
                    self.debugKeySequence = [];
                }, TimeConstants.DEBUG_SEQUENCE_TIMEOUT);
            } else if (e.keyCode === TVKeyCodes.BLUE) {
                if (self.debugKeySequence.length === 3 &&
                    self.debugKeySequence[0] === TVKeyCodes.DIGIT_0 &&
                    self.debugKeySequence[1] === TVKeyCodes.DIGIT_0 &&
                    self.debugKeySequence[2] === TVKeyCodes.DIGIT_0) {
                    self.toggleDebugPanel();
                    self.debugKeySequence = [];
                    clearTimeout(self.debugKeyTimer);
                }
            }

            if (e.keyCode === TVKeyCodes.CHANNEL_UP_KEY || e.key === TVKeyCodes.CHANNEL_UP || e.keyCode === TVKeyCodes.PAGE_UP) {
                e.preventDefault();
                self.channelUp();
            }
            if (e.keyCode === TVKeyCodes.CHANNEL_DOWN_KEY || e.key === TVKeyCodes.CHANNEL_DOWN || e.keyCode === TVKeyCodes.PAGE_DOWN) {
                e.preventDefault();
                self.channelDown();
            }

            switch (e.keyCode) {
                case TVKeyCodes.RED:
                    e.preventDefault();
                    self.goToLive();
                    break;
                case TVKeyCodes.GREEN:
                    break;
                case TVKeyCodes.YELLOW:
                    e.preventDefault();
                    self.toggleFullscreen();
                    break;
                case TVKeyCodes.BLUE:
                    if (self.debugKeySequence.length !== 3) {
                        e.preventDefault();
                        self.toggleChannelList();
                    }
                    break;
            }

            if (e.keyCode === TVKeyCodes.MEDIA_PLAY_PAUSE || e.keyCode === TVKeyCodes.MEDIA_PLAY ||
                e.keyCode === TVKeyCodes.MEDIA_PAUSE || e.keyCode === TVKeyCodes.MEDIA_STOP ||
                e.keyCode === TVKeyCodes.MEDIA_PLAY_ALT || e.keyCode === TVKeyCodes.RECORD ||
                e.keyCode === TVKeyCodes.RECORD_ALT || e.keyCode === TVKeyCodes.MEDIA_PLAY_PAUSE_ALT) {
                e.preventDefault();
                self.togglePlay();
            }
        });
    }

    setupMediaKeyEvents() {
        var self = this;

        if (window.webOS && window.webOS.service) {
            try {
                webOS.service.request('luna://com.webos.service.ime', {
                    method: 'registerRemoteKeyboard',
                    parameters: {},
                    onSuccess: function () {
                        console.log('[PLAYER] WebOS media keys registered');
                    },
                    onFailure: function () {
                        console.log('[PLAYER] WebOS media key registration not available');
                    }
                });
            } catch (e) {
            }
        }

        document.addEventListener('mediaplay', function () {
            if (self.video.paused) {
                self.togglePlay();
            }
        });

        document.addEventListener('mediapause', function () {
            if (!self.video.paused) {
                self.togglePlay();
            }
        });

        if ('mediaSession' in navigator) {
            navigator.mediaSession.setActionHandler('play', function () {
                if (self.video.paused) self.togglePlay();
            });
            navigator.mediaSession.setActionHandler('pause', function () {
                if (!self.video.paused) self.togglePlay();
            });
        }
    }

    setupRemoteButtons() {
        var self = this;

        var btnPlayPause = document.getElementById('btn-play-pause');
        if (btnPlayPause) {
            btnPlayPause.addEventListener('click', function () {
                self.togglePlay();
            });
        }

        var btnLive = document.getElementById('btn-live');
        if (btnLive) {
            btnLive.addEventListener('click', function () {
                self.goToLive();
            });
        }

        var btnChPrev = document.getElementById('btn-ch-prev');
        if (btnChPrev) {
            btnChPrev.addEventListener('click', function () {
                self.channelDown();
            });
        }

        var btnChNext = document.getElementById('btn-ch-next');
        if (btnChNext) {
            btnChNext.addEventListener('click', function () {
                self.channelUp();
            });
        }

        var btnRewind = document.getElementById('btn-rwnd');
        if (btnRewind) {
            btnRewind.addEventListener('click', function () {
                self.seekBack();
            });
        }

        var btnFwd = document.getElementById('btn-fwd');
        if (btnFwd) {
            btnFwd.addEventListener('click', function () {
                self.seekForward();
            });
        }

        var btnChannels = document.getElementById('btn-channels');
        if (btnChannels) {
            btnChannels.addEventListener('click', function () {
                self.toggleChannelList();
            });
        }

        var btnFullscreen = document.getElementById('btn-fullscreen');
        if (btnFullscreen) {
            btnFullscreen.addEventListener('click', function () {
                self.toggleFullscreen();
            });
        }

        var btnCloseList = document.getElementById('btn-close-list');
        if (btnCloseList) {
            btnCloseList.addEventListener('click', function () {
                self.toggleChannelList(false);
            });
        }

        var searchInput = document.getElementById('search-input');
        if (searchInput) {
            searchInput.addEventListener('input', function (e) {
                self.renderChannelList(e.target.value);
            });
        }

        var progressBar = document.getElementById('progress-bar');
        if (progressBar) {
            progressBar.addEventListener('click', function (e) {
                var rect = progressBar.getBoundingClientRect();
                var percent = (e.clientX - rect.left) / rect.width;
                if (self.video.duration) {
                    var newTime = percent * self.video.duration;
                    var diff = Math.round(newTime - self.video.currentTime);
                    self.video.currentTime = newTime;
                    self.showIndicator(IndicatorTypes.PLAN, {seconds: diff, time: self.getRealTime(newTime), autoHide: true});
                }
            });

            progressBar.addEventListener('focus', function () {
                document.body.classList.remove('idle');
                self.plannedSeekPosition = null;
                self.updateProgress();
            });

            progressBar.addEventListener('blur', function () {
                self.plannedSeekPosition = null;
                self.updateProgress();
                self.hideIndicator();
            });
        }

        var backBtn = document.getElementById('btn-back');
        if (backBtn) {
            backBtn.addEventListener('click', function (e) {
                e.preventDefault();
                history.back();
            });
        }
    }

    updatePlayButtons() {
        var btnPlayPause = document.getElementById('btn-play-pause');
        if (!btnPlayPause) return;

        var icon = btnPlayPause.querySelector('.btn-icon');
        if (this.video.paused) {
            icon.innerHTML = Icons.PLAY;
            btnPlayPause.classList.add('active');
            btnPlayPause.classList.remove('inactive');
        } else {
            icon.innerHTML = Icons.PAUSE;
            btnPlayPause.classList.add('active');
            btnPlayPause.classList.remove('inactive');
        }
    }

    updateProgress() {
        var positionEl = document.getElementById('progress-position');

        if (!positionEl) return;

        if (this.plannedSeekPosition !== null) {
            return;
        }

        positionEl.style.background = '#00d4ff';

        if (this.video.duration) {
            var positionPercent = (this.video.currentTime / this.video.duration) * 100;
            positionEl.style.width = positionPercent + '%';
        } else {
            positionEl.style.width = '100%';
        }
    }

    updateTimeDisplay() {
        var currentTimeEl = document.getElementById('current-time');
        var totalTimeEl = document.getElementById('total-time');
        var liveBtn = document.getElementById('btn-live');

        if (!currentTimeEl || !totalTimeEl) return;

        if (this.plannedSeekPosition !== null) {
            return;
        }

        if (!isNaN(this.video.currentTime)) {
            var currentSecs = Math.floor(this.video.currentTime);
            var mins = Math.floor(currentSecs / 60);
            var secs = currentSecs % 60;
            currentTimeEl.textContent = mins + ':' + (secs < 10 ? '0' : '') + secs;
        } else {
            currentTimeEl.textContent = '0:00';
        }

        totalTimeEl.textContent = this.getRealTime(this.video.currentTime);

        if (liveBtn) {
            var isAtLive = this.video.duration && (this.video.duration - this.video.currentTime) < TimeConstants.LIVE_POSITION;
            if (isAtLive) {
                liveBtn.classList.add('hidden');
            } else {
                liveBtn.classList.remove('hidden');
            }
        }

        this.updateProgress();
    }

    renderChannelList(filter) {
        if (filter === undefined) filter = '';
        var items = document.getElementById('channel-items');
        if (!items) return;

        var self = this;

        var filtered = this.channels;
        if (this.currentCategory) {
            filtered = this.channels.filter(function (ch) {
                return ch.category === self.currentCategory;
            });
        }

        if (filter) {
            filtered = filtered.filter(function (ch) {
                return ch.name.toLowerCase().indexOf(filter.toLowerCase()) !== -1;
            });
        }

        items.innerHTML = filtered.map(function (ch) {
            var idx = self.channels.indexOf(ch);
            var isActive = idx === self.channelIndex;
            var classes = 'channel-item' + (isActive ? ' active' : '');
            return '<div class="' + classes + '" data-index="' + idx + '" tabindex="0">' + ch.name + '</div>';
        }).join('');

        items.onclick = function (e) {
            var item = e.target.closest('.channel-item');
            if (item) {
                var idx = parseInt(item.dataset.index);
                self.playChannel(idx);
                self.toggleChannelList(false);
            }
        };
    }
}

document.addEventListener('DOMContentLoaded', function () {
    window.player = new IPTVPlayer();
});
