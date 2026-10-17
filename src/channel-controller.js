const fs = require('fs');
const path = require('path');
const {Readable} = require('stream');
const {pipeline} = require('stream/promises');
const M3U8FileParser = require('m3u8-file-parser');
const {playlistUrl, playlistFile, playlistCacheDuration} = require('./constants');
const BufferController = require('./buffer-controller');
const logger = require('./logger');

let channelsCache = [];
let categories = [];
let currentChannel = null;
let channelIndex = 0;
let currentCategory = null;

let playlistDownloadPromise = null;
let channelsLoadedAt = 0;

BufferController.setOnStop(() => {
    currentChannel = null;
});

class ChannelController {

    static async ensureChannels() {
        const expired = Date.now() - channelsLoadedAt >= playlistCacheDuration;
        if (channelsCache.length > 0 && !expired) return;

        await ChannelController.downloadPlaylist();
        ChannelController.loadChannels();
        channelsLoadedAt = Date.now();
    }

    static async downloadPlaylist() {
        if (playlistDownloadPromise) {
            logger.log('PLAYLIST', 'Download already in progress, waiting...');
            return playlistDownloadPromise;
        }

        if (fs.existsSync(playlistFile)) {
            const stats = fs.statSync(playlistFile);
            const age = Date.now() - stats.mtimeMs;
            const ageHours = Math.floor(age / (60 * 60 * 1000));

            if (age < playlistCacheDuration) {
                logger.log('PLAYLIST', 'Using cached playlist (' + ageHours + 'h old)');
                return;
            }
        }

        logger.log('PLAYLIST', 'Downloading from:', playlistUrl);

        playlistDownloadPromise = (async () => {
            const tmpFile = playlistFile + '.tmp';
            try {
                const response = await fetch(playlistUrl, {signal: AbortSignal.timeout(120000)});
                if (!response.ok) throw new Error('Request failed with status code ' + response.status);
                await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(tmpFile));
                fs.renameSync(tmpFile, playlistFile);
                logger.log('PLAYLIST', 'Downloaded and cached for 24h');
            } catch (err) {
                if (err.cause && err.cause.code) err.message += ' (' + err.cause.code + ')';
                fs.rmSync(tmpFile, {force: true});
                if (!fs.existsSync(playlistFile)) {
                    logger.error('PLAYLIST', 'Download failed:', err.message);
                    throw err;
                }
                logger.error('PLAYLIST', 'Download failed, using stale cache:', err.message);
            } finally {
                playlistDownloadPromise = null;
            }
        })();

