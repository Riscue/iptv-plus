const fs = require('fs');
const path = require('path');
const {spawn} = require('child_process');
const {bufferDir, bufferDurationMinutes, segmentDuration} = require('./constants');
const logger = require('./logger');

let ffmpegProcess = null;
let currentChannelName = null;
let cleanupInterval = null;
let activityInterval = null;
let lastActivity = Date.now();
let bufferStartTime = null;

const ACTIVITY_TIMEOUT = 300000;

class BufferController {

    static getSafeName(name) {
        return name.replace(/[^a-zA-Z0-9ğüşıöçĞÜŞİÖÇ_-]/g, '_');
    }

    static getChannelBufferPath(channelName) {
        const safeName = BufferController.getSafeName(channelName);
        return path.join(bufferDir, safeName);
    }

    static async startBuffer(channel) {
        const channelPath = BufferController.getChannelBufferPath(channel.name);
        fs.mkdirSync(channelPath, {recursive: true});

        const m3u8Path = path.join(channelPath, 'live.m3u8');
        const segmentPath = path.join(channelPath, '%08d.ts');

        const ffmpegArgs = ['-user_agent', 'Mozilla/5.0', '-i', channel.url, '-c', 'copy', '-f', 'hls', '-hls_time', '5', '-hls_list_size', '0', '-hls_flags', 'delete_segments+append_list+independent_segments', '-hls_segment_filename', segmentPath, m3u8Path];

        logger.log('BUFFER', 'Starting FFmpeg for channel:', channel.name);
        logger.log('BUFFER', 'URL:', channel.url);
        logger.log('BUFFER', 'Output:', m3u8Path);

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

        ffmpegProcess.on('exit', (code, signal) => {
            if (signal === 'SIGTERM' || signal === 'SIGINT') {
                logger.log('BUFFER', 'FFmpeg stopped by user');
            } else if (code === 0) {
                logger.log('BUFFER', 'FFmpeg exited normally');
            } else {
                logger.log('BUFFER', 'FFmpeg exited - code:', code, 'signal:', signal);
            }
        });

        currentChannelName = channel.name;
        bufferStartTime = Date.now();
        BufferController.updateActivity();
        BufferController.startCleanup();

        logger.log('BUFFER', 'Recording started for:', channel.name);
        return m3u8Path;
    }

    static async startBufferWithRetry(channel, maxRetries = 3) {
        let lastError = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await BufferController.startBuffer(channel);
            } catch (err) {
                lastError = err;
                logger.error('BUFFER', `startBuffer attempt ${attempt}/${maxRetries} failed:`, err.message);

                if (attempt < maxRetries) {
                    await BufferController.stopBuffer();
                    const delay = Math.pow(2, attempt - 1) * 1000;
                    logger.log('BUFFER', `Retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        throw new Error(`Failed to start buffer after ${maxRetries} attempts: ${lastError.message}`);
    }

    static async stopBuffer() {

        if (ffmpegProcess) {
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
        bufferStartTime = null;
        logger.log('BUFFER', 'Recording stopped');
    }

    static async gracefulShutdown(childProcess, timeoutMs = 2000) {
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
                    }, 500);
                }
            }, timeoutMs);
        });
    }

    static async forceRecover() {
        logger.log('BUFFER', 'Force recovery initiated');

        if (ffmpegProcess) {
            try {
                await BufferController.gracefulShutdown(ffmpegProcess, 1000);
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

        logger.log('BUFFER', 'Force recovery completed');
    }

    static async changeChannel(newChannel) {
        BufferController.updateActivity();
        logger.log('BUFFER', 'Changing channel:', currentChannelName, '->', newChannel.name);
        await BufferController.stopBuffer();
        return await BufferController.startBufferWithRetry(newChannel);
    }

    static getStatus(req, res) {
        const isRecording = ffmpegProcess !== null;
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
            isRecording,
            currentChannel: currentChannelName,
            recording: isRecording,
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
        }, 5 * 60 * 1000);

        BufferController.cleanupOldSegments();

        if (activityInterval) clearInterval(activityInterval);
        activityInterval = setInterval(BufferController.checkActivity, 30000);
    }

    static updateActivity() {
        lastActivity = Date.now();
    }

    static checkActivity() {
        if (!ffmpegProcess) return;

        const inactiveTime = Date.now() - lastActivity;
        if (inactiveTime > ACTIVITY_TIMEOUT) {
            const inactiveMinutes = Math.floor(inactiveTime / 60000);
            logger.log('BUFFER', 'No activity for ' + inactiveMinutes + ' minutes, stopping recording');
            BufferController.stopBuffer();
        }
    }

    static heartbeat(req, res) {
        BufferController.updateActivity();
        res.json({
            isRecording: ffmpegProcess !== null, currentChannel: currentChannelName
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

            const maxSegments = (bufferDurationMinutes * 60) / segmentDuration;

            if (tsFiles.length > maxSegments) {
                const toRemove = tsFiles.slice(0, tsFiles.length - Math.floor(maxSegments));

                toRemove.forEach(file => {
                    const filePath = path.join(channelPath, file);
                    try {
                        fs.unlinkSync(filePath);
                    } catch (e) {
                        logger.error('BUFFER', 'Failed to delete old segment:', file, e.message);
                    }
                });

                logger.log('BUFFER', 'Cleaned up ' + toRemove.length + ' old segments (' + tsFiles.length + ' total)');
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
