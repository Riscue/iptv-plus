const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');

const ChannelController = require('./channel-controller');
const BufferController = require('./buffer-controller');
const {bufferDir} = require('./constants');
const logger = require('./logger');

fs.mkdirSync(bufferDir, {recursive: true});

logger.log('SERVER', 'Cleaning up orphaned processes and old buffers...');
BufferController.cleanupOrphaned();
BufferController.cleanupAllBuffers();

const app = express();

app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());

app.use('/buffer', express.static(bufferDir));

app.use('/public', express.static(path.join(__dirname, '../views/public')));

app.get('/api/channels', ChannelController.getChannelList);
app.get('/api/categories', ChannelController.getCategories);
app.get('/api/channels/search', ChannelController.searchChannels);
app.get('/api/channel/current', ChannelController.getCurrentChannel);
app.get('/api/channel/change', ChannelController.changeChannel);
app.get('/api/buffer/status', BufferController.getStatus);
app.get('/api/buffer/heartbeat', BufferController.heartbeat);
app.post('/api/buffer/stop', BufferController.stop);

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

app.listen(3000, () => {
    logger.log('SERVER', 'IPTV Plus Started');
    logger.log('SERVER', 'URL: http://localhost:3000');
    logger.log('SERVER', 'Buffer: ' + bufferDir);
});
