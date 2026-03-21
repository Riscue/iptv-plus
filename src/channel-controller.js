const fs = require('fs');
const path = require('path');
const axios = require('axios');
const M3U8FileParser = require('m3u8-file-parser');
const { playlistUrl, playlistFile } = require('./constants');
const BufferController = require('./buffer-controller');

// Cache for channels
let channelsCache = [];
let categories = [];
let currentChannel = null;
let channelIndex = 0;
let currentCategory = null;

class ChannelController {

    static async downloadPlaylist() {
        if (fs.existsSync(playlistFile)) {
            const stats = fs.statSync(playlistFile);
            const age = Date.now() - stats.mtimeMs;
            const ageHours = Math.floor(age / (60 * 60 * 1000));

            // Cache for 24 hours
            if (age < 24 * 60 * 60 * 1000) {
                console.log('[PLAYLIST] Using cached playlist (' + ageHours + 'h old)');
                return;
            }
        }

        console.log('[PLAYLIST] Downloading from:', playlistUrl);

        try {
            const writer = fs.createWriteStream(playlistFile);
            const response = await axios({
                url: playlistUrl,
                method: 'GET',
                responseType: 'stream'
            });
            response.data.pipe(writer);

            return new Promise((resolve, reject) => {
                writer.on('finish', () => {
                    console.log('[PLAYLIST] Downloaded and cached for 24h');
                    resolve();
                });
                writer.on('error', (err) => {
                    console.error('[PLAYLIST] Download error:', err.message);
                    reject(err);
                });
            });
        } catch (err) {
            console.error('[PLAYLIST] Download failed:', err.message);
            throw err;
        }
    }

    static loadChannels() {
        if (!fs.existsSync(playlistFile)) {
            console.log('[PLAYLIST] No playlist file found');
            return [];
        }

        try {
            const content = fs.readFileSync(playlistFile, 'utf-8');
            const parser = new M3U8FileParser();
            parser.read(content);
            const result = parser.getResult();

            // Parse channels with categories
            const channelMap = new Map(); // category -> channels

            (result.segments || []).forEach(s => {
                if (s.inf && s.inf.title && s.url) {
                    // Try to get group title from various locations
                    let groupTitle = 'Genel';
                    if (s.inf.groupTitle) {
                        groupTitle = s.inf.groupTitle;
                    } else if (s.inf.attributes && s.inf.attributes['GROUP-NAME']) {
                        groupTitle = s.inf.attributes['GROUP-NAME'];
                    } else if (s.inf.attributes && s.inf.attributes.group) {
                        groupTitle = s.inf.attributes.group;
                    }

                    const channel = {
                        name: s.inf.title,
                        url: s.url,
                        category: groupTitle
                    };

                    if (!channelMap.has(groupTitle)) {
                        channelMap.set(groupTitle, []);
                    }
                    channelMap.get(groupTitle).push(channel);
                }
            });

            // Convert to arrays and sort
            categories = Array.from(channelMap.keys()).sort();
            channelsCache = [];

            channelMap.forEach((chans, cat) => {
                channelsCache.push(...chans);
            });

            console.log('[PLAYLIST] Loaded ' + channelsCache.length + ' channels in ' + categories.length + ' categories');

            return channelsCache;
        } catch (err) {
            console.error('[PLAYLIST] Parse error:', err.message);
            return [];
        }
    }

    static getChannelsByCategory(category) {
        return channelsCache.filter(ch => ch.category === category);
    }

