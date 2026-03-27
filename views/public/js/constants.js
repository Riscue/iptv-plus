const PCKeyCodes = {
    ARROW_UP: 'ArrowUp',
    ARROW_DOWN: 'ArrowDown',
    ARROW_LEFT: 'ArrowLeft',
    ARROW_RIGHT: 'ArrowRight',
    ENTER: 'Enter',
    OK: 'OK',
    ESCAPE: 'Escape',
    SPACE: ' ',
    F_KEY: 'f',
    F_KEY_UPPER: 'F',
    D_KEY: 'd',
    D_KEY_UPPER: 'D',
};

const TVKeyCodes = {
    BACK: 461,

    CHANNEL_UP: 'ChannelUp',
    CHANNEL_DOWN: 'ChannelDown',
    CHANNEL_UP_KEY: 427,
    CHANNEL_DOWN_KEY: 428,
    PAGE_UP: 33,
    PAGE_DOWN: 34,

    RED: 403,
    GREEN: 404,
    YELLOW: 405,
    BLUE: 406,

    MEDIA_PLAY_PAUSE: 179,
    MEDIA_PLAY: 415,
    MEDIA_PAUSE: 19,
    MEDIA_STOP: 126,
    MEDIA_PLAY_ALT: 127,
    RECORD: 71,
    RECORD_ALT: 74,
    MEDIA_PLAY_PAUSE_ALT: 10252,

    DIGIT_0: 48,
    DIGIT_1: 49,
    DIGIT_2: 50,
    DIGIT_3: 51,
    DIGIT_4: 52,
    DIGIT_5: 53,
    DIGIT_6: 54,
    DIGIT_7: 55,
    DIGIT_8: 56,
    DIGIT_9: 57,
};

const TimeConstants = {
    SECOND: 1000,
    IDLE_TIMEOUT: 3000,
    HEARTBEAT_INTERVAL: 30000,
    OVERLAY_AUTO_HIDE: 1000,
    DEBUG_SEQUENCE_TIMEOUT: 2000,
    BUFFER_CHECK_INTERVAL: 3000,
    BUFFER_MAX_WAIT: 30000,
    SEEK_AMOUNT: 10,
    LIVE_POSITION: 10,
};

const HLSConfig = {
    MAX_BUFFER_LENGTH: 300,
    MAX_MAX_BUFFER_LENGTH: 1200,
    MAX_LOADING_DELAY: 10,
    MAX_RETRY: 5,
};

const UIConstants = {
    MAX_FAVORITES: 9,
    MAX_WATCH_HISTORY: 9,
    SEARCH_DEBOUNCE: 300,
};

const StorageKeys = {
    FAVORITES: 'iptv-favorites',
    WATCH_HISTORY: 'iptv-watch-history',
};

const HLSErrorDetails = {
    FRAG_LOAD_ERROR: 'fragLoadError',
    FRAG_LOAD_TIMEOUT: 'fragLoadTimeOut',
    MANIFEST_LOAD_TIMEOUT: 'manifestLoadTimeOut',
    MANIFEST_INCOMPATIBLE_CODECS_ERROR: 'manifestIncompatibleCodecsError',
    BUFFER_CODEC_ERROR: 'bufferCodecError',
    BUFFER_DECODING_ERROR: 'bufferDecodingError',
};

const IndicatorTypes = {
    LOADING: 'loading',
    ERROR: 'error',
    ERROR_PERMANENT: 'error-permanent',
    PLAN: 'plan',
    SEEK: 'seek',
    LIVE: 'live',
    PLAY: 'play',
};

const IndicatorPriority = {
    [IndicatorTypes.LOADING]: 1,
    [IndicatorTypes.ERROR]: 5,
    [IndicatorTypes.ERROR_PERMANENT]: 10,
    [IndicatorTypes.PLAN]: 3,
    [IndicatorTypes.SEEK]: 4,
    [IndicatorTypes.LIVE]: 4,
    [IndicatorTypes.PLAY]: 4,
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        PCKeyCodes,
        TVKeyCodes,
        TimeConstants,
        HLSConfig,
        UIConstants,
        StorageKeys,
        HLSErrorDetails,
        IndicatorTypes,
        IndicatorPriority,
    };
}