        return playlistDownloadPromise;
    }

    static loadChannels() {
        if (!fs.existsSync(playlistFile)) {
            logger.log('PLAYLIST', 'No playlist file found');
            return [];
        }

        try {
            const content = fs.readFileSync(playlistFile, 'utf-8');
            const parser = new M3U8FileParser();
            parser.read(content);
            const result = parser.getResult();

            const channelMap = new Map();

            const vodExtensions = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v'];
            const vodCategoryKeywords = ['film', 'movie', 'vod', 'sinema', 'cinema'];

            (result.segments || []).forEach(s => {
                if (s.inf && s.inf.title && s.url) {
                    const urlLower = s.url.toLowerCase();
                    const isVodFile = vodExtensions.some(ext => urlLower.endsWith(ext));

                    if (isVodFile) {
                        return;
                    }

                    let groupTitle = 'Genel';
                    if (s.inf.groupTitle) {
                        groupTitle = s.inf.groupTitle;
                    } else if (s.inf.attributes && s.inf.attributes['GROUP-NAME']) {
                        groupTitle = s.inf.attributes['GROUP-NAME'];
                    } else if (s.inf.attributes && s.inf.attributes.group) {
                        groupTitle = s.inf.attributes.group;
                    }

                    const categoryLower = groupTitle.toLowerCase();
                    const isVodCategory = vodCategoryKeywords.some(keyword => categoryLower.includes(keyword));

                    if (isVodCategory) {
                        return;
                    }

                    const channel = {
                        name: s.inf.title, url: s.url, category: groupTitle
                    };

                    if (!channelMap.has(groupTitle)) {
                        channelMap.set(groupTitle, []);
                    }
                    channelMap.get(groupTitle).push(channel);
                }
            });

            const loadedChannels = [];
            channelMap.forEach((chans, cat) => {
                if (chans.length > 0) {
                    loadedChannels.push(...chans);
                }
            });

            if (loadedChannels.length === 0) {
                logger.error('PLAYLIST', 'Playlist has no channels, discarding cached file');
                fs.rmSync(playlistFile, {force: true});
                return channelsCache;
            }

            channelsCache = loadedChannels;
            categories = Array.from(channelMap.keys())
                .filter(cat => channelMap.get(cat).length > 0);

            if (currentChannel) {
                const idx = channelsCache.findIndex(ch => ch.name === currentChannel.name);
                if (idx !== -1) channelIndex = idx;
            }

            logger.log('PLAYLIST', 'Loaded ' + channelsCache.length + ' channels in ' + categories.length + ' categories');

            return channelsCache;
        } catch (err) {
            logger.error('PLAYLIST', 'Parse error, discarding cached file:', err.message);
            fs.rmSync(playlistFile, {force: true});
            return channelsCache;
        }
    }

    static getChannelsByCategory(category) {
        return channelsCache.filter(ch => ch.category === category);
    }

    static async getChannelList(req, res) {
        try {
            await ChannelController.ensureChannels();

            const channels = channelsCache;

            logger.log('PLAYLIST', 'Serving: ' + channels.length + ' channels, ' + categories.length + ' categories');

            res.json({
                channels: channels,
                categories: categories,
                current: currentChannel,
                index: channelIndex,
                currentCategory: currentCategory
            });
        } catch (err) {
            logger.error('PLAYLIST', 'Error serving list:', err.message);
            res.status(500).json({error: err.message});
        }
    }

    static async getCategories(req, res) {
        try {
            await ChannelController.ensureChannels();

            const categoryMap = new Map();
            channelsCache.forEach(ch => {
                if (!categoryMap.has(ch.category)) {
                    categoryMap.set(ch.category, 0);
                }
                categoryMap.set(ch.category, categoryMap.get(ch.category) + 1);
            });

            const categoryList = Array.from(categoryMap.entries()).map(([name, count]) => ({
                name: name, count: count
            }));

            res.json({categories: categoryList});
        } catch (err) {
            logger.error('PLAYLIST', 'Error serving categories:', err.message);
            res.status(500).json({error: err.message});
        }
    }

    static async searchChannels(req, res) {
        try {
            const query = req.query.q?.trim().toLowerCase();
            if (!query || query.length < 2) {
                return res.json({channels: []});
            }

            await ChannelController.ensureChannels();

            const results = channelsCache
                .filter(ch => ch.name.toLowerCase().includes(query))
                .slice(0, 20);

            logger.log('PLAYLIST', 'Search "' + query + '" found: ' + results.length + ' results');
            res.json({channels: results});
        } catch (err) {
            logger.error('PLAYLIST', 'Search error:', err.message);
            res.status(500).json({error: err.message});
        }
    }

    static getCurrentChannel(req, res) {
        res.json({
            current: currentChannel, index: channelIndex, currentCategory: currentCategory
        });
    }

    static async changeChannel(req, res) {
        try {
            const {index, name, url, category} = req.query;
            let targetChannel;

            await ChannelController.ensureChannels();

            if (index !== undefined) {
                const idx = parseInt(index);

                if (idx >= 0 && idx < channelsCache.length) {
                    targetChannel = channelsCache[idx];
                    channelIndex = idx;
                    logger.log('CHANNEL', 'Changing to channel by index:', idx, '-', targetChannel.name);
                }
            } else if (name || url) {
                targetChannel = channelsCache.find(ch => name ? ch.name === name : ch.url === url);

                if (targetChannel) {
                    channelIndex = channelsCache.indexOf(targetChannel);
                    logger.log('CHANNEL', 'Changing to channel by name:', targetChannel.name);
                }
            } else if (category) {
                const catChannels = ChannelController.getChannelsByCategory(category);
                if (catChannels.length > 0) {
                    targetChannel = catChannels[0];
                    channelIndex = channelsCache.indexOf(targetChannel);
                    logger.log('CHANNEL', 'Changing to category:', category, '- first channel:', targetChannel.name);
                }
            }

            if (!targetChannel) {
                logger.log('CHANNEL', 'Channel not found');
                return res.status(404).json({error: 'Channel not found'});
            }

            currentCategory = targetChannel.category;

            await BufferController.changeChannel(targetChannel);
            currentChannel = targetChannel;

            logger.log('CHANNEL', 'Changed to: ' + currentChannel.name + ' (' + currentChannel.category + ')');

            res.json({
                current: currentChannel,
                index: channelIndex,
                category: currentCategory,
                bufferUrl: '/buffer/' + BufferController.getSafeName(currentChannel.name) + '/live.m3u8'
            });

        } catch (err) {
            logger.error('CHANNEL', 'Change error:', err.message);
            res.status(500).json({error: err.message});
        }
    }


    static setCurrentChannel(channel) {
        currentChannel = channel;
        if (channel) {
            channelIndex = channelsCache.findIndex(ch => ch.name === channel.name);
            currentCategory = channel.category;
        }
    }
}

module.exports = ChannelController;
