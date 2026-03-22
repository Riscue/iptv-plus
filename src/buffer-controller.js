const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { bufferDir, bufferDurationMinutes, segmentDuration } = require('./constants');
const logger = require('./logger');

let ffmpegProcess = null;
let currentChannelName = null;
let cleanupInterval = null;
let activityInterval = null;
let lastActivity = Date.now();
let bufferStartTime = null;
const ACTIVITY_TIMEOUT = 300000; // 5 minutes without activity = stop recording

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

        // Create channel directory
        fs.mkdirSync(channelPath, { recursive: true });

        const m3u8Path = path.join(channelPath, 'live.m3u8');
        const segmentPath = path.join(channelPath, '%08d.ts');

        // FFmpeg command for continuous HLS recording
        const ffmpegArgs = [
            '-user_agent', 'Mozilla/5.0',
            '-i', channel.url,
            '-c', 'copy',
            '-f', 'hls',
            '-hls_time', '5',
            '-hls_list_size', '0',
            '-hls_flags', 'delete_segments+append_list+independent_segments',
            '-hls_segment_filename', segmentPath,
            m3u8Path
        ];

        logger.log('BUFFER', 'Starting FFmpeg for channel:', channel.name);
        logger.log('BUFFER', 'URL:', channel.url);
        logger.log('BUFFER', 'Output:', m3u8Path);

        ffmpegProcess = spawn('ffmpeg', ffmpegArgs);

        ffmpegProcess.on('error', (err) => {
            logger.error('BUFFER', 'FFmpeg spawn error:', err.message);
        });

        // Log FFmpeg errors only
        ffmpegProcess.stderr.on('data', (data) => {
            const msg = data.toString();
            // Only log error lines
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
        BufferController.updateActivity(); // Kapanma hatasını önlemek için activity timer resetlendi

        // Start cleanup interval
        BufferController.startCleanup();

        logger.log('BUFFER', 'Recording started for:', channel.name);
        return m3u8Path;
    }

    static async stopBuffer() {
        if (ffmpegProcess) {
            logger.log('BUFFER', 'Stopping recording:', currentChannelName);

            // Wait for FFmpeg to exit before cleanup
            await new Promise((resolve) => {
                let resolved = false;

                const exitHandler = () => {
                    if (!resolved) {
                        resolved = true;
                        ffmpegProcess = null;
                        resolve();
                    }
                };

                ffmpegProcess.once('exit', exitHandler);
                ffmpegProcess.kill('SIGTERM');

                // Force kill after 2 seconds if still running
                setTimeout(() => {
                    if (!resolved && ffmpegProcess) {
                        logger.log('BUFFER', 'Force killing FFmpeg after timeout');
                        ffmpegProcess.kill('SIGKILL');
                        // Give it 500ms then resolve anyway
                        setTimeout(() => {
                            if (!resolved) {
                                resolved = true;
                                ffmpegProcess = null;
                                resolve();
                            }
                        }, 500);
                    }
                }, 2000);
            });
        }

        if (cleanupInterval) {
            clearInterval(cleanupInterval);
            cleanupInterval = null;
        }
        if (activityInterval) {
            clearInterval(activityInterval);
            activityInterval = null;
        }

        // Clean up buffer directory AFTER FFmpeg exits
        if (currentChannelName) {
            const channelPath = BufferController.getChannelBufferPath(currentChannelName);
            logger.log('BUFFER', 'Cleaning up buffer directory:', channelPath);
            BufferController.cleanupChannel(channelPath);
        }

        currentChannelName = null;
        bufferStartTime = null;
        logger.log('BUFFER', 'Recording stopped');
    }

    // Force recovery - kill any stuck FFmpeg processes
    static async forceRecover() {
        logger.log('BUFFER', 'Force recovery initiated');

        if (ffmpegProcess) {
            try {
                ffmpegProcess.kill('SIGKILL');
            } catch (e) {}
            ffmpegProcess = null;
        }

        // Kill any orphaned ffmpeg processes for our buffer
        const { spawn } = require('child_process');
        return new Promise((resolve) => {
            const safePattern = `ffmpeg.*${bufferDir.replace(/[^a-zA-Z0-9/_-]/g, '')}`;
            spawn('pkill', ['-9', '-f', safePattern]).on('close', () => {
                logger.log('BUFFER', 'Force recovery completed');
                resolve();
            });
        });
    }

    static async changeChannel(newChannel) {
        BufferController.updateActivity(); // Kanal değiştirme isteği geldiğinde aktiviteyi güncelle
        logger.log('BUFFER', 'Changing channel:', currentChannelName, '->', newChannel.name);

        // Force recovery before stopping (clear any stuck processes)
        await BufferController.forceRecover();

        // Stop current buffer
        await BufferController.stopBuffer();

        // Start new buffer
        return await BufferController.startBuffer(newChannel);
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
                } catch (e) {}
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
        // Run cleanup every 5 minutes
        if (cleanupInterval) clearInterval(cleanupInterval);
        cleanupInterval = setInterval(() => {
            BufferController.cleanupOldSegments();
        }, 5 * 60 * 1000);

        // Also run once immediately
        BufferController.cleanupOldSegments();

        // Start activity checker
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
            isRecording: ffmpegProcess !== null,
            currentChannel: currentChannelName
        });
    }

    static async stop(req, res) {
        logger.log('BUFFER', 'Stop requested via API');
        await BufferController.stopBuffer();
        res.json({ success: true });
    }

    static cleanupAllBuffers() {
        try {
            if (fs.existsSync(bufferDir)) {
                const channels = fs.readdirSync(bufferDir);
                if (channels.length > 0) {
                    channels.forEach(channel => {
                        const channelPath = path.join(bufferDir, channel);
                        if (fs.statSync(channelPath).isDirectory()) {
                            fs.rmSync(channelPath, { recursive: true, force: true });
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
                    } catch (e) {}
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
                fs.rmSync(channelPath, { recursive: true, force: true });
            }
        } catch (err) {
            logger.error('BUFFER', 'Channel cleanup error:', err.message);
        }
    }

    static cleanupOrphaned() {
        spawn('pkill', ['-9', 'ffmpeg']).on('exit', (code) => {
            if (code === 0) {
                logger.log('BUFFER', 'Killed orphaned FFmpeg processes');
            }
        }).on('error', () => {
            // No ffmpeg running, silently ignore
        });
    }
}

module.exports = BufferController;
