// IPTV Player - Video Player Page

class IPTVPlayer {
    constructor() {
        this.hls = null;
        this.video = document.getElementById('video');
        this.currentChannel = null;
        this.currentCategory = null;
        this.channels = [];
        this.channelIndex = 0;
        this.channelListVisible = false;
        this.seekAmount = 10;
        this.idleTimer = null;
        this.idleTimeout = 3000;
        this.heartbeatInterval = null;
        this.isLoading = false;
        this.currentUrl = null;
        this.bufferStartTime = null;
        this.plannedSeekPosition = null;

        this.init();
    }

    async init() {
        // Check codec support
        this.checkCodecSupport();

        await this.loadChannels();
        this.setupAllListeners();

        // Update time display every second
        var self = this;
        setInterval(function() { self.updateTimeDisplay(); }, 1000);

        // Check if recording is active
        var res = await fetch('/api/buffer/status');
        var data = await res.json();

        if (data.isRecording && data.currentChannel) {
            // Recording exists, resume playback
            this.bufferStartTime = data.bufferStartTime;
            var channel = this.channels.find(function(ch) { return ch.name === data.currentChannel; });
            if (channel) {
                this.currentChannel = channel;
                this.channelIndex = this.channels.indexOf(channel);
                this.updateChannelInfo();
                this.loadVideoFromBuffer();
                return;
            }
        }

        // No recording - start recording first channel
        if (!this.currentChannel && this.channels.length > 0) {
            this.playChannel(0);
            return;
        }

        // Play current channel
        this.updateChannelInfo();
        this.loadVideoFromBuffer();
    }

