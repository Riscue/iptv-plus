const express = require('express');
const path = require('path');
const fs = require('fs');

const ChannelController = require('./channel-controller');
const BufferController = require('./buffer-controller');
const {bufferDir} = require('./constants');
const logger = require('./logger');

fs.mkdirSync(bufferDir, {recursive: true});

const app = express();

function asyncHandler(fn) {
    return function (req, res, next) {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

app.use('/buffer', express.static(bufferDir));

app.use('/public', express.static(path.join(__dirname, '../views/public')));
app.use('/public/vendor/hls', express.static(path.dirname(require.resolve('hls.js/dist/hls.min.js'))));

app.get('/api/channels', asyncHandler(ChannelController.getChannelList));
app.get('/api/categories', asyncHandler(ChannelController.getCategories));
app.get('/api/channels/search', asyncHandler(ChannelController.searchChannels));
app.get('/api/channel/current', asyncHandler(ChannelController.getCurrentChannel));
app.get('/api/channel/change', asyncHandler(ChannelController.changeChannel));
app.get('/api/buffer/status', asyncHandler(BufferController.getStatus));
app.get('/api/buffer/state', asyncHandler(BufferController.state));
app.get('/api/buffer/heartbeat', asyncHandler(BufferController.heartbeat));
app.get('/api/buffer/set-timeout', asyncHandler(BufferController.setTimeout));
app.post('/api/buffer/stop', asyncHandler(BufferController.stop));

app.get('/api/build-info', (req, res) => {
    try {
        const buildInfoPath = path.join(__dirname, 'build-info.json');
        const buildInfo = JSON.parse(fs.readFileSync(buildInfoPath, 'utf-8'));
        res.json(buildInfo);
    } catch (err) {
        res.json({
            commit: 'unknown', branch: 'unknown', commitDate: null, buildDate: new Date().toISOString()
        });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../views/index.html'));
});

app.get('/player', (req, res) => {
    res.sendFile(path.join(__dirname, '../views/player.html'));
});

app.get('/favicon.ico', (req, res) => {
    res.status(204).end();
});

app.use((err, req, res, next) => {
    logger.error('SERVER', 'Unhandled error:', err.message);
    res.status(500).json({error: err.message});
});

process.on('SIGTERM', async () => {
    logger.log('SERVER', 'SIGTERM received, shutting down...');
    await BufferController.cleanupAll();
    process.exit(0);
});

process.on('SIGINT', async () => {
    logger.log('SERVER', 'SIGINT received, shutting down...');
    await BufferController.cleanupAll();
    process.exit(0);
});

(async () => {
    logger.log('SERVER', 'Cleaning up orphaned processes and old buffers...');
    try {
        await BufferController.cleanupOrphanedProcesses();
    } catch (err) {
        logger.error('SERVER', 'Orphaned process cleanup failed:', err.message);
    }
    BufferController.cleanupAllBuffers();

    app.listen(3000, () => {
        logger.log('SERVER', 'IPTV Plus Started');
        logger.log('SERVER', 'URL: http://localhost:3000');
        logger.log('SERVER', 'Buffer: ' + bufferDir);
    });
})();
