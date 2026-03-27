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
    LOADING: 'Loading',
    WAITING: 'Waiting',

    VIDEO_CODEC_NOT_SUPPORTED: 'Video codec not supported! - Returning to Home',
    CHANNEL_FAILED_TO_LOAD: 'Channel failed to load - Returning to Home',
    CONNECTION_LOST: 'Connection lost - Returning to Home',
    CODEC_NOT_SUPPORTED_TV: 'Codec not supported! TV cannot play this format - Returning to Home',
    PLAYBACK_ERROR_CHANGE_CHANNEL: 'Playback error - Returning to Home',
    COULD_NOT_CHANGE_CHANNEL: 'Could not change channel - Returning to Home',

    SEGMENT_FAILED_TO_LOAD: 'Segment failed to load - Recovering',
    MANIFEST_LOAD_TIMEOUT: 'Manifest failed to load - Recovering',
    PLAYBACK_ERROR_RECOVERING: 'Playback error - Recovering',

    LIVE: 'LIVE',
    ERROR: 'Error',
    RECORDING: 'Recording',
    TIME: 'Time',

    REMOVED_FROM_FAVORITES: 'Removed from favorites',
    FAVORITE_SLOTS_FULL: 'Favorite slots full!',
    ADDED_TO_FAVORITES: 'Added to favorites',
    NO_CHANNELS_WATCHED: 'No channels watched yet',

    SEARCH: 'Search',
    SEARCH_RESULTS: 'Search Results',
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        Icons,
        Messages,
    };
}