    checkCodecSupport() {
        var video = document.getElementById('video');
        var support = [];

        // Check H.264 support
        if (video.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"')) {
            support.push('H.264');
        }

        // Check H.265/HEVC support
        if (video.canPlayType('video/mp4; codecs="hev1.1.6.L93.B0"')) {
            support.push('H.265/HEVC');
        }

        // Check HLS support
        if (Hls.isSupported()) {
            support.push('HLS (hls.js)');
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            support.push('HLS (Native)');
        }

        console.log('Supported codecs:', support);

        if (support.length === 0) {
            this.showError('Video codec desteklenmiyor!');
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
    }

    setupVideoListeners() {
        var self = this;

        // Click on video to toggle play/pause
        this.video.addEventListener('click', function() {
            self.togglePlay();
        });

        // Update play/pause buttons
        this.video.addEventListener('play', function() {
            self.updatePlayButtons();
        });
        this.video.addEventListener('pause', function() {
            self.updatePlayButtons();
        });

        // Show loading when waiting for buffer during playback
        this.video.addEventListener('waiting', function() {
            console.log('[PLAYER] Video waiting for buffer...');
            self.showLoading(true);
        });

        // Hide loading when playing resumes
        this.video.addEventListener('playing', function() {
            console.log('[PLAYER] Video playing');
            self.showLoading(false);
        });

        // Also hide loading on canplay (enough data to play)
        this.video.addEventListener('canplay', function() {
            self.showLoading(false);
        });

        // Focus on any focusable element shows UI
        var focusableSelector = 'button, [tabindex]:not(.channel-item)';
        document.addEventListener('focus', function(e) {
            if (e.target.matches(focusableSelector)) {
                document.body.classList.remove('idle');
            }
        }, true); // Use capture for all focus events
    }

    loadVideoFromBuffer() {
        if (!this.currentChannel) return;

        var bufferUrl = '/buffer/' + this.getSafeName(this.currentChannel.name) + '/live.m3u8';
        this.showLoading(true);

        this.waitForBuffer(bufferUrl)
            .then(() => {
                // Get buffer start time after buffer is ready
                return fetch('/api/buffer/status');
            })
            .then(res => res.json())
            .then(data => {
                this.bufferStartTime = data.bufferStartTime;
                return this.loadVideo(bufferUrl);
            })
            .catch(() => {
                this.showLoading(false);
                this.showError('Kanal yuklenemedi');
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
            maxBufferLength: 1800,
            maxMaxBufferLength: 7200,
            maxLoadingDelay: 10,
            maxRetry: 5,
        });

        this.hls.loadSource(url);
        this.hls.attachMedia(this.video);

        var firstFragmentLoaded = false;

        // Fragment loaded - hide loading
        this.hls.on(Hls.Events.FRAG_LOADED, () => {
            if (!firstFragmentLoaded) {
                firstFragmentLoaded = true;
                this.isLoading = false;
                this.showLoading(false);
                this.video.play().catch(() => {});
                this.updatePlayButtons();
            } else {
                // Buffer recovered during playback
                this.showLoading(false);
            }
        });

        // Buffer stalled - show loading during playback
        this.hls.on(Hls.Events.BUFFER_STALLED, () => {
            if (firstFragmentLoaded) {
                this.showLoading(true);
            }
        });

        this.hls.on(Hls.Events.ERROR, (event, data) => {
            if (data.fatal) {
                this.isLoading = false;
                this.updatePlayButtons();
                switch (data.type) {
                    case Hls.ErrorTypes.NETWORK_ERROR:
                        console.error('[HLS] Network error:', data);
                        this.showError('Baglanti hatasi - Tekrar deneniyor...');
                        this.hls.startLoad();
                        break;
                    case Hls.ErrorTypes.MEDIA_ERROR:
                        console.error('[HLS] Media error:', data);
                        this.showError('Codec hatasi - Kurtariliyor...');
                        this.hls.recoverMediaError();
                        break;
                    default:
                        console.error('[HLS] Fatal error:', data);
                        var errorMsg = 'Oynatma hatasi: ' + (data.details || data.type || 'Bilinmeyen');
                        if (data.details === 'decoderError') {
                            errorMsg = 'Codec desteklenmiyor! TV bu formati oynatamiyor.';
                        }
                        this.showError(errorMsg);
                        break;
                }
            }
        });
    }

    setupNativeHls(url) {
        this.video.src = url;
        this.video.addEventListener('loadedmetadata', () => {
            this.showLoading(false);
            this.video.play().catch(() => {});
            this.isLoading = false;
        }, { once: true });
    }

    async playChannel(index) {
        if (index < 0 || index >= this.channels.length) return;

        this.channelIndex = index;
        var channel = this.channels[index];
        this.currentChannel = channel;
        this.currentCategory = channel.category || null;

        // Update channel info immediately
        this.updateChannelInfo();

        // Stop current playback
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }
        this.video.pause();
        this.video.removeAttribute('src');

        this.showLoading(true);

        try {
            var changeUrl = '/api/channel/change?index=' + index;
            var res = await fetch(changeUrl);
            var data = await res.json();

            // Get buffer start time
            var statusRes = await fetch('/api/buffer/status');
            var statusData = await statusRes.json();
            this.bufferStartTime = statusData.bufferStartTime;

            await this.waitForBuffer(data.bufferUrl);
            this.loadVideo(data.bufferUrl);
        } catch (err) {
            this.showLoading(false);
            this.showError('Kanal degistirilemedi');
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
            this.video.play().catch(() => {});
        } else {
            this.video.pause();
        }
    }

    goToLive() {
        // Jump to the end of the buffer (live edge)
        if (this.video.duration && !isNaN(this.video.duration) && this.video.duration > 0) {
            // Go to the very end (live)
            this.video.currentTime = this.video.duration;

            // Start playing if paused
            if (this.video.paused) {
                this.video.play().catch(() => {});
            }

            // Show feedback
            this.showLiveIndicator();
        }
    }

    seekBack() {
        this.video.currentTime = Math.max(0, this.video.currentTime - this.seekAmount);
        this.showSeekIndicator(-this.seekAmount);
    }

    seekForward() {
        this.video.currentTime = Math.min(this.video.duration || 0, this.video.currentTime + this.seekAmount);
        this.showSeekIndicator(this.seekAmount);
    }

