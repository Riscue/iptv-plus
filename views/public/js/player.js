class IPTVPlayer {
    constructor() {
        this.hls = null;
        this.currentChannel = null;
        this.currentCategory = null;
        this.channels = [];
        this.channelIndex = 0;
        this.channelListVisible = false;
        this.seekAmount = TimeConstants.SEEK_AMOUNT;
        this.idleTimer = null;
        this.idleTimeout = TimeConstants.IDLE_TIMEOUT;
        this.isLoading = false;
        this.currentUrl = null;
        this.bufferStartTime = null;
        this.plannedSeekPosition = null;
        this.autoFullscreenDone = false;
        this.overlayTimer = null;
        this.overlayType = null;
        this.currentTab = 'favorites';
        this.favorites = ChannelUtils.loadFavorites();
        this.watchHistory = ChannelUtils.loadWatchHistory();
        this.selectedCategory = null;

        this.programmaticBack = false;
        this.indicatorPriority = IndicatorPriority;

        this.timeDisplayInterval = null;
        this.heartbeatInterval = null;

        this.els = {
            app: document.getElementById('app'),
            video: document.getElementById('video'),
            overlay: document.getElementById('video-overlay'),
            channelName: document.getElementById('channel-name'),
            channelNumber: document.getElementById('channel-number'),
            currentTime: document.getElementById('current-time'),
            totalTime: document.getElementById('total-time'),
            btnLive: document.getElementById('btn-live'),
            btnPlayPause: document.getElementById('btn-play-pause'),
            btnFullscreen: document.getElementById('btn-fullscreen'),
            progressBar: document.getElementById('progress-bar'),
            progressPosition: document.getElementById('progress-position'),
            channelList: document.getElementById('channel-list'),
            searchInput: document.getElementById('search-input'),
            tabFavorites: document.getElementById('tab-favorites'),
            tabRecent: document.getElementById('tab-recent'),
            categoryTabs: document.getElementById('category-tabs'),
            channelItems: document.getElementById('channel-items'),
        };

        this.init();
    }

    async init() {
        this.checkCodecSupport();
        await this.loadChannels();
        this.setupAllListeners();
        document.body.focus();

        var self = this;
        this.timeDisplayInterval = setInterval(function () {
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

    goBack() {
        this.programmaticBack = true;
        history.back();
    }

    checkCodecSupport() {
        var video = this.els.video;
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

        console.log('[PLAYER] Supported codecs:', support);

        if (support.length === 0) {
            this.showIndicator(IndicatorTypes.ERROR_PERMANENT, {message: Messages.VIDEO_CODEC_NOT_SUPPORTED});
            setTimeout(() => this.goBack(), 2000);
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
            console.error('[PLAYER] Failed to load channels:', err);
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
        this.setupTvBackButton();
    }

    setupVideoListeners() {
        var self = this;

        this.els.video.addEventListener('play', function () {
            if (!self.autoFullscreenDone) {
                self.autoFullscreenDone = true;
                self.toggleFullscreen();
            }
            self.updatePlayButtons();
        }, {once: true});

        this.els.video.addEventListener('click', function () {
            self.togglePlay();
        });

        this.els.video.addEventListener('play', function () {
            self.updatePlayButtons();
        });
        this.els.video.addEventListener('pause', function () {
            self.updatePlayButtons();
        });

        this.els.video.addEventListener('waiting', function () {
            self.showIndicator(IndicatorTypes.LOADING, {message: Messages.LOADING});
        });

        this.els.video.addEventListener('playing', function () {
            self.hideIndicator(IndicatorTypes.LOADING);
            if (!self.forceIdle) {
                clearTimeout(self.idleTimer);
                self.idleTimer = setTimeout(function () {
                    if (!self.channelListVisible && !self.els.video.paused && self.plannedSeekPosition === null) {
                        document.body.classList.add('idle');
                    }
                }, self.idleTimeout);
            }
        });

        this.els.video.addEventListener('canplay', function () {
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

        var bufferUrl = '/buffer/' + ChannelUtils.getSafeName(this.currentChannel.name) + '/live.m3u8';
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
                this.hideIndicator(IndicatorTypes.LOADING);
                this.showIndicator(IndicatorTypes.ERROR_PERMANENT, {message: Messages.CHANNEL_FAILED_TO_LOAD});
                setTimeout(() => this.goBack(), 2000);
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
        } else if (this.els.video.canPlayType('application/vnd.apple.mpegurl')) {
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
        this.hls.attachMedia(this.els.video);

        var firstFragmentLoaded = false;

        this.hls.on(Hls.Events.FRAG_LOADED, () => {
            if (!firstFragmentLoaded) {
                firstFragmentLoaded = true;
                this.isLoading = false;
                this.hideIndicator(IndicatorTypes.LOADING);
                this.hideIndicator(IndicatorTypes.ERROR);
                this.els.video.play().catch(() => {
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
                        this.hls.recoverMediaError();
                        break;
                    case HLSErrorDetails.FRAG_LOAD_TIMEOUT:
                    case HLSErrorDetails.MANIFEST_LOAD_TIMEOUT:
                        this.showIndicator(IndicatorTypes.ERROR, {message: Messages.MANIFEST_LOAD_TIMEOUT});
                        this.hls.recoverMediaError();
                        break;
                }
                return;
            }

            this.isLoading = false;
            this.updatePlayButtons();

            switch (data.type) {
                case Hls.ErrorTypes.NETWORK_ERROR:
                    console.error('[HLS] Network error:', details);
                    this.showIndicator(IndicatorTypes.ERROR_PERMANENT, {message: Messages.CONNECTION_LOST});
                    setTimeout(() => this.goBack(), 2000);
                    break;

                case Hls.ErrorTypes.MEDIA_ERROR:
                    console.error('[HLS] Media error:', details);
                    if (details === HLSErrorDetails.BUFFER_DECODING_ERROR || details === HLSErrorDetails.BUFFER_CODEC_ERROR || details === HLSErrorDetails.MANIFEST_INCOMPATIBLE_CODECS_ERROR) {
                        this.showIndicator(IndicatorTypes.ERROR_PERMANENT, {message: Messages.CODEC_NOT_SUPPORTED_TV});
                        setTimeout(() => this.goBack(), 2000);
                    } else {
                        this.showIndicator(IndicatorTypes.ERROR, {message: Messages.PLAYBACK_ERROR_RECOVERING});
                        this.hls.recoverMediaError();
                    }
                    break;

                default:
                    console.error('[HLS] Fatal error:', details);
                    this.showIndicator(IndicatorTypes.ERROR_PERMANENT, {message: Messages.PLAYBACK_ERROR_CHANGE_CHANNEL});
                    setTimeout(() => this.goBack(), 2000);
                    break;
            }
        });
    }

    setupNativeHls(url) {
        this.els.video.src = url;
        this.els.video.addEventListener('loadedmetadata', () => {
            this.hideIndicator(IndicatorTypes.LOADING);
            this.els.video.play().catch(() => {
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
            this.watchHistory = ChannelUtils.addToWatchHistory(this.watchHistory, channel.name);
        } catch (e) {
            console.error('[PLAYER] Watch history error:', e);
        }

        this.updateChannelInfo();

        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }
        this.els.video.pause();
        this.els.video.removeAttribute('src');

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
            this.hideIndicator(IndicatorTypes.LOADING);
            this.showIndicator(IndicatorTypes.ERROR_PERMANENT, {message: Messages.COULD_NOT_CHANGE_CHANNEL});
            setTimeout(() => this.goBack(), 2000);
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
        if (this.els.video.paused) {
            this.els.video.play().catch(() => {
            });
            this.showIndicator(IndicatorTypes.PLAY, {icon: Icons.PLAY});
        } else {
            this.els.video.pause();
            this.showIndicator(IndicatorTypes.PLAY, {icon: Icons.PAUSE});
        }
    }

    goToLive() {
        if (this.els.video.duration && !isNaN(this.els.video.duration) && this.els.video.duration > 0) {
            this.els.video.currentTime = this.els.video.duration;

            if (this.els.video.paused) {
                this.els.video.play().catch(() => {
                });
            }

            this.showIndicator(IndicatorTypes.LIVE);
        }
    }

    seekBack() {
        this.els.video.currentTime = Math.max(0, this.els.video.currentTime - this.seekAmount);
        this.showIndicator(IndicatorTypes.SEEK, {seconds: -this.seekAmount});
    }

    seekForward() {
        this.els.video.currentTime = Math.min(this.els.video.duration || 0, this.els.video.currentTime + this.seekAmount);
        this.showIndicator(IndicatorTypes.SEEK, {seconds: this.seekAmount});
    }

    getRealTime(videoTimeSeconds) {
        if (this.bufferStartTime && !isNaN(videoTimeSeconds)) {
            var videoTime = new Date(this.bufferStartTime + (videoTimeSeconds * 1000));
            return videoTime.toLocaleTimeString('en-US', {hour: '2-digit', minute: '2-digit', second: '2-digit'});
        } else {
            var now = new Date();
            return now.toLocaleTimeString('en-US', {hour: '2-digit', minute: '2-digit', second: '2-digit'});
        }
    }

    showIndicator(type, data) {
        data = data || {};
        var overlay = this.els.overlay;
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
                var planTime = data.time || this.getRealTime(this.els.video.currentTime);
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
            case IndicatorTypes.ERROR_PERMANENT:
                overlay.innerHTML = (data.message || Icons.ERROR + Messages.ERROR);
                overlay.classList.add('error-mode', 'active');
                break;

            case IndicatorTypes.LIVE:
                overlay.innerHTML = Icons.LIVE + Messages.LIVE;
                overlay.classList.add('live-mode', 'active');
                this.overlayTimer = setTimeout(function () {
                    overlay.classList.remove('active');
                    self.overlayType = null;
                    if (self.els.video && self.els.video.readyState < 3 && !self.els.video.paused) {
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
        var overlay = this.els.overlay;
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
        var positionEl = this.els.progressPosition;
        if (!positionEl || !this.els.video.duration) return;

        var positionPercent = (time / this.els.video.duration) * 100;
        positionEl.style.width = positionPercent + '%';
        positionEl.style.background = 'rgba(255, 215, 0, 0.8)';
    }

    planSeek(direction) {
        var baseTime = this.plannedSeekPosition !== null ? this.plannedSeekPosition : this.els.video.currentTime;
        var plannedTime = direction > 0
            ? Math.min(this.els.video.duration || 0, baseTime + this.seekAmount)
            : Math.max(0, baseTime - this.seekAmount);
        plannedTime = Math.round(plannedTime / TimeConstants.SEEK_AMOUNT) * TimeConstants.SEEK_AMOUNT;
        plannedTime = direction > 0
            ? Math.min(this.els.video.duration || 0, plannedTime)
            : Math.max(0, plannedTime);

        this.plannedSeekPosition = plannedTime;
        var diff = Math.round(plannedTime - this.els.video.currentTime);
        var targetTime = this.getRealTime(plannedTime);
        this.showIndicator(IndicatorTypes.PLAN, {seconds: diff, time: targetTime});
        this.updateProgressIndicator(plannedTime);
    }

    toggleChannelList(show) {
        var list = this.els.channelList;
        if (show === undefined) {
            show = list.classList.contains('hidden');
        }
        list.classList.toggle('hidden', !show);
        this.channelListVisible = show;

        if (show) {
            this.setupTabListeners();
            if (!this.selectedCategory && this.currentCategory) {
                this.selectedCategory = this.currentCategory;
            }
            this.switchTab(this.currentTab);
            var activeItem = document.querySelector('.channel-item.active, .fav-item.active, .recent-list-item.active');
            if (activeItem) {
                activeItem.scrollIntoView({block: 'center'});
                activeItem.focus();
            } else {
                var firstItem = document.querySelector('.tab-content:not(.hidden) .channel-item, .tab-content:not(.hidden) .fav-item:not(.empty), .tab-content:not(.hidden) .recent-list-item');
                if (firstItem) {
                    firstItem.scrollIntoView({block: 'center'});
                    firstItem.focus();
                }
            }
        }
    }

    toggleFullscreen() {
        var elem = this.els.app;

        if (window.webOS && webOS.window && webOS.window.setFullScreen) {
            var self = this;
            webOS.window.setFullScreen(true, function () {
                setTimeout(function () { self.els.app.focus(); }, 100);
            });
            return;
        }

        if (!document.fullscreenElement) {
            var requestFn = elem.requestFullscreen || elem.webkitRequestFullscreen
                || elem.mozRequestFullScreen || elem.msRequestFullscreen;
            if (requestFn) requestFn.call(elem).catch(() => {
            });
        } else {
            var exitFn = document.exitFullscreen || document.webkitExitFullscreen
                || document.mozCancelFullScreen || document.msExitFullscreen;
            if (exitFn) exitFn.call(document).catch(() => {
            });
        }
    }

    setupFullscreenFocusRestore() {
        ChannelUtils.setupFullscreenFocusRestore();
    }

    setupTvBackButton() {
        var self = this;
        window.addEventListener('popstate', function () {
            if (self.programmaticBack) {
                self.programmaticBack = false;
                return;
            }

            if (self.channelListVisible) {
                history.pushState(null, null, location.pathname);
                self.toggleChannelList(false);
            } else if (!document.body.classList.contains('idle')) {
                history.pushState(null, null, location.pathname);
                self.forceIdle = true;
                clearTimeout(self.idleTimer);
                document.body.classList.add('idle');
                if (document.activeElement && document.activeElement !== document.body) {
                    document.activeElement.blur();
                }
            } else {
                self.goBack();
            }
        });
    }

    updateChannelInfo() {
        if (this.currentChannel && this.els.channelName && this.els.channelNumber) {
            this.els.channelName.textContent = this.currentChannel.name;
            this.els.channelNumber.textContent = (this.channelIndex + 1).toString();
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

    setupIdleDetection() {
        var self = this;
        this.forceIdle = false;

        var resetIdle = function (e) {
            if (e && e.keyCode && (e.keyCode === PCKeyCodes.ESCAPE || e.keyCode === TVKeyCodes.BACK)) return;
            if (e && (e.type === 'mousemove' || e.type === 'click' || e.type === 'touchstart')) {
                self.forceIdle = false;
            }

            if (self.forceIdle) return;

            document.body.classList.remove('idle');
            clearTimeout(self.idleTimer);
            self.idleTimer = setTimeout(function () {
                if (!self.channelListVisible && !self.els.video.paused && self.plannedSeekPosition === null) {
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

        document.addEventListener('keydown', function (e) {
            if (self.channelListVisible)
                if (self.handleChannelListKeys(e)) return;

            if (self.handleIdleKeys(e)) return;
            self.handleControlBarKeys(e);
            self.handleTvSpecialKeys(e);
            self.handleMediaKeys(e);
        });
    }

    getControlRows() {
        return [
            Array.from(document.querySelectorAll('.control-btn')).filter(function (b) {
                return b.offsetParent !== null;
            }),
            this.els.progressBar,
            Array.from(document.querySelectorAll('.live-btn, .fullscreen-btn')).filter(function (b) {
                return b.offsetParent !== null;
            })
        ];
    }

    findControlPosition(rows) {
        var currentFocus = document.activeElement;
        for (var r = 0; r < rows.length; r++) {
            if (!rows[r] || (Array.isArray(rows[r]) && rows[r].length === 0)) continue;
            if (r === 1) {
                if (currentFocus === rows[r]) return {row: r, col: 0};
            } else {
                var idx = rows[r].indexOf(currentFocus);
                if (idx !== -1) return {row: r, col: idx};
            }
        }
        return {row: -1, col: -1};
    }

    handleChannelListKeys(e) {
        var tabs = ['favorites', 'recent', 'all'];
        var currentIdx = tabs.indexOf(this.currentTab);

        if (e.keyCode === PCKeyCodes.ARROW_LEFT || e.keyCode === PCKeyCodes.ARROW_RIGHT) {
            if (currentIdx !== -1) {
                e.preventDefault();
                var newIdx = e.keyCode === PCKeyCodes.ARROW_RIGHT
                    ? Math.min(currentIdx + 1, tabs.length - 1)
                    : Math.max(currentIdx - 1, 0);
                this.switchTab(tabs[newIdx]);
                var activeTabContent = document.querySelector('.tab-content:not(.hidden)');
                var activeItem = activeTabContent
                    ? activeTabContent.querySelector('.fav-item.active, .recent-list-item.active, .channel-item.active')
                    : null;
                if (activeItem) {
                    activeItem.scrollIntoView({block: 'center'});
                    activeItem.focus();
                } else {
                    var firstItem = activeTabContent
                        ? activeTabContent.querySelector('.fav-item:not(.empty), .recent-list-item, .channel-item')
                        : null;
                    if (firstItem) firstItem.focus();
                }
            }
            return true;
        }

        if (e.target.id === 'search-input') {
            if (e.keyCode === PCKeyCodes.ESCAPE || e.keyCode === TVKeyCodes.BACK) {
                e.preventDefault();
                this.toggleChannelList(false);
            } else if (e.keyCode === PCKeyCodes.ARROW_DOWN) {
                e.preventDefault();
                var firstChannel = document.querySelector('.channel-item');
                if (firstChannel) firstChannel.focus();
            }
            return true;
        }

        if (e.keyCode === PCKeyCodes.ARROW_UP || e.keyCode === PCKeyCodes.ARROW_DOWN) {
            e.preventDefault();
            var activeTabContent = document.querySelector('.tab-content:not(.hidden)');
            var items = activeTabContent
                ? Array.from(activeTabContent.querySelectorAll('.channel-item, .fav-item:not(.empty), .recent-list-item'))
                : [];
            if (items.length === 0) return true;

            var currentIndex = items.indexOf(document.activeElement);
            if (currentIndex === -1) {
                var activeEl = activeTabContent.querySelector('.fav-item.active, .recent-list-item.active, .channel-item.active');
                currentIndex = activeEl ? items.indexOf(activeEl) : 0;
            }
            var targetIndex = (e.keyCode === PCKeyCodes.ARROW_DOWN)
                ? (currentIndex < items.length - 1 ? currentIndex + 1 : 0)
                : (currentIndex > 0 ? currentIndex - 1 : items.length - 1);
            items[targetIndex]?.focus();
            items[targetIndex]?.scrollIntoView({behavior: 'smooth', block: 'nearest'});
            return true;
        }

        if (e.keyCode === PCKeyCodes.ENTER) {
            e.preventDefault();
            var focused = document.querySelector('.channel-item:focus, .fav-item:not(.empty):focus, .recent-list-item:focus');
            if (focused) {
                var idx = parseInt(focused.dataset.index);
                if (!isNaN(idx) && idx >= 0) {
                    this.playChannel(idx);
                    this.toggleChannelList(false);
                }
            }
            return true;
        }

        if (e.keyCode === PCKeyCodes.ESCAPE || e.keyCode === TVKeyCodes.BACK || e.keyCode === TVKeyCodes.BLUE) {
            e.preventDefault();
            this.toggleChannelList(false);
            return true;
        }

        return true;
    }

    handleIdleKeys(e) {
        if (!document.body.classList.contains('idle')) return false;

        this.forceIdle = false;
        switch (e.keyCode) {
            case PCKeyCodes.ARROW_UP:
            case PCKeyCodes.ARROW_DOWN:
                e.preventDefault();
                this.els.progressBar?.focus();
                document.body.classList.remove('idle');
                return true;
            case PCKeyCodes.ARROW_LEFT:
                e.preventDefault();
                this.seekBack();
                return true;
            case PCKeyCodes.ARROW_RIGHT:
                e.preventDefault();
                this.seekForward();
                return true;
        }

        if (e.keyCode !== PCKeyCodes.ESCAPE && e.keyCode !== TVKeyCodes.BACK)
            document.body.classList.remove('idle');
        return false;
    }

    handleControlBarKeys(e) {
        var rows = this.getControlRows();
        var pos = this.findControlPosition(rows);
        var midCol = rows[0] ? Math.floor(rows[0].length / 2) : 0;

        switch (e.keyCode) {
            case PCKeyCodes.ARROW_UP:
                e.preventDefault();
                if (pos.row === -1 || pos.row === 1) {
                    if (rows[0] && rows[0].length > 0) rows[0][midCol]?.focus();
                } else if (pos.row === 0) {
                    this.forceIdle = true;
                    clearTimeout(this.idleTimer);
                    document.body.classList.add('idle');
                    if (document.activeElement && document.activeElement !== document.body) {
                        document.activeElement.blur();
                    }
                } else if (pos.row === 2) {
                    rows[1]?.focus();
                }
                break;

            case PCKeyCodes.ARROW_DOWN:
                e.preventDefault();
                if (pos.row === -1 || pos.row === 0) {
                    rows[1]?.focus();
                } else if (pos.row === 1) {
                    if (rows[2] && rows[2].length > 0) rows[2][0].focus();
                } else if (pos.row === 2) {
                    if (rows[0] && rows[0].length > 0) rows[0][midCol]?.focus();
                }
                break;

            case PCKeyCodes.ARROW_LEFT:
                e.preventDefault();
                if (pos.row === -1) {
                    this.seekBack();
                } else if (pos.row === 1) {
                    this.planSeek(-1);
                } else if (pos.row !== -1 && rows[pos.row] && rows[pos.row].length > 0) {
                    var prevCol = pos.col > 0 ? pos.col - 1 : rows[pos.row].length - 1;
                    rows[pos.row][prevCol].focus();
                }
                break;

            case PCKeyCodes.ARROW_RIGHT:
                e.preventDefault();
                if (pos.row === -1) {
                    this.seekForward();
                } else if (pos.row === 1) {
                    this.planSeek(1);
                } else if (pos.row !== -1 && rows[pos.row] && rows[pos.row].length > 0) {
                    var nextCol = pos.col < rows[pos.row].length - 1 ? pos.col + 1 : 0;
                    rows[pos.row][nextCol].focus();
                }
                break;

            case PCKeyCodes.ENTER:
                e.preventDefault();
                if (pos.row === 1) {
                    if (this.plannedSeekPosition !== null) {
                        this.els.video.currentTime = this.plannedSeekPosition;
                        this.plannedSeekPosition = null;
                        this.hideIndicator();
                    } else {
                        this.togglePlay();
                    }
                } else if (pos.row !== -1) {
                    document.activeElement.click();
                } else {
                    this.togglePlay();
                }
                break;

            case PCKeyCodes.ESCAPE:
                e.preventDefault();
                if (document.body.classList.contains('idle')) {
                    this.goBack();
                } else {
                    this.forceIdle = true;
                    clearTimeout(this.idleTimer);
                    document.body.classList.add('idle');
                    if (document.activeElement && document.activeElement !== document.body) {
                        document.activeElement.blur();
                    }
                }
                break;

            case PCKeyCodes.F_KEY:
                e.preventDefault();
                this.toggleFullscreen();
                break;

            case PCKeyCodes.SPACE:
                e.preventDefault();
                this.togglePlay();
                break;
        }
    }

    handleTvSpecialKeys(e) {
        if (e.keyCode === TVKeyCodes.BACK) {
            e.preventDefault();
            if (this.channelListVisible) {
                this.toggleChannelList(false);
            } else if (!document.body.classList.contains('idle')) {
                this.forceIdle = true;
                clearTimeout(this.idleTimer);
                document.body.classList.add('idle');
                if (document.activeElement && document.activeElement !== document.body) {
                    document.activeElement.blur();
                }
            } else {
                this.goBack();
            }
        }

        if (e.keyCode === PCKeyCodes.PAGE_UP) {
            e.preventDefault();
            this.channelUp();
        }
        if (e.keyCode === PCKeyCodes.PAGE_DOWN) {
            e.preventDefault();
            this.channelDown();
        }

        switch (e.keyCode) {
            case TVKeyCodes.RED:
                e.preventDefault();
                this.goToLive();
                break;
            case TVKeyCodes.YELLOW:
                e.preventDefault();
                this.toggleFullscreen();
                break;
            case TVKeyCodes.BLUE:
                e.preventDefault();
                this.toggleChannelList();
                break;
        }
    }

    handleMediaKeys(e) {
        // TODO Media Keys
    }

    setupMediaKeyEvents() {
        // TODO Media Keys
    }

    bindClick(id, handler) {
        var el = document.getElementById(id);
        if (el) el.addEventListener('click', handler);
        return el;
    }

    setupRemoteButtons() {
        var self = this;

        this.bindClick('btn-play-pause', function () {
            self.togglePlay();
        });
        this.bindClick('btn-live', function () {
            self.goToLive();
        });
        this.bindClick('btn-ch-prev', function () {
            self.channelDown();
        });
        this.bindClick('btn-ch-next', function () {
            self.channelUp();
        });
        this.bindClick('btn-rwnd', function () {
            self.seekBack();
        });
        this.bindClick('btn-fwd', function () {
            self.seekForward();
        });
        this.bindClick('btn-channels', function () {
            self.toggleChannelList();
        });
        this.bindClick('btn-fullscreen', function () {
            self.toggleFullscreen();
        });
        this.bindClick('btn-close-list', function () {
            self.toggleChannelList(false);
        });

        if (this.els.searchInput) {
            this.els.searchInput.addEventListener('input', function (e) {
                self.renderChannelList(e.target.value);
            });
        }

        if (this.els.progressBar) {
            this.els.progressBar.addEventListener('click', function (e) {
                var rect = self.els.progressBar.getBoundingClientRect();
                var percent = (e.clientX - rect.left) / rect.width;
                if (self.els.video.duration) {
                    var newTime = percent * self.els.video.duration;
                    var diff = Math.round(newTime - self.els.video.currentTime);
                    self.els.video.currentTime = newTime;
                    self.showIndicator(IndicatorTypes.PLAN, {
                        seconds: diff, time: self.getRealTime(newTime), autoHide: true
                    });
                }
            });
            this.els.progressBar.addEventListener('focus', function () {
                document.body.classList.remove('idle');
                self.plannedSeekPosition = null;
                self.updateProgress();
            });
            this.els.progressBar.addEventListener('blur', function () {
                self.plannedSeekPosition = null;
                self.updateProgress();
                self.hideIndicator();
            });
        }

        this.bindClick('btn-back', function (e) {
            e.preventDefault();
            self.goBack();
        });
    }

    updatePlayButtons() {
        if (!this.els.btnPlayPause) return;

        var icon = this.els.btnPlayPause.querySelector('.btn-icon');
        if (this.els.video.paused) {
            icon.innerHTML = Icons.PLAY;
        } else {
            icon.innerHTML = Icons.PAUSE;
        }
    }

    updateProgress() {
        if (!this.els.progressPosition) return;
        if (this.plannedSeekPosition !== null) return;

        this.els.progressPosition.style.background = '#00d4ff';

        if (this.els.video.duration) {
            var positionPercent = (this.els.video.currentTime / this.els.video.duration) * 100;
            this.els.progressPosition.style.width = positionPercent + '%';
        } else {
            this.els.progressPosition.style.width = '100%';
        }
    }

    updateTimeDisplay() {
        if (!this.els.currentTime || !this.els.totalTime) return;

        if (this.plannedSeekPosition !== null) {
            return;
        }

        this.els.currentTime.textContent = ChannelUtils.formatTime(Math.floor(this.els.video.currentTime));
        this.els.totalTime.textContent = this.getRealTime(this.els.video.currentTime);

        if (this.els.btnLive) {
            var isAtLive = this.els.video.duration && (this.els.video.duration - this.els.video.currentTime) < TimeConstants.LIVE_POSITION;
            this.els.btnLive.classList.toggle('hidden', isAtLive);
        }

        this.updateProgress();
    }

    setupTabListeners() {
        var self = this;
        var tabs = document.querySelectorAll('.list-tab');
        tabs.forEach(function (tab) {
            tab.onclick = function () {
                self.switchTab(tab.dataset.tab);
            };
        });
    }

    switchTab(tabName) {
        this.currentTab = tabName;

        document.querySelectorAll('.list-tab').forEach(function (btn) {
            btn.classList.toggle('active', btn.dataset.tab === tabName);
        });

        document.querySelectorAll('.tab-content').forEach(function (content) {
            content.classList.add('hidden');
        });

        var tabEl = document.getElementById('tab-' + tabName);
        if (tabEl) tabEl.classList.remove('hidden');

        var searchEl = document.getElementById('tab-search-all');
        if (searchEl) searchEl.classList.toggle('hidden', tabName !== 'all');

        if (tabName === 'favorites') this.renderFavoritesTab();
        else if (tabName === 'recent') this.renderRecentTab();
        else if (tabName === 'all') this.renderAllTab();
    }

    bindChannelItemClick(container, selector) {
        var self = this;
        container.onclick = function (e) {
            var item = e.target.closest(selector);
            if (item) {
                var idx = parseInt(item.dataset.index);
                if (!isNaN(idx) && idx >= 0) {
                    self.playChannel(idx);
                    self.toggleChannelList(false);
                }
            }
        };
    }

    renderFavoritesTab() {
        var container = this.els.tabFavorites;
        if (!container) return;

        var channels = this.channels;

        var html = '';
        for (var i = 0; i < UIConstants.MAX_FAVORITES; i++) {
            var fav = this.favorites[i];
            if (fav) {
                var globalIdx = channels.findIndex(function (ch) {
                    return ch.name === fav.name;
                });
                var isActive = globalIdx === this.channelIndex;
                html += '<div class="fav-item' + (isActive ? ' active' : '') + '" data-index="' + globalIdx + '" tabindex="0">' +
                    '<span class="fav-number">' + (i + 1) + '</span>' +
                    '<span class="fav-name">' + ChannelUtils.escapeHtml(fav.name) + '</span>' +
                    '</div>';
            } else {
                html += '<div class="fav-item empty" tabindex="-1">' +
                    '<span class="fav-number">' + (i + 1) + '</span>' +
                    '<span class="fav-name"></span>' +
                    '</div>';
            }
        }

        container.innerHTML = html;

        this.bindChannelItemClick(container, '.fav-item:not(.empty)');
    }

    renderRecentTab() {
        var container = this.els.tabRecent;
        if (!container) return;

        var self = this;
        var channels = this.channels;

        var sorted = Object.keys(this.watchHistory)
            .map(function (name) {
                var ch = channels.find(function (c) {
                    return c.name === name;
                });
                if (!ch) return null;
                return {name: name, lastWatched: self.watchHistory[name].lastWatched, channel: ch};
            })
            .filter(function (item) {
                return item !== null;
            })
            .sort(function (a, b) {
                return b.lastWatched - a.lastWatched;
            })
            .slice(0, UIConstants.MAX_WATCH_HISTORY);

        if (sorted.length === 0) {
            container.innerHTML = '<div style="text-align:center;color:#666;padding:40px 0;">' + Messages.NO_CHANNELS_WATCHED + '</div>';
            return;
        }

        container.innerHTML = sorted.map(function (item) {
            var globalIdx = channels.indexOf(item.channel);
            var isActive = globalIdx === self.channelIndex;
            var timeStr = new Date(item.lastWatched).toLocaleTimeString('en-US', {hour: '2-digit', minute: '2-digit'});
            return '<div class="recent-list-item' + (isActive ? ' active' : '') + '" data-index="' + globalIdx + '" tabindex="0">' +
                '<span class="recent-name">' + ChannelUtils.escapeHtml(item.name) + '</span>' +
                '<span class="recent-time">' + Messages.TIME + ': ' + timeStr + '</span>' +
                '</div>';
        }).join('');

        this.bindChannelItemClick(container, '.recent-list-item');
    }

    renderAllTab() {
        this.renderCategoryTabs();
        this.renderChannelList();
    }

    renderCategoryTabs() {
        var container = this.els.categoryTabs;
        if (!container) return;

        var self = this;
        var categories = this.getCategories();

        var html = '<button class="cat-tab' + (!this.selectedCategory ? ' active' : '') + '" data-category="">Tumu</button>';
        categories.forEach(function (cat) {
            html += '<button class="cat-tab' + (self.selectedCategory === cat ? ' active' : '') + '" data-category="' + ChannelUtils.escapeHtml(cat) + '">' + ChannelUtils.escapeHtml(cat) + '</button>';
        });
        container.innerHTML = html;

        container.onclick = function (e) {
            var tab = e.target.closest('.cat-tab');
            if (tab) {
                self.selectedCategory = tab.dataset.category || null;
                self.renderCategoryTabs();
                self.renderChannelList();
            }
        };
    }

    getCategories() {
        var catSet = {};
        this.channels.forEach(function (ch) {
            catSet[ch.category] = true;
        });
        return Object.keys(catSet);
    }

    renderChannelList(filter) {
        if (filter === undefined) filter = '';
        var items = this.els.channelItems;
        if (!items) return;

        var self = this;

        var filtered = this.channels;
        if (this.selectedCategory) {
            filtered = this.channels.filter(function (ch) {
                return ch.category === self.selectedCategory;
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
            return '<div class="' + classes + '" data-index="' + idx + '" tabindex="0">' + ChannelUtils.escapeHtml(ch.name) + '</div>';
        }).join('');

        this.bindChannelItemClick(items, '.channel-item');
    }

    destroy() {
        if (this.timeDisplayInterval) {
            clearInterval(this.timeDisplayInterval);
            this.timeDisplayInterval = null;
        }
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
        if (this.overlayTimer) {
            clearTimeout(this.overlayTimer);
            this.overlayTimer = null;
        }
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }
    }
}

document.addEventListener('DOMContentLoaded', function () {
    window.player = new IPTVPlayer();

    window.addEventListener('beforeunload', function () {
        if (window.player) {
            window.player.destroy();
        }
    });
});
