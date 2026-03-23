(function () {
    'use strict';

    var debugPanel = document.getElementById('debug-panel');
    var debugKeyEvents = document.getElementById('debug-key-events');
    var debugLogs = document.getElementById('debug-logs');
    var debugBuildInfo = document.getElementById('debug-build-info');
    var debugClose = document.getElementById('debug-close');

    if (!debugPanel) return;

    var keyEvents = [];
    var logs = [];
    var maxKeyEvents = 20;
    var maxLogs = 50;
    var buildInfo = null;

    function toggleDebugPanel() {
        debugPanel.classList.toggle('hidden');
    }

    function loadBuildInfo() {
        if (!debugBuildInfo) return;

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
                debugBuildInfo.innerHTML = '<div class="debug-build-row"><span class="debug-build-value">Build info unavailable</span></div>';
            });
    }

    function renderBuildInfo() {
        if (!debugBuildInfo || !buildInfo) return;

        var buildTime = buildInfo.buildDate ? new Date(buildInfo.buildDate).toLocaleString('tr-TR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        }) : 'N/A';

        debugBuildInfo.innerHTML =
            '<span class="debug-build-label">Branch:</span> <span class="debug-build-value">' + escapeHtml(buildInfo.branch) + '</span> | ' +
            '<span class="debug-build-label">Commit:</span> <span class="debug-build-value">' + escapeHtml(buildInfo.commit) + '</span> | ' +
            '<span class="debug-build-label">Build:</span> <span class="debug-build-value">' + escapeHtml(buildTime) + '</span>';
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
            time: new Date().toLocaleTimeString()
        };

        keyEvents.push(eventInfo);
        if (keyEvents.length > maxKeyEvents) {
            keyEvents.shift();
        }

        renderKeyEvents();
    }

    function renderKeyEvents() {
        if (!debugKeyEvents) return;
        debugKeyEvents.innerHTML = keyEvents.map(function (e) {
            return '<div class="debug-event-item">' +
                '<span class="debug-event-time">[' + e.time + ']</span> ' +
                '<span class="debug-event-key">key: "' + escapeHtml(e.key) + '"</span> | ' +
                '<span class="debug-event-code">code: "' + escapeHtml(e.code) + '"</span> | ' +
                '<span class="debug-event-which">keyCode: ' + e.keyCode + '</span>' +
                (e.ctrlKey ? ' [Ctrl]' : '') +
                (e.shiftKey ? ' [Shift]' : '') +
                (e.altKey ? ' [Alt]' : '') +
                (e.metaKey ? ' [Meta]' : '') +
                '</div>';
        }).reverse().join('');
    }

    function escapeHtml(text) {
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
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
                time: new Date().toLocaleTimeString()
            });

            if (logs.length > maxLogs) {
                logs.shift();
            }

            renderLogs();
        }

        function renderLogs() {
            if (!debugLogs) return;
            debugLogs.innerHTML = logs.map(function (log) {
                return '<div class="debug-log-item">' +
                    '<span class="debug-log-time">[' + log.time + ']</span> ' +
                    '<span class="debug-log-' + log.type + '">' + escapeHtml(log.message) + '</span>' +
                    '</div>';
            }).reverse().join('');
        }

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

        if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
            e.preventDefault();
            toggleDebugPanel();
        }
    });

    if (debugClose) {
        debugClose.addEventListener('click', toggleDebugPanel);
    }

    loadBuildInfo();

    console.log('[DEBUG] Debug panel initialized. PC: Ctrl/Cmd + Shift + D');
})();
