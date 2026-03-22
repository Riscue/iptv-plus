// ==================== DEBUG PANEL ====================
// Shared debug panel functionality for all pages
(function() {
    'use strict';

    var debugPanel = document.getElementById('debug-panel');
    var debugKeyEvents = document.getElementById('debug-key-events');
    var debugLogs = document.getElementById('debug-logs');
    var debugClose = document.getElementById('debug-close');

    if (!debugPanel) return;

    var keyEvents = [];
    var logs = [];
    var maxKeyEvents = 20;
    var maxLogs = 50;
    var longPressTimer = null;
    var LONG_PRESS_DURATION = 2000; // 2 seconds

    // Toggle debug panel
    function toggleDebugPanel() {
        debugPanel.classList.toggle('hidden');
    }

    // Log key event
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

    // Render key events
    function renderKeyEvents() {
        if (!debugKeyEvents) return;
        debugKeyEvents.innerHTML = keyEvents.map(function(e) {
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

    // Escape HTML to prevent XSS
    function escapeHtml(text) {
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Console log capture (only once globally)
    if (!window._debugConsolePatched) {
        window._debugConsolePatched = true;

        var originalConsole = {
            log: console.log.bind(console),
            warn: console.warn.bind(console),
            error: console.error.bind(console)
        };

        function addLog(type, args) {
            var message = Array.prototype.slice.call(args).map(function(arg) {
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
            debugLogs.innerHTML = logs.map(function(log) {
                return '<div class="debug-log-item">' +
                    '<span class="debug-log-time">[' + log.time + ']</span> ' +
                    '<span class="debug-log-' + log.type + '">' + escapeHtml(log.message) + '</span>' +
                    '</div>';
            }).reverse().join('');
        }

        // Override console methods globally
        console.log = function() {
            originalConsole.log.apply(console, arguments);
            addLog('info', arguments);
        };

        console.warn = function() {
            originalConsole.warn.apply(console, arguments);
            addLog('warn', arguments);
        };

        console.error = function() {
            originalConsole.error.apply(console, arguments);
            addLog('error', arguments);
        };

        // Store render function globally for other instances
        window._debugRenderLogs = renderLogs;
        window._debugLogs = logs;
    } else {
        // Already patched, just sync logs
        if (window._debugLogs) {
            logs = window._debugLogs;
        }
        if (window._debugRenderLogs) {
            renderLogs = window._debugRenderLogs;
        }
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', function(e) {
        // Log all key events
        logKeyEvent(e);

        // PC: Toggle debug panel with Ctrl/Cmd + Shift + D
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
            e.preventDefault();
            toggleDebugPanel();
            return;
        }

        // TV Remote: Info button long press (keyCode 457, 1018, or key === 'Info')
        if (e.keyCode === 457 || e.keyCode === 1018 || e.key === 'Info') {
            if (!longPressTimer) {
                longPressTimer = setTimeout(function() {
                    toggleDebugPanel();
                    longPressTimer = null;
                }, LONG_PRESS_DURATION);
            }
        }
    });

    document.addEventListener('keyup', function(e) {
        // Cancel long press if released early
        if (e.keyCode === 457 || e.keyCode === 1018 || e.key === 'Info') {
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }
        }
    });

    // Close button
    if (debugClose) {
        debugClose.addEventListener('click', toggleDebugPanel);
    }

    console.log('[DEBUG] Debug panel initialized. PC: Ctrl/Cmd + Shift + D | TV: Info tuşuna 2 sn basılı tut.');
})();