    static async getChannelList(req, res) {
        try {
            await ChannelController.downloadPlaylist();
            const channels = ChannelController.loadChannels();

            console.log('[PLAYLIST] Serving: ' + channels.length + ' channels, ' + categories.length + ' categories');

            res.json({
                channels: channels,
                categories: categories,
                current: currentChannel,
                index: channelIndex,
                currentCategory: currentCategory
            });
        } catch (err) {
            console.error('[PLAYLIST] Error serving list:', err.message);
            res.status(500).json({ error: err.message });
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
                name: name,
                count: count
            }));

            res.json({ categories: categoryList });
        } catch (err) {
            console.error('[PLAYLIST] Error serving categories:', err.message);
            res.status(500).json({ error: err.message });
        }
    }

    static async searchChannels(req, res) {
        try {
            const query = req.query.q?.trim().toLowerCase();
            if (!query || query.length < 2) {
                return res.json({ channels: [] });
            }

            if (channelsCache.length === 0) {
                await ChannelController.downloadPlaylist();
                ChannelController.loadChannels();
            }

            const results = channelsCache
                .filter(ch => ch.name.toLowerCase().includes(query))
                .slice(0, 20);

            console.log('[PLAYLIST] Search "' + query + '" found: ' + results.length + ' results');
            res.json({ channels: results });
        } catch (err) {
            console.error('[PLAYLIST] Search error:', err.message);
            res.status(500).json({ error: err.message });
        }
    }

    static getCurrentChannel(req, res) {
        res.json({
            current: currentChannel,
            index: channelIndex,
            currentCategory: currentCategory
        });
    }

    static async changeChannel(req, res) {
        try {
            const { index, name, url, category } = req.query;
            let targetChannel;

            // Change by index (global)
            if (index !== undefined) {
                const idx = parseInt(index);

                // Load channels if cache is empty
                if (channelsCache.length === 0) {
                    await ChannelController.downloadPlaylist();
                    ChannelController.loadChannels();
                }

                if (idx >= 0 && idx < channelsCache.length) {
                    targetChannel = channelsCache[idx];
                    channelIndex = idx;
                    console.log('[CHANNEL] Changing to channel by index:', idx, '-', targetChannel.name);
                }
            }
            // Change by name/url
            else if (name || url) {
                if (channelsCache.length === 0) {
                    await ChannelController.downloadPlaylist();
                    ChannelController.loadChannels();
                }

                targetChannel = channelsCache.find(ch =>
                    name ? ch.name === name : ch.url === url
                );

                if (targetChannel) {
                    channelIndex = channelsCache.indexOf(targetChannel);
                    console.log('[CHANNEL] Changing to channel by name:', targetChannel.name);
                }
            }
            // Change by category (first channel in category)
            else if (category) {
                if (channelsCache.length === 0) {
                    await ChannelController.downloadPlaylist();
                    ChannelController.loadChannels();
                }

                const catChannels = ChannelController.getChannelsByCategory(category);
                if (catChannels.length > 0) {
                    targetChannel = catChannels[0];
                    channelIndex = channelsCache.indexOf(targetChannel);
                    console.log('[CHANNEL] Changing to category:', category, '- first channel:', targetChannel.name);
                }
            }

            if (!targetChannel) {
                console.log('[CHANNEL] Channel not found');
                return res.status(404).json({ error: 'Channel not found' });
            }

            // Set current category
            currentCategory = targetChannel.category;

            // Stop current buffer and start new one
            await BufferController.changeChannel(targetChannel);
            currentChannel = targetChannel;

            console.log('[CHANNEL] Changed to: ' + currentChannel.name + ' (' + currentChannel.category + ')');

            res.json({
                current: currentChannel,
                index: channelIndex,
                category: currentCategory,
                bufferUrl: '/buffer/' + BufferController.getSafeName(currentChannel.name) + '/live.m3u8'
            });

        } catch (err) {
            console.error('[CHANNEL] Change error:', err.message);
            res.status(500).json({ error: err.message });
        }
    }

    static channelUp() {
        if (channelsCache.length === 0) return null;

        // Get channels in current category
        var catChannels = currentCategory
            ? ChannelController.getChannelsByCategory(currentCategory)
            : channelsCache;

        if (catChannels.length === 0) catChannels = channelsCache;

        var currentIndex = catChannels.findIndex(ch => ch.name === currentChannel?.name);
        if (currentIndex === -1) currentIndex = 0;

        var nextIndex = (currentIndex + 1) % catChannels.length;
        var nextChannel = catChannels[nextIndex];

        channelIndex = channelsCache.indexOf(nextChannel);
        return nextChannel;
    }

    static channelDown() {
        if (channelsCache.length === 0) return null;

        // Get channels in current category
        var catChannels = currentCategory
            ? ChannelController.getChannelsByCategory(currentCategory)
            : channelsCache;

        if (catChannels.length === 0) catChannels = channelsCache;

        var currentIndex = catChannels.findIndex(ch => ch.name === currentChannel?.name);
        if (currentIndex === -1) currentIndex = 0;

        var prevIndex = (currentIndex - 1 + catChannels.length) % catChannels.length;
        var prevChannel = catChannels[prevIndex];

        channelIndex = channelsCache.indexOf(prevChannel);
        return prevChannel;
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
