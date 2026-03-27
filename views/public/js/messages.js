const Icons = {
    PLAY: '<img src="/public/images/icons/play.svg" class="svg-icon" alt="">',
    PAUSE: '<img src="/public/images/icons/pause.svg" class="svg-icon" alt="">',
    FORWARD: '<img src="/public/images/icons/forward.svg" class="svg-icon" alt="">',
    BACKWARD: '<img src="/public/images/icons/backward.svg" class="svg-icon" alt="">',
    ERROR: '<img src="/public/images/icons/close.svg" class="svg-icon" alt="">',
    LIVE: '<img src="/public/images/icons/live.svg" class="svg-icon" alt="">',
    RECORDING: '<img src="/public/images/icons/recording.svg" class="svg-icon" alt="">',
};

const Messages = {
    LOADING: 'Loading...',
    WAITING: 'Waiting...',

    VIDEO_CODEC_NOT_SUPPORTED: 'Video codec not supported!',
    CHANNEL_FAILED_TO_LOAD: 'Channel failed to load',
    SEGMENT_FAILED_TO_LOAD: 'Segment failed to load',
    MANIFEST_LOAD_TIMEOUT: 'Manifest failed to load',
    CONNECTION_LOST: 'Connection lost - Returning to home...',
    CODEC_NOT_SUPPORTED_TV: 'Codec not supported! TV cannot play this format.',
    PLAYBACK_ERROR_RECOVERING: 'Playback error - Recovering...',
    PLAYBACK_ERROR_CHANGE_CHANNEL: 'Playback error - Change channel',

    COULD_NOT_CHANGE_CHANNEL: Icons.ERROR + ' Could not change channel',

    LIVE: Icons.LIVE + ' LIVE',
    ERROR_LABEL: Icons.ERROR + ' Error',
    RECORDING: Icons.RECORDING + ' Recording',
    TIME_PREFIX: 'Time:',

    REMOVED_FROM_FAVORITES: 'Removed from favorites',
    FAVORITE_SLOTS_FULL: 'Favorite slots full!',
    ADDED_TO_FAVORITES: 'Added to favorites',
    NO_CHANNELS_WATCHED: 'No channels watched yet',

    SEARCH_PREFIX: 'Search:',
    SEARCH_RESULTS: 'Search Results',
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        Icons,
        Messages,
    };
}
