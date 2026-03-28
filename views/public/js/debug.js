(function () {
    'use strict';

    var debugKeySequence = [];
    var debugKeyTimer = null;

    var els = {
        debugPanel: document.getElementById('debug-panel'),
        debugKeyEvents: document.getElementById('debug-key-events'),
        debugLogs: document.getElementById('debug-logs'),
        debugBuildInfo: document.getElementById('debug-build-info'),
        debugClose: document.getElementById('debug-close'),
    }

    if (!els.debugPanel) return;

    var keyEvents = [];
    var logs = [];
    var maxKeyEvents = 20;
    var maxLogs = 50;
    var buildInfo = null;

    function toggleDebugPanel() {
        els.debugPanel.classList.toggle('hidden');
    }

    function loadBuildInfo() {
        if (!els.debugBuildInfo) return;

        fetch('/api/build-info')
            .then(function (res) {
                return res.json();
            })
            .then(function (data) {
                buildInfo = data;
                renderBuildInfo();
            })
            .catch(function (err) {
                console.error('[DEBUG] Failed to load build info:', err);
                els.debugBuildInfo.innerHTML = '<div class="debug-build-row"><span class="debug-build-value">Build info unavailable</span></div>';
            });
    }

    function renderBuildInfo() {
        if (!els.debugBuildInfo || !buildInfo) return;

        var buildTime = buildInfo.buildDate ? new Date(buildInfo.buildDate).toLocaleString('tr-TR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        }) : 'N/A';

        els.debugBuildInfo.innerHTML =
            '<span class="debug-build-label">Branch:</span> <span class="debug-build-value">' + ChannelUtils.escapeHtml(buildInfo.branch) + '</span> | ' +
            '<span class="debug-build-label">Commit:</span> <span class="debug-build-value">' + ChannelUtils.escapeHtml(buildInfo.commit) + '</span> | ' +
            '<span class="debug-build-label">Build:</span> <span class="debug-build-value">' + ChannelUtils.escapeHtml(buildTime) + '</span>';
    }

    function logKeyEvent(e) {
        var eventInfo = {
            key: e.key || 'N/A',
            code: e.code || 'N/A',
            keyCode: e.keyCode || 'N/A',
            which: e.which || 'N/A',
            ctrlKey: e.ctrlKey,
            shiftKey: e.shiftKey,
            altKey: e.altKey,
            metaKey: e.metaKey,
            time: new Date().toLocaleTimeString('tr-TR')
        };

        keyEvents.push(eventInfo);
        if (keyEvents.length > maxKeyEvents) {
            keyEvents.shift();
        }

        renderKeyEvents();
    }

    function renderKeyEvents() {
        if (!els.debugKeyEvents) return;
        els.debugKeyEvents.innerHTML = keyEvents.map(function (e) {
            return '<div class="debug-event-item">' +
                '<span class="debug-event-time">[' + e.time + ']</span> ' +
                '<span class="debug-event-key">key: "' + ChannelUtils.escapeHtml(e.key) + '"</span> | ' +
                '<span class="debug-event-code">code: "' + ChannelUtils.escapeHtml(e.code) + '"</span> | ' +
                '<span class="debug-event-which">keyCode: ' + e.keyCode + '</span>' +
                (e.ctrlKey ? ' [Ctrl]' : '') +
                (e.shiftKey ? ' [Shift]' : '') +
                (e.altKey ? ' [Alt]' : '') +
                (e.metaKey ? ' [Meta]' : '') +
                '</div>';
        }).reverse().join('');
    }


    if (!window._debugConsolePatched) {
        window._debugConsolePatched = true;

        var originalConsole = {
            log: console.log.bind(console),
            warn: console.warn.bind(console),
            error: console.error.bind(console)
        };

        function addLog(type, args) {
            var message = Array.prototype.slice.call(args).map(function (arg) {
                if (typeof arg === 'object') {
                    try {
                        return JSON.stringify(arg);
                    } catch (e) {
                        return String(arg);
                    }
                }
                return String(arg);
            }).join(' ');

            logs.push({
                type: type,
                message: message,
                time: new Date().toLocaleTimeString('tr-TR')
            });

            if (logs.length > maxLogs) {
                logs.shift();
            }

            renderLogs();
        }

        function addErrorLog(type, message, details) {
            var logMessage = '[' + type + '] ' + message;
            if (details) {
                logMessage += '\n' + details;
            }
            addLog('error', [logMessage]);
        }

        window.onerror = function (message, source, lineno, colno, error) {
            var details = 'Source: ' + (source || 'unknown') + '\nLine: ' + (lineno || '?') + ', Column: ' + (colno || '?');
            if (error && error.stack) {
                details += '\nStack: ' + error.stack.split('\n').slice(0, 3).join('\n');
            }
            addErrorLog('UNCAUGHT ERROR', String(message), details);
            return false;
        };

        window.onunhandledrejection = function (event) {
            var details = 'Promise: ' + (event.promise || 'unknown');
            if (event.reason) {
                details += '\nReason: ' + String(event.reason);
                if (event.reason.stack) {
                    details += '\nStack: ' + event.reason.stack.split('\n').slice(0, 3).join('\n');
                }
            }
            addErrorLog('UNHANDLED PROMISE', String(event.reason), details);
        };

        var renderLogs = function () {
            if (!els.debugLogs) return;
            els.debugLogs.innerHTML = logs.map(function (log) {
                return '<div class="debug-log-item">' +
                    '<span class="debug-log-time">[' + log.time + ']</span> ' +
                    '<span class="debug-log-' + log.type + '">' + ChannelUtils.escapeHtml(log.message) + '</span>' +
                    '</div>';
            }).reverse().join('');
        };

        console.log = function () {
            originalConsole.log.apply(console, arguments);
            addLog('info', arguments);
        };

        console.warn = function () {
            originalConsole.warn.apply(console, arguments);
            addLog('warn', arguments);
        };

        console.error = function () {
            originalConsole.error.apply(console, arguments);
            addLog('error', arguments);
        };

        window._debugRenderLogs = renderLogs;
        window._debugLogs = logs;
    } else {
        if (window._debugLogs) {
            logs = window._debugLogs;
        }
        if (window._debugRenderLogs) {
            renderLogs = window._debugRenderLogs;
        }
    }

    document.addEventListener('keydown', function (e) {
        logKeyEvent(e);

        if (e.keyCode === PCKeyCodes.DIGIT_0) {
            clearTimeout(debugKeyTimer);
            debugKeySequence.push(PCKeyCodes.DIGIT_0);
            if (debugKeySequence.length > 3) debugKeySequence.shift();
            debugKeyTimer = setTimeout(function () {
                debugKeySequence = [];
            }, TimeConstants.DEBUG_SEQUENCE_TIMEOUT);
            return true;
        }

        if (e.keyCode === TVKeyCodes.BLUE) {
            e.preventDefault();
            if (debugKeySequence.length === 3 &&
                debugKeySequence[0] === PCKeyCodes.DIGIT_0 &&
                debugKeySequence[1] === PCKeyCodes.DIGIT_0 &&
                debugKeySequence[2] === PCKeyCodes.DIGIT_0) {
                toggleDebugPanel();
                debugKeySequence = [];
                clearTimeout(debugKeyTimer);
            }
            return true;
        }

        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.keyCode === PCKeyCodes.D_KEY) {
            e.preventDefault();
            toggleDebugPanel();
        }
    });

    if (els.debugClose) {
        els.debugClose.addEventListener('click', toggleDebugPanel);
    }

    loadBuildInfo();

    console.log('[DEBUG] Debug panel initialized. PC: Ctrl/Cmd + Shift + D');
})();
