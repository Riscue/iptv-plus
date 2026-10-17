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
    LOADING: 'Yükleniyor',
    WAITING: 'Bekleniyor',

    VIDEO_CODEC_NOT_SUPPORTED: 'Video formatı desteklenmiyor - Ana sayfaya dönülüyor',
    CHANNEL_FAILED_TO_LOAD: 'Kanal yüklenemedi - Ana sayfaya dönülüyor',
    CONNECTION_LOST: 'Bağlantı koptu - Ana sayfaya dönülüyor',
    CODEC_NOT_SUPPORTED_TV: 'Bu format TV\'de oynatılamıyor - Ana sayfaya dönülüyor',
    PLAYBACK_ERROR_CHANGE_CHANNEL: 'Oynatma hatası - Ana sayfaya dönülüyor',
    COULD_NOT_CHANGE_CHANNEL: 'Kanal değiştirilemedi - Ana sayfaya dönülüyor',

    SEGMENT_FAILED_TO_LOAD: 'Video parçası yüklenemedi - Düzeltiliyor',
    MANIFEST_LOAD_TIMEOUT: 'Yayın listesi yüklenemedi - Düzeltiliyor',
    PLAYBACK_ERROR_RECOVERING: 'Oynatma hatası - Düzeltiliyor',

    SOURCE_RETRYING: 'Kaynak bağlantısı koptu - Yeniden deneniyor',
    SOURCE_RECONNECTING: 'Kaynağa yeniden bağlanılıyor',
    ATTEMPT: 'deneme',
    SECONDS: 'sn',
    RECORDING_INTERRUPTED: 'Kayıt kesildi',
    RETRYING: 'yeniden deneniyor',
    RECONNECTING: 'yeniden bağlanıyor',
    RECORDING_FAILED: 'Kayıt başlatılamadı - Ana sayfaya dönülüyor',
    RECORDING_STOPPED: 'Kayıt sunucuda durduruldu - Ana sayfaya dönülüyor',
    CHANNELS_FAILED_TO_LOAD: 'Kanal listesi yüklenemedi',
    CHANNEL_START_FAILED: 'Kanal başlatılamadı',

    LIVE: 'CANLI',
    ERROR: 'Hata',
    RECORDING: 'Kaydediliyor',
    TIME: 'Saat',

    RECORDING_SOURCE_LOST: 'Kaynak bağlantısı koptu, yeniden deneniyor',
    RECORDING_STOPS_IN: 'Oynatıcıya dönmezseniz kayıt {minutes} dk sonra durur ve geri sarma geçmişi silinir',
    STOP_RECORDING: 'Kaydı durdur',
    STOP_RECORDING_CONFIRM: 'Emin misiniz? Tekrar basın',
    RECORDING_STOPPED_NOTICE: 'Kayıt durduruldu',
    STOP_RECORDING_FAILED: 'Kayıt durdurulamadı',

    REMOVED_FROM_FAVORITES: 'Favorilerden çıkarıldı',
    FAVORITE_SLOTS_FULL: 'Favori yerleri dolu!',
    ADDED_TO_FAVORITES: 'Favorilere eklendi',
    NO_CHANNELS_WATCHED: 'Henüz kanal izlenmedi',
    CHANNEL_COUNT: 'kanal',

    ALL: 'Tümü',
    SEARCH: 'Arama',
    SEARCH_RESULTS: 'Arama sonuçları',
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        Icons,
        Messages,
    };
}