    showLiveIndicator() {
        var overlay = document.getElementById('video-overlay');
        overlay.textContent = 'CANLI';
        overlay.classList.add('show');
        setTimeout(() => overlay.classList.remove('show'), 1000);
    }

    showSeekIndicator(seconds) {
        var overlay = document.getElementById('video-overlay');
        var prefix = seconds > 0 ? '+' : '';
        overlay.textContent = prefix + seconds + ' sn';
        overlay.classList.add('show');
        setTimeout(() => overlay.classList.remove('show'), 1000);
    }

    showPlannedSeekIndicator(plannedSeconds) {
        var overlay = document.getElementById('video-overlay');
        var currentTimeEl = document.getElementById('current-time');

        // Calculate relative time difference (rounded to integer)
        var diff = Math.round(plannedSeconds - this.video.currentTime);
        var prefix = diff > 0 ? '+' : '';
        overlay.textContent = prefix + diff + ' sn';
        overlay.classList.add('show');

        // Also update time display with planned absolute time
        if (currentTimeEl && this.bufferStartTime) {
            var videoTime = new Date(this.bufferStartTime + (Math.round(plannedSeconds) * 1000));
            var videoTimeStr = videoTime.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            currentTimeEl.textContent = videoTimeStr;
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
                input.focus();
            }
        }
    }

    toggleFullscreen() {
        var elem = document.getElementById('app');

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

    updateChannelInfo() {
        var nameEl = document.getElementById('channel-name');
        var numberEl = document.getElementById('channel-number');

        if (this.currentChannel && nameEl && numberEl) {
            nameEl.textContent = this.currentChannel.name;
            numberEl.textContent = (this.channelIndex + 1).toString();
        }
    }

    async waitForBuffer(bufferUrl, maxWait) {
        if (maxWait === undefined) maxWait = 30000;
        var startTime = Date.now();
        var checkInterval = 3000;

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
                // Buffer not ready yet
            }

            await new Promise(resolve => setTimeout(resolve, checkInterval));
        }

        throw new Error('Buffer timeout');
    }

    showLoading(show) {
        var overlay = document.getElementById('video-overlay');
        if (show) {
            overlay.textContent = '⏳ Yükleniyor...';
            overlay.classList.add('show');
        } else {
            overlay.classList.remove('show');
        }
    }

    showError(message) {
        var overlay = document.getElementById('video-overlay');
        overlay.textContent = '❌ ' + message;
        overlay.classList.add('show');
        setTimeout(() => overlay.classList.remove('show'), 3000);
    }

    getSafeName(name) {
        return name.replace(/[^a-zA-Z0-9ğüşıöçĞÜŞİÖÇ_-]/g, '_');
    }

    setupIdleDetection() {
        var self = this;
        this.forceIdle = false;

        var resetIdle = function() {
            // Don't reset idle if we're forcing idle state
            if (self.forceIdle) return;

            document.body.classList.remove('idle');
            clearTimeout(self.idleTimer);
            self.idleTimer = setTimeout(function() {
                if (!self.channelListVisible && !self.video.paused) {
                    document.body.classList.add('idle');
                }
            }, self.idleTimeout);
        };

        ['mousemove', 'keydown', 'click', 'touchstart'].forEach(function(event) {
            document.addEventListener(event, resetIdle);
        });

        resetIdle();
    }

    setupHeartbeat() {
        var self = this;
        this.heartbeatInterval = setInterval(function() {
            fetch('/api/buffer/heartbeat', {
                method: 'GET',
                cache: 'no-cache',
                keepalive: true
            }).catch(() => {});
        }, 30000);
    }

    setupKeyboardEvents() {
        var self = this;
        var input = document.getElementById('search-input');

        // Define rows in order (top to bottom) - skip Row 0 (top bar, usually hidden)
        var getRows = function() {
            return [
                // Row 0: Control buttons
                Array.from(document.querySelectorAll('.control-btn')).filter(function(b) { return b.offsetParent !== null; }),
                // Row 1: Progress bar
                document.getElementById('progress-bar'),
                // Row 2: Bottom buttons
                Array.from(document.querySelectorAll('.live-btn, .fullscreen-btn')).filter(function(b) { return b.offsetParent !== null; })
            ];
        };

        document.addEventListener('keydown', function(e) {
            // ========== CHANNEL LIST MODE ==========
            if (self.channelListVisible) {
                if (e.target.id === 'search-input') {
                    if (e.key === 'Escape' || e.key === 'Exit' || e.keyCode === 1001 || e.keyCode === 1009 || e.keyCode === 461) {
                        e.preventDefault();
                        self.toggleChannelList(false);
                        return;
                    }
                    if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        var firstChannel = document.querySelector('.channel-item');
                        if (firstChannel) firstChannel.focus();
                        return;
                    }
                    return;
                }

                if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                    e.preventDefault();
                    var items = Array.from(document.querySelectorAll('.channel-item'));
                    var currentIndex = items.indexOf(document.activeElement);
                    var targetIndex = (e.key === 'ArrowDown')
                        ? (currentIndex < items.length - 1 ? currentIndex + 1 : 0)
                        : (currentIndex > 0 ? currentIndex - 1 : items.length - 1);
                    items[targetIndex]?.focus();
                    items[targetIndex]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    return;
                }

                if (e.key === 'Enter' || e.key === 'OK') {
                    e.preventDefault();
                    var focused = document.querySelector('.channel-item:focus');
                    if (focused) {
                        var idx = parseInt(focused.dataset.index);
                        self.playChannel(idx);
                        self.toggleChannelList(false);
                    }
                    return;
                }

                if (e.key === 'Escape' || e.key === 'Exit' || e.keyCode === 1001 || e.keyCode === 1009 || e.keyCode === 461) {
                    e.preventDefault();
                    self.toggleChannelList(false);
                    return;
                }

                if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                    e.preventDefault();
                    return;
                }
                return;
            }

            // ========== NORMAL PLAYER MODE ==========
            var currentFocus = document.activeElement;
            var isIdle = document.body.classList.contains('idle');

            // IDLE MODE (UI hidden): No focus, direct actions
            if (isIdle) {
                self.forceIdle = false;
                switch(e.key) {
                    case 'ArrowUp':
                    case 'ArrowDown':
                        e.preventDefault();
                        document.getElementById('progress-bar')?.focus();
                        document.body.classList.remove('idle');
                        return;
                    case 'ArrowLeft':
                        e.preventDefault();
                        self.seekBack();
                        return;
                    case 'ArrowRight':
                        e.preventDefault();
                        self.seekForward();
                        return;
                }
                // Other keys wake up UI
                document.body.classList.remove('idle');
            }

            var rows = getRows();
            var currentRow = -1;
            var currentCol = -1;

            // Find current row and column
            for (var r = 0; r < rows.length; r++) {
                if (rows[r] === null || rows[r].length === 0) continue;

                if (r === 1) { // Progress bar row
                    if (currentFocus === rows[r]) {
                        currentRow = r;
                        currentCol = 0;
                        break;
                    }
                } else { // Button rows
                    var idx = rows[r].indexOf(currentFocus);
                    if (idx !== -1) {
                        currentRow = r;
                        currentCol = idx;
                        break;
                    }
                }
            }

            switch(e.key) {
                case 'ArrowUp':
                    e.preventDefault();
                    if (currentRow === -1) {
                        // No focus - wake up at play/pause (middle of row 0)
                        if (rows[0] && rows[0].length > 0) {
                            var midCol = Math.floor(rows[0].length / 2);
                            rows[0][midCol]?.focus();
                        }
                    } else if (currentRow === 0) {
                        // Control buttons (row 0) -> hide UI
                        self.forceIdle = true;
                        clearTimeout(self.idleTimer);
                        document.body.classList.add('idle');
                        if (document.activeElement && document.activeElement !== document.body) {
                            document.activeElement.blur();
                        }
                    } else if (currentRow === 1) {
                        // Progress bar (row 1) -> control buttons (row 0)
                        if (rows[0] && rows[0].length > 0) {
                            var midCol = Math.floor(rows[0].length / 2);
                            rows[0][midCol]?.focus();
                        }
                    } else if (currentRow === 2) {
                        // Bottom buttons (row 2) -> progress bar (row 1)
                        rows[1]?.focus();
                    }
                    break;

                case 'ArrowDown':
                    e.preventDefault();
                    if (currentRow === -1) {
                        // No focus - wake up at progress bar
                        rows[1]?.focus();
                    } else if (currentRow === 0) {
                        // Control buttons (row 0) -> progress bar (row 1)
                        rows[1]?.focus();
                    } else if (currentRow === 1) {
                        // Progress bar (row 1) -> bottom buttons (row 2)
                        if (rows[2] && rows[2].length > 0) rows[2][0].focus();
                    } else if (currentRow === 2) {
                        // Bottom buttons (row 2) - stay
                        if (rows[2] && rows[2].length > 0) rows[2][0].focus();
                    }
                    break;

                case 'ArrowLeft':
                    e.preventDefault();
                    if (currentRow === -1) {
                        // No focus - seek back directly
                        self.seekBack();
                    } else if (currentRow === 1) {
                        // Progress bar (row 1) -> plan seek back
                        var baseTime = self.plannedSeekPosition !== null ? self.plannedSeekPosition : self.video.currentTime;
                        var plannedTime = Math.max(0, baseTime - self.seekAmount);
                        // Snap to nearest 10 seconds
                        plannedTime = Math.round(plannedTime / 10) * 10;
                        self.plannedSeekPosition = plannedTime;
                        self.showPlannedSeekIndicator(plannedTime);
                        self.updateProgressIndicator(plannedTime);
                    } else if (currentRow !== -1 && rows[currentRow] && rows[currentRow].length > 0) {
                        // Navigate within button rows
                        if (currentCol > 0) {
                            rows[currentRow][currentCol - 1].focus();
                        } else {
                            rows[currentRow][rows[currentRow].length - 1].focus();
                        }
                    }
                    break;

                case 'ArrowRight':
                    e.preventDefault();
                    if (currentRow === -1) {
                        // No focus - seek forward directly
                        self.seekForward();
                    } else if (currentRow === 1) {
                        // Progress bar (row 1) -> plan seek forward
                        var baseTime = self.plannedSeekPosition !== null ? self.plannedSeekPosition : self.video.currentTime;
                        var plannedTime = Math.min(self.video.duration || 0, baseTime + self.seekAmount);
                        // Snap to nearest 10 seconds
                        plannedTime = Math.round(plannedTime / 10) * 10;
                        self.plannedSeekPosition = plannedTime;
                        self.showPlannedSeekIndicator(plannedTime);
                        self.updateProgressIndicator(plannedTime);
                    } else if (currentRow !== -1 && rows[currentRow] && rows[currentRow].length > 0) {
                        // Navigate within button rows
                        if (currentCol < rows[currentRow].length - 1) {
                            rows[currentRow][currentCol + 1].focus();
                        } else {
                            rows[currentRow][0].focus();
                        }
                    }
                    break;

                case 'Enter':
                case 'OK':
                    e.preventDefault();
                    if (currentRow === 1) {
                        // Progress bar focused - execute planned seek
                        if (self.plannedSeekPosition !== null) {
                            self.video.currentTime = self.plannedSeekPosition;
                            self.plannedSeekPosition = null;
                            self.showSeekIndicator(Math.round(self.video.currentTime) + ' sn');
                        } else {
                            self.togglePlay();
                        }
                    } else if (currentRow !== -1) {
                        currentFocus.click();
                    } else {
                        self.togglePlay();
                    }
                    break;

                case 'Escape':
                case 'Exit':
                    e.preventDefault();
                    fetch('/api/buffer/stop', { method: 'POST' }).catch(() => {});
                    history.back();
                    break;

                case 'f':
                case 'F':
                case 'Menu':
                    e.preventDefault();
                    self.toggleFullscreen();
                    break;

                case ' ':
                    e.preventDefault();
                    self.togglePlay();
                    break;
            }

            // ========== TV REMOTE SPECIAL KEYS ==========
            if (e.keyCode === 1001 || e.keyCode === 1009 || e.keyCode === 461) {
                e.preventDefault();
                fetch('/api/buffer/stop', { method: 'POST' }).catch(() => {});
                history.back();
            }

            if (e.keyCode === 1016) {
                e.preventDefault();
                self.toggleFullscreen();
            }

            if (e.keyCode === 427 || e.key === 'ChannelUp') {
                e.preventDefault();
                self.channelUp();
            }
            if (e.keyCode === 428 || e.key === 'ChannelDown') {
                e.preventDefault();
                self.channelDown();
            }

            // ========== COLOR BUTTONS ==========
            switch(e.keyCode) {
                case 403:
                    e.preventDefault();
                    self.goToLive();
                    break;
                case 404:
                    e.preventDefault();
                    self.video.currentTime = Math.min(self.video.duration || 0, self.video.currentTime + 60);
                    self.showSeekIndicator('+1 dk');
                    break;
                case 405:
                    e.preventDefault();
                    self.video.currentTime = Math.max(0, self.video.currentTime - 60);
                    self.showSeekIndicator('-1 dk');
                    break;
                case 406:
                    e.preventDefault();
                    self.toggleChannelList();
                    break;
            }

            if (e.keyCode === 179 || e.key === 'MediaPlayPause' || e.key === 'Play' || e.key === 'Pause') {
                e.preventDefault();
                self.togglePlay();
            }
        });
    }

    setupMediaKeyEvents() {
        var self = this;
        document.addEventListener('mediaplay', function() {
            self.video.play();
            self.updatePlayButtons();
        });

        document.addEventListener('mediapause', function() {
            self.video.pause();
            self.updatePlayButtons();
        });
    }

    setupRemoteButtons() {
        var self = this;
        // Single play/pause toggle button
        var btnPlayPause = document.getElementById('btn-play-pause');
        if (btnPlayPause) {
            btnPlayPause.addEventListener('click', function() {
                self.togglePlay();
            });
        }

        var btnLive = document.getElementById('btn-live');
        if (btnLive) {
            btnLive.addEventListener('click', function() {
                self.goToLive();
            });
        }

        var btnChPrev = document.getElementById('btn-ch-prev');
        if (btnChPrev) {
            btnChPrev.addEventListener('click', function() { self.channelDown(); });
        }

        var btnChNext = document.getElementById('btn-ch-next');
        if (btnChNext) {
            btnChNext.addEventListener('click', function() { self.channelUp(); });
        }

        var btnRewind = document.getElementById('btn-rwnd');
        if (btnRewind) {
            btnRewind.addEventListener('click', function() { self.seekBack(); });
        }

        var btnFwd = document.getElementById('btn-fwd');
        if (btnFwd) {
            btnFwd.addEventListener('click', function() { self.seekForward(); });
        }

        var btnChannels = document.getElementById('btn-channels');
        if (btnChannels) {
            btnChannels.addEventListener('click', function() { self.toggleChannelList(); });
        }

        var btnFullscreen = document.getElementById('btn-fullscreen');
        if (btnFullscreen) {
            btnFullscreen.addEventListener('click', function() { self.toggleFullscreen(); });
        }

        var btnCloseList = document.getElementById('btn-close-list');
        if (btnCloseList) {
            btnCloseList.addEventListener('click', function() { self.toggleChannelList(false); });
        }

        var searchInput = document.getElementById('search-input');
        if (searchInput) {
            searchInput.addEventListener('input', function(e) {
                self.renderChannelList(e.target.value);
            });
        }

        // Progress bar click to seek
        var progressBar = document.getElementById('progress-bar');
        if (progressBar) {
            progressBar.addEventListener('click', function(e) {
                var rect = progressBar.getBoundingClientRect();
                var percent = (e.clientX - rect.left) / rect.width;
                if (self.video.duration) {
                    self.video.currentTime = percent * self.video.duration;
                    self.showSeekIndicator(Math.round(percent * 100) + '%');
                }
            });

            // Focus shows UI and resets planned seek
            progressBar.addEventListener('focus', function() {
                document.body.classList.remove('idle');
                self.plannedSeekPosition = null;
                self.updateProgress(); // Reset progress indicator
            });

            // Blur resets planned seek
            progressBar.addEventListener('blur', function() {
                self.plannedSeekPosition = null;
                self.updateProgress(); // Reset progress indicator
                var overlay = document.getElementById('video-overlay');
                overlay.classList.remove('show');
            });
        }

        // Back button - stop recording and go home
        var backBtn = document.getElementById('btn-back');
        if (backBtn) {
            backBtn.addEventListener('click', function(e) {
                e.preventDefault();
                fetch('/api/buffer/stop', { method: 'POST' }).catch(() => {});
                history.back();
            });
        }
    }

    updatePlayButtons() {
        var btnPlayPause = document.getElementById('btn-play-pause');
        if (!btnPlayPause) return;

        var icon = btnPlayPause.querySelector('.btn-icon');
        if (this.video.paused) {
            icon.textContent = '▶';
            btnPlayPause.classList.add('active');
            btnPlayPause.classList.remove('inactive');
        } else {
            icon.textContent = '⏸';
            btnPlayPause.classList.add('active');
            btnPlayPause.classList.remove('inactive');
        }
    }

    updateProgress() {
        var positionEl = document.getElementById('progress-position');

        if (!positionEl) return;

        // Don't update if we're planning a seek (user is navigating with arrows)
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

        // Don't update time display if planning a seek
        if (this.plannedSeekPosition !== null) {
            return;
        }

        // Left side - Elapsed time (how much we've watched)
        if (!isNaN(this.video.currentTime)) {
            var currentSecs = Math.floor(this.video.currentTime);
            var mins = Math.floor(currentSecs / 60);
            var secs = currentSecs % 60;
            currentTimeEl.textContent = mins + ':' + (secs < 10 ? '0' : '') + secs;
        } else {
            currentTimeEl.textContent = '0:00';
        }

        // Right side - Video time (what time it is in the video)
        if (this.bufferStartTime && !isNaN(this.video.currentTime)) {
            var videoTime = new Date(this.bufferStartTime + (this.video.currentTime * 1000));
            var videoTimeStr = videoTime.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            totalTimeEl.textContent = videoTimeStr;
        } else {
            var now = new Date();
            totalTimeEl.textContent = now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        }

        // Show/hide live button based on whether we're at live edge
        if (liveBtn) {
            var isAtLive = this.video.duration && (this.video.duration - this.video.currentTime) < 5;
            if (isAtLive) {
                liveBtn.classList.add('hidden');
            } else {
                liveBtn.classList.remove('hidden');
            }
        }

        // Also update progress bar
        this.updateProgress();
    }

    renderChannelList(filter) {
        if (filter === undefined) filter = '';
        var items = document.getElementById('channel-items');
        if (!items) return;

        // Only show channels from current category
        var filtered = this.channels;
        if (this.currentCategory) {
            filtered = this.channels.filter(function(ch) {
                return ch.category === self.currentCategory;
            });
        }

        if (filter) {
            filtered = filtered.filter(function(ch) {
                return ch.name.toLowerCase().indexOf(filter.toLowerCase()) !== -1;
            });
        }

        var self = this;
        items.innerHTML = filtered.map(function(ch) {
            var idx = self.channels.indexOf(ch);
            return '<div class="channel-item" data-index="' + idx + '" tabindex="0">' + ch.name + '</div>';
        }).join('');

        items.onclick = function(e) {
            var item = e.target.closest('.channel-item');
            if (item) {
                var idx = parseInt(item.dataset.index);
                self.playChannel(idx);
                self.toggleChannelList(false);
            }
        };
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    window.player = new IPTVPlayer();
});
