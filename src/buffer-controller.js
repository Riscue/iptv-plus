const fs = require('fs');
const path = require('path');
const {spawn} = require('child_process');
const {
    bufferDir,
    bufferDurationMinutes,
    segmentDuration,
    activityTimeout,
    activityCheckInterval,
    cleanupInterval: cleanupIntervalMs,
    gracefulShutdownTimeout,
    forceKillTimeout,
    retryBaseDelay,
    retryMaxDelay,
    inputReadTimeout
} = require('./constants');
const logger = require('./logger');

let ffmpegProcess = null;
let currentChannelName = null;
let cleanupInterval = null;
let activityInterval = null;
let lastActivity = Date.now();
let activityTimeoutMs = activityTimeout;
let bufferStartTime = null;
let onStopCallback = null;
let currentChannelUrl = null;
let generation = 0;
let operationQueue = Promise.resolve();
let restartAttempts = 0;
let restartResetTimer = null;
let nextRetryAt = null;
let lastError = null;

const FFMPEG_ERROR_PATTERN = /error|failed|returned|refused|timed out|not found|denied|invalid/i;

class BufferController {

    static withLock(fn) {
        const run = operationQueue.then(fn);
        operationQueue = run.catch(() => {
        });
        return run;
    }

    static isRecording() {
        return ffmpegProcess !== null;
    }

    static setOnStop(callback) {
        onStopCallback = callback;
    }

    static getSafeName(name) {
        return name.replace(/[^a-zA-Z0-9ğüşıöçĞÜŞİÖÇ_-]/g, '_');
    }

    static getChannelBufferPath(channelName) {
        const safeName = BufferController.getSafeName(channelName);
        return path.join(bufferDir, safeName);
    }

