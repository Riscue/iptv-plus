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
    forceRecoveryTimeout,
    retryBaseDelay,
    maxRetries: maxRetriesConstant
} = require('./constants');
const logger = require('./logger');

let ffmpegProcess = null;
let currentChannelName = null;
let cleanupInterval = null;
let activityInterval = null;
let lastActivity = Date.now();
let bufferStartTime = null;
let onStopCallback = null;
let currentChannelUrl = null;
let isStopping = false;
let restartAttempts = 0;

class BufferController {

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

    static getLastSegmentNumber(channelPath) {
        if (!fs.existsSync(channelPath)) return 0;

        const files = fs.readdirSync(channelPath);
        const tsFiles = files.filter(f => f.endsWith('.ts'));

        if (tsFiles.length === 0) return 0;

        const numbers = tsFiles
            .map(f => parseInt(f.replace('.ts', ''), 10))
            .filter(n => !isNaN(n));

        return numbers.length > 0 ? Math.max(...numbers) : 0;
    }

    static removeEndList(m3u8Path) {
        if (!fs.existsSync(m3u8Path)) return;

        try {
            const content = fs.readFileSync(m3u8Path, 'utf-8');
            if (content.includes('#EXT-X-ENDLIST')) {
                fs.writeFileSync(m3u8Path, content.replace(/#EXT-X-ENDLIST\s*/g, ''));
                logger.log('BUFFER', 'Removed #EXT-X-ENDLIST from m3u8');
            }
        } catch (err) {
            logger.error('BUFFER', 'Failed to remove endlist:', err.message);
        }
    }

    static async autoRestart() {
        if (isStopping || !currentChannelName || !currentChannelUrl) return;

        restartAttempts++;
        if (restartAttempts > maxRetriesConstant) {
            logger.error('BUFFER', 'Max restart attempts reached (' + maxRetriesConstant + '), giving up');
            return;
        }

        const delay = retryBaseDelay * Math.pow(2, restartAttempts - 1);
        logger.log('BUFFER', 'Auto-restart attempt ' + restartAttempts + '/' + maxRetriesConstant + ' in ' + delay + 'ms...');

        await new Promise(resolve => setTimeout(resolve, delay));

        if (isStopping || !currentChannelName) return;

        const channelPath = BufferController.getChannelBufferPath(currentChannelName);
        const m3u8Path = path.join(channelPath, 'live.m3u8');

        BufferController.removeEndList(m3u8Path);

        try {
            await BufferController.startBuffer({name: currentChannelName, url: currentChannelUrl});
            restartAttempts = 0;
            logger.log('BUFFER', 'Auto-restart successful');
        } catch (err) {
            logger.error('BUFFER', 'Auto-restart failed:', err.message);
        }
    }

    static async startBuffer(channel) {
        const channelPath = BufferController.getChannelBufferPath(channel.name);
        fs.mkdirSync(channelPath, {recursive: true});

        const m3u8Path = path.join(channelPath, 'live.m3u8');
        const segmentPath = path.join(channelPath, '%08d.ts');

        const maxSegments = Math.floor((bufferDurationMinutes * 60) / segmentDuration);
        const lastSegmentNumber = BufferController.getLastSegmentNumber(channelPath);

        const ffmpegArgs = [
            '-user_agent', 'Mozilla/5.0',
            '-i', channel.url,
            '-c', 'copy',
            '-f', 'hls',
            '-hls_time', String(segmentDuration),
            '-hls_list_size', String(maxSegments),
            '-hls_flags', 'delete_segments+append_list+independent_segments',
            '-hls_segment_filename', segmentPath,
        ];

        if (lastSegmentNumber > 0) {
            ffmpegArgs.push('-hls_start_number', String(lastSegmentNumber + 1));
            logger.log('BUFFER', 'Continuing from segment:', lastSegmentNumber + 1);
        }

        ffmpegArgs.push(m3u8Path);

        logger.log('BUFFER', 'Starting FFmpeg for channel:', channel.name);
        logger.log('BUFFER', 'URL:', channel.url);
        logger.log('BUFFER', 'Output:', m3u8Path, '| Max segments:', maxSegments, '(' + bufferDurationMinutes + ' min retention)');

        ffmpegProcess = spawn('ffmpeg', ffmpegArgs);

        ffmpegProcess.on('error', (err) => {
            logger.error('BUFFER', 'FFmpeg spawn error:', err.message);
        });

        ffmpegProcess.stderr.on('data', (data) => {
            const msg = data.toString();
            if (msg.toLowerCase().includes('error')) {
                logger.error('FFmpeg', msg.trim());
            }
        });

        ffmpegProcess.on('exit', async (code, signal) => {
            ffmpegProcess = null;

            if (isStopping || signal === 'SIGTERM' || signal === 'SIGINT') {
                logger.log('BUFFER', 'FFmpeg stopped by user');
            } else if (code === 0) {
                logger.log('BUFFER', 'FFmpeg exited normally, attempting auto-restart...');
                await BufferController.autoRestart();
            } else {
                logger.log('BUFFER', 'FFmpeg crashed (code:', code, '), attempting auto-restart...');
                await BufferController.autoRestart();
            }
        });

        currentChannelName = channel.name;
        currentChannelUrl = channel.url;
        if (!bufferStartTime) {
            bufferStartTime = Date.now();
        }
        BufferController.updateActivity();
        BufferController.startCleanup();

        logger.log('BUFFER', 'Recording started for:', channel.name);
        return m3u8Path;
    }

    static async startBufferWithRetry(channel, maxRetries = maxRetriesConstant) {
        let lastError = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await BufferController.startBuffer(channel);
            } catch (err) {
                lastError = err;
                logger.error('BUFFER', `startBuffer attempt ${attempt}/${maxRetries} failed:`, err.message);

                if (attempt < maxRetries) {
                    await BufferController.stopBuffer();
                    const delay = Math.pow(2, attempt - 1) * retryBaseDelay;
                    logger.log('BUFFER', `Retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        throw new Error(`Failed to start buffer after ${maxRetries} attempts: ${lastError.message}`);
    }

    static async stopBuffer() {
        isStopping = true;

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
        if (onStopCallback) onStopCallback();
        logger.log('BUFFER', 'Recording stopped');
        isStopping = false;
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

    static async forceRecover() {
        logger.log('BUFFER', 'Force recovery initiated');
        isStopping = true;

        if (BufferController.isRecording()) {
            try {
                await BufferController.gracefulShutdown(ffmpegProcess, forceRecoveryTimeout);
            } catch (err) {
                logger.error('BUFFER', 'Error during force recovery:', err.message);
            }
            ffmpegProcess = null;
        }

        try {
            await BufferController.cleanupOrphanedProcesses();
        } catch (err) {
            logger.error('BUFFER', 'Failed to cleanup orphaned processes:', err.message);
        }

        restartAttempts = 0;
        isStopping = false;
        logger.log('BUFFER', 'Force recovery completed');
    }

    static async changeChannel(newChannel) {
        BufferController.updateActivity();
        restartAttempts = 0;
        logger.log('BUFFER', 'Changing channel:', currentChannelName, '->', newChannel.name);
        await BufferController.stopBuffer();
        return await BufferController.startBufferWithRetry(newChannel);
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
            isRecording: BufferController.isRecording(),
            currentChannel: currentChannelName,
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
        if (inactiveTime > activityTimeout) {
            const inactiveMinutes = Math.floor(inactiveTime / 60000);
            logger.log('BUFFER', 'No activity for ' + inactiveMinutes + ' minutes, stopping recording');
            await BufferController.stopBuffer();
        }
    }

    static heartbeat(req, res) {
        BufferController.updateActivity();
        res.json({
            isRecording: BufferController.isRecording(),
            currentChannel: currentChannelName
        });
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

    static cleanupOrphaned() {
        BufferController.cleanupOrphanedProcesses().catch(err => {
            logger.error('BUFFER', 'cleanupOrphanedProcesses failed:', err.message);
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
