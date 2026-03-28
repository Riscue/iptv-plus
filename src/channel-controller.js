const fs = require('fs');
const path = require('path');
const axios = require('axios');
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

BufferController.setOnStop(() => {
    currentChannel = null;
});

class ChannelController {

    static async downloadPlaylist() {
        if (fs.existsSync(playlistFile)) {
            const stats = fs.statSync(playlistFile);
            const age = Date.now() - stats.mtimeMs;
            const ageHours = Math.floor(age / (60 * 60 * 1000));

            if (age < playlistCacheDuration) {
                logger.log('PLAYLIST', 'Using cached playlist (' + ageHours + 'h old)');
                return;
            }
        }

        if (playlistDownloadPromise) {
            logger.log('PLAYLIST', 'Download already in progress, waiting...');
            return playlistDownloadPromise;
        }

        logger.log('PLAYLIST', 'Downloading from:', playlistUrl);

        playlistDownloadPromise = (async () => {
            try {
                const writer = fs.createWriteStream(playlistFile);
                const response = await axios({
                    url: playlistUrl, method: 'GET', responseType: 'stream'
                });
                response.data.pipe(writer);

                await new Promise((resolve, reject) => {
                    writer.on('finish', () => {
                        logger.log('PLAYLIST', 'Downloaded and cached for 24h');
                        resolve();
                    });
                    writer.on('error', (err) => {
                        logger.error('PLAYLIST', 'Download error:', err.message);
                        reject(err);
                    });
                });
            } catch (err) {
                logger.error('PLAYLIST', 'Download failed:', err.message);
                playlistDownloadPromise = null;
                throw err;
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

            channelsCache = [];
            channelMap.forEach((chans, cat) => {
                if (chans.length > 0) {
                    channelsCache.push(...chans);
                }
            });

            categories = Array.from(channelMap.keys())
                .filter(cat => channelMap.get(cat).length > 0);

            logger.log('PLAYLIST', 'Loaded ' + channelsCache.length + ' channels in ' + categories.length + ' categories');

            return channelsCache;
        } catch (err) {
            logger.error('PLAYLIST', 'Parse error:', err.message);
            return [];
        }
    }

    static getChannelsByCategory(category) {
        return channelsCache.filter(ch => ch.category === category);
    }

    static async getChannelList(req, res) {
        try {
            if (channelsCache.length === 0) {
                await ChannelController.downloadPlaylist();
                ChannelController.loadChannels();
            }

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
            if (channelsCache.length === 0) {
                await ChannelController.downloadPlaylist();
                ChannelController.loadChannels();
            }

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

            if (channelsCache.length === 0) {
                await ChannelController.downloadPlaylist();
                ChannelController.loadChannels();
            }

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

            if (index !== undefined) {
                const idx = parseInt(index);

                if (channelsCache.length === 0) {
                    await ChannelController.downloadPlaylist();
                    ChannelController.loadChannels();
                }

                if (idx >= 0 && idx < channelsCache.length) {
                    targetChannel = channelsCache[idx];
                    channelIndex = idx;
                    logger.log('CHANNEL', 'Changing to channel by index:', idx, '-', targetChannel.name);
                }
            } else if (name || url) {
                if (channelsCache.length === 0) {
                    await ChannelController.downloadPlaylist();
                    ChannelController.loadChannels();
                }

                targetChannel = channelsCache.find(ch => name ? ch.name === name : ch.url === url);

                if (targetChannel) {
                    channelIndex = channelsCache.indexOf(targetChannel);
                    logger.log('CHANNEL', 'Changing to channel by name:', targetChannel.name);
                }
            } else if (category) {
                if (channelsCache.length === 0) {
                    await ChannelController.downloadPlaylist();
                    ChannelController.loadChannels();
                }

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

            if (currentChannel && currentChannel.name === targetChannel.name && BufferController.isRecording()) {
                logger.log('CHANNEL', 'Same channel requested, resetting activity timer');
                BufferController.updateActivity();
                return res.json({
                    current: currentChannel,
                    index: channelIndex,
                    category: currentCategory,
                    bufferUrl: '/buffer/' + BufferController.getSafeName(currentChannel.name) + '/live.m3u8'
                });
            }

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