    static formatFfmpegError(line) {
        return line
            .replace(/^\[[^\]]*@ 0x[0-9a-f]+\]\s*/i, '')
            .replace(/\b[a-z]+:\/\/\S+?:\s+/gi, '')
            .replace(/\b[a-z]+:\/\/\S+/gi, '<url>')
            .trim();
    }

    static getState() {
        let state = 'idle';
        if (currentChannelName) {
            if (nextRetryAt || restartAttempts > 0) state = 'retrying';
            else if (BufferController.isRecording()) state = 'recording';
            else state = 'failed';
        }
        return {
            state,
            isRecording: BufferController.isRecording(),
            currentChannel: currentChannelName,
            attempt: restartAttempts,
            nextRetryIn: nextRetryAt ? Math.max(0, nextRetryAt - Date.now()) : null,
            stopsIn: currentChannelName ? Math.max(0, activityTimeoutMs - (Date.now() - lastActivity)) : null,
            lastError
        };
    }

    static async autoRestart(processGeneration) {
        if (processGeneration !== generation || !currentChannelName || !currentChannelUrl) return;

        if (Date.now() - lastActivity > activityTimeoutMs) {
            logger.log('BUFFER', 'No activity, giving up auto-restart');
            await BufferController.withLock(async () => {
                if (processGeneration === generation) await BufferController.stopBufferUnlocked();
            });
            return;
        }

        restartAttempts++;
        const delay = Math.min(retryBaseDelay * Math.pow(2, restartAttempts - 1), retryMaxDelay);
        logger.log('BUFFER', 'Auto-restart attempt ' + restartAttempts + ' in ' + delay + 'ms...');

        nextRetryAt = Date.now() + delay;
        await new Promise(resolve => setTimeout(resolve, delay));

        await BufferController.withLock(async () => {
            if (processGeneration === generation) nextRetryAt = null;
            if (processGeneration !== generation || BufferController.isRecording() || !currentChannelName) {
                logger.log('BUFFER', 'Auto-restart cancelled, state changed during delay');
                return;
            }

            try {
                await BufferController.startBuffer({name: currentChannelName, url: currentChannelUrl});
                logger.log('BUFFER', 'Auto-restart successful');
            } catch (err) {
                logger.error('BUFFER', 'Auto-restart failed:', err.message);
            }
        });
    }

    static async startBuffer(channel) {
        const channelPath = BufferController.getChannelBufferPath(channel.name);
        fs.mkdirSync(channelPath, {recursive: true});

        const m3u8Path = path.join(channelPath, 'live.m3u8');
        const segmentPath = path.join(channelPath, '%08d.ts');

        const maxSegments = Math.floor((bufferDurationMinutes * 60) / segmentDuration);

        const ffmpegArgs = [
            '-user_agent', 'Mozilla/5.0',
            '-rw_timeout', String(inputReadTimeout * 1000),
            '-i', channel.url,
            '-c', 'copy',
            '-f', 'hls',
            '-hls_time', String(segmentDuration),
            '-hls_list_size', String(maxSegments),
            '-hls_flags', 'delete_segments+append_list+independent_segments+discont_start+omit_endlist',
            '-hls_segment_filename', segmentPath,
            m3u8Path
        ];

        logger.log('BUFFER', 'Starting FFmpeg for channel:', channel.name);
        logger.log('BUFFER', 'URL:', channel.url);
        logger.log('BUFFER', 'Output:', m3u8Path, '| Max segments:', maxSegments, '(' + bufferDurationMinutes + ' min retention)');

        const proc = spawn('ffmpeg', ffmpegArgs);
        const processGeneration = ++generation;
        ffmpegProcess = proc;

        proc.on('error', (err) => {
            if (err.code === 'ENOENT') {
                logger.error('BUFFER', 'ffmpeg not found, it must be installed and available on PATH');
                lastError = 'ffmpeg not found on server';
            } else {
                logger.error('BUFFER', 'FFmpeg spawn error:', err.message);
            }
            // A failed spawn emits 'error' but never 'exit', so clear the state here
            if (proc.pid === undefined && ffmpegProcess === proc) {
                ffmpegProcess = null;
            }
        });

        proc.stderr.on('data', (data) => {
            const lines = data.toString().split('\n').filter(line => FFMPEG_ERROR_PATTERN.test(line));
            if (lines.length === 0) return;
            logger.error('FFmpeg', lines.join('\n').trim());
            if (ffmpegProcess === proc) {
                lastError = BufferController.formatFfmpegError(lines[lines.length - 1]);
            }
        });

        proc.on('exit', async (code, signal) => {
            if (ffmpegProcess !== proc) return;
            ffmpegProcess = null;

            if (processGeneration !== generation || signal === 'SIGTERM' || signal === 'SIGINT') {
                logger.log('BUFFER', 'FFmpeg stopped by user');
            } else if (code === 0) {
                logger.log('BUFFER', 'FFmpeg exited normally, attempting auto-restart...');
                if (!lastError) lastError = 'Source stream ended or timed out';
                await BufferController.autoRestart(processGeneration);
            } else {
                logger.log('BUFFER', 'FFmpeg crashed (code:', code, '), attempting auto-restart...');
                if (!lastError) lastError = 'FFmpeg exited with code ' + code;
                await BufferController.autoRestart(processGeneration);
            }
        });

        currentChannelName = channel.name;
        currentChannelUrl = channel.url;
        if (!bufferStartTime) {
            bufferStartTime = Date.now();
        }
        BufferController.startCleanup();

        if (restartResetTimer) clearTimeout(restartResetTimer);
        restartResetTimer = setTimeout(() => {
            if (BufferController.isRecording()) {
                restartAttempts = 0;
                lastError = null;
                logger.log('BUFFER', 'Stream stable, restart attempts reset');
            }
        }, 30000);

        logger.log('BUFFER', 'Recording started for:', channel.name);
        return m3u8Path;
    }

    static stopBuffer() {
        return BufferController.withLock(() => BufferController.stopBufferUnlocked());
    }

    static async stopBufferUnlocked() {
        generation++;

        if (restartResetTimer) {
            clearTimeout(restartResetTimer);
            restartResetTimer = null;
        }

        if (BufferController.isRecording()) {
            logger.log('BUFFER', 'Stopping recording:', currentChannelName);
            await BufferController.gracefulShutdown(ffmpegProcess);
            ffmpegProcess = null;
        }

        if (cleanupInterval) {
            clearInterval(cleanupInterval);
            cleanupInterval = null;
        }
        if (activityInterval) {
            clearInterval(activityInterval);
            activityInterval = null;
        }

        if (currentChannelName) {
            const channelPath = BufferController.getChannelBufferPath(currentChannelName);
            logger.log('BUFFER', 'Cleaning up buffer directory:', channelPath);
            try {
                BufferController.cleanupChannel(channelPath);
            } catch (err) {
                logger.error('BUFFER', 'Failed to cleanup channel directory:', err.message);
            }
        }

        currentChannelName = null;
        currentChannelUrl = null;
        bufferStartTime = null;
        restartAttempts = 0;
        nextRetryAt = null;
        lastError = null;
        if (onStopCallback) onStopCallback();
        logger.log('BUFFER', 'Recording stopped');
    }

    static async gracefulShutdown(childProcess, timeoutMs = gracefulShutdownTimeout) {
        if (!childProcess) return;

        return new Promise((resolve) => {
            let resolved = false;
            let killTimer = null;
            let forceTimer = null;

            const exitHandler = () => {
                if (!resolved) {
                    resolved = true;
                    if (killTimer) clearTimeout(killTimer);
                    if (forceTimer) clearTimeout(forceTimer);
                    resolve();
                }
            };

            childProcess.once('exit', exitHandler);
            childProcess.kill('SIGTERM');

            killTimer = setTimeout(() => {
                if (!resolved && childProcess) {
                    logger.log('BUFFER', 'Force killing after timeout');
                    childProcess.kill('SIGKILL');

                    forceTimer = setTimeout(() => {
                        if (!resolved) {
                            resolved = true;
                            resolve();
                        }
                    }, forceKillTimeout);
                }
            }, timeoutMs);
        });
    }

    static changeChannel(newChannel) {
        return BufferController.withLock(async () => {
            BufferController.updateActivity();

            if (currentChannelName === newChannel.name && BufferController.isRecording()) {
                logger.log('BUFFER', 'Same channel requested, keeping current recording');
                return;
            }

            restartAttempts = 0;
            logger.log('BUFFER', 'Changing channel:', currentChannelName, '->', newChannel.name);
            await BufferController.stopBufferUnlocked();
            activityTimeoutMs = activityTimeout;
            await BufferController.startBuffer(newChannel);
        });
    }

    static getStatus(req, res) {
        const channelPath = currentChannelName ? BufferController.getChannelBufferPath(currentChannelName) : null;

        let segmentCount = 0;
        let totalSize = 0;

        if (channelPath && fs.existsSync(channelPath)) {
            const files = fs.readdirSync(channelPath);
            const tsFiles = files.filter(f => f.endsWith('.ts'));
            segmentCount = tsFiles.length;

            tsFiles.forEach(f => {
                const filePath = path.join(channelPath, f);
                try {
                    totalSize += fs.statSync(filePath).size;
                } catch (e) {
                }
            });
        }

        res.json({
            ...BufferController.getState(),
            recording: BufferController.isRecording(),
            segmentCount,
            totalSize,
            durationMinutes: segmentCount * segmentDuration / 60,
            bufferStartTime: bufferStartTime
        });
    }

    static startCleanup() {
        if (cleanupInterval) clearInterval(cleanupInterval);
        cleanupInterval = setInterval(() => {
            BufferController.cleanupOldSegments();
        }, cleanupIntervalMs);

        BufferController.cleanupOldSegments();

        if (activityInterval) clearInterval(activityInterval);
        activityInterval = setInterval(BufferController.checkActivity, activityCheckInterval);
    }

    static updateActivity() {
        lastActivity = Date.now();
    }

    static async checkActivity() {
        if (!BufferController.isRecording()) return;

        const inactiveTime = Date.now() - lastActivity;
        if (inactiveTime > activityTimeoutMs) {
            const inactiveMinutes = Math.floor(inactiveTime / 60000);
            logger.log('BUFFER', 'No activity for ' + inactiveMinutes + ' minutes, stopping recording');
            await BufferController.stopBuffer();
        }
    }

    static state(req, res) {
        res.json(BufferController.getState());
    }

    static heartbeat(req, res) {
        BufferController.updateActivity();
        res.json(BufferController.getState());
    }

    static setTimeout(req, res) {
        const timeout = parseInt(req.query.timeout);
        if (timeout && timeout > 0) {
            activityTimeoutMs = timeout;
            logger.log('BUFFER', 'Timeout set to ' + Math.floor(timeout / 60000) + ' minutes');
        }
        res.json({success: true, timeout: activityTimeoutMs});
    }

    static async stop(req, res) {
        logger.log('BUFFER', 'Stop requested via API');
        await BufferController.stopBuffer();
        res.json({success: true});
    }

    static cleanupAllBuffers() {
        try {
            if (fs.existsSync(bufferDir)) {
                const channels = fs.readdirSync(bufferDir);
                if (channels.length > 0) {
                    channels.forEach(channel => {
                        const channelPath = path.join(bufferDir, channel);
                        if (fs.statSync(channelPath).isDirectory()) {
                            fs.rmSync(channelPath, {recursive: true, force: true});
                        }
                    });
                    logger.log('BUFFER', 'Cleaned up ' + channels.length + ' old buffer(s)');
                }
            }
        } catch (err) {
            logger.error('BUFFER', 'Cleanup error:', err.message);
        }
    }

    static cleanupOldSegments() {
        if (!currentChannelName) return;

        const channelPath = BufferController.getChannelBufferPath(currentChannelName);
        if (!fs.existsSync(channelPath)) return;

        try {
            const files = fs.readdirSync(channelPath);
            const tsFiles = files.filter(f => f.endsWith('.ts')).sort();

            const maxSegments = Math.floor((bufferDurationMinutes * 60) / segmentDuration);

            if (tsFiles.length > maxSegments + (3 * 60 / segmentDuration)) {
                const toRemove = tsFiles.slice(0, tsFiles.length - maxSegments);

                toRemove.forEach(file => {
                    const filePath = path.join(channelPath, file);
                    try {
                        fs.unlinkSync(filePath);
                    } catch (e) {
                        logger.error('BUFFER', 'Failed to delete old segment:', file, e.message);
                    }
                });

                logger.log('BUFFER', 'Safety cleanup: removed ' + toRemove.length + ' orphaned segments');
            }
        } catch (err) {
            logger.error('BUFFER', 'Segment cleanup error:', err.message);
        }
    }

    static cleanupChannel(channelPath) {
        try {
            if (fs.existsSync(channelPath)) {
                fs.rmSync(channelPath, {recursive: true, force: true});
            }
        } catch (err) {
            logger.error('BUFFER', 'Channel cleanup error:', err.message);
            throw err;
        }
    }

    static async cleanupOrphanedProcesses() {
        const bufferPath = bufferDir.replace(/[^a-zA-Z0-9/_.-]/g, '');

        return new Promise((resolve, reject) => {
            const ps = spawn('sh', ['-c', `ps aux | grep -E 'ffmpeg.*${bufferPath}' | grep -v grep`]);

            let output = '';
            ps.stdout.on('data', (data) => {
                output += data.toString();
            });

            ps.on('close', (code) => {
                if (code !== 0 || !output.trim()) {
                    resolve();
                    return;
                }

                const lines = output.trim().split('\n');
                const pids = lines.map(line => {
                    const parts = line.trim().split(/\s+/);
                    return parseInt(parts[1]);
                }).filter(pid => !isNaN(pid));

                if (pids.length === 0) {
                    resolve();
                    return;
                }

                logger.log('BUFFER', 'Found orphaned FFmpeg processes:', pids.length);

                let killed = 0;
                pids.forEach(pid => {
                    try {
                        process.kill(pid, 'SIGTERM');
                        killed++;
                    } catch (err) {
                        if (err.code !== 'ESRCH') {
                            logger.error('BUFFER', `Failed to kill PID ${pid}:`, err.message);
                        }
                    }
                });

                if (killed > 0) {
                    logger.log('BUFFER', `Killed ${killed} orphaned FFmpeg process(es)`);
                }
                resolve();
            });

            ps.on('error', (err) => {
                logger.error('BUFFER', 'Failed to list processes:', err.message);
                reject(err);
            });
        });
    }

    static async cleanupAll() {
        logger.log('BUFFER', 'Cleaning up all resources');

        await BufferController.stopBuffer();

        try {
            await BufferController.cleanupOrphanedProcesses();
        } catch (err) {
            logger.error('BUFFER', 'Failed to cleanup orphaned processes:', err.message);
        }

        try {
            BufferController.cleanupAllBuffers();
        } catch (err) {
            logger.error('BUFFER', 'Failed to cleanup all buffers:', err.message);
        }

        logger.log('BUFFER', 'All resources cleaned up');
    }
}

module.exports = BufferController;
