const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');

const ChannelController = require('./channel-controller');
const BufferController = require('./buffer-controller');
const { bufferDir, port } = require('./constants');

// Initialize directories
fs.mkdirSync(bufferDir, { recursive: true });

// Clean up orphaned FFmpeg processes and old buffer files from previous sessions
console.log('[SERVER] Cleaning up orphaned processes and old buffers...');
BufferController.cleanupOrphaned();
BufferController.cleanupAllBuffers();

const app = express();

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Buffer/HLS segments serving (must be before static)
app.use('/buffer', express.static(bufferDir));

// Static files (public is inside views)
app.use('/public', express.static(path.join(__dirname, '../views/public')));

// API Routes
app.get('/api/channels', ChannelController.getChannelList);
app.get('/api/categories', ChannelController.getCategories);
app.get('/api/channels/search', ChannelController.searchChannels);
app.get('/api/channel/current', ChannelController.getCurrentChannel);
app.get('/api/channel/change', ChannelController.changeChannel);
app.get('/api/buffer/status', BufferController.getStatus);
app.get('/api/buffer/heartbeat', BufferController.heartbeat);
app.post('/api/buffer/stop', BufferController.stop);

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../views/index.html'));
});

app.get('/player', (req, res) => {
    res.sendFile(path.join(__dirname, '../views/player.html'));
});

// Favicon (prevent 404)
app.get('/favicon.ico', (req, res) => {
    res.status(204).end();
});

// Shutdown handler
process.on('SIGTERM', () => {
    console.log('[SERVER] SIGTERM received, shutting down...');
    BufferController.stopBuffer();
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('[SERVER] SIGINT received, shutting down...');
    BufferController.stopBuffer();
    process.exit(0);
});

// Start server
app.listen(port, () => {
    console.log('=================================');
    console.log('[SERVER] IPTV Player Started');
    console.log('[SERVER] URL: http://localhost:' + port);
    console.log('[SERVER] Buffer: ' + bufferDir);
    console.log('=================================');
});
