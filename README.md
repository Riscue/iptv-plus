# IPTV Plus

Gelişmiş bellek yönetimi (memory leak safe), kesintisiz DVR özelliği ve Akıllı TV (Smart TV) uyumluluğu ile donatılmış,
TV kumandası veya klavye destekli modern IPTV oynatıcı.

Kanalları canlı izlerken istediğiniz an yayını dondurabilir, geriye sarabilir ve tekrar canlı yayına dönebilirsiniz.

## 🚀 Öne Çıkan Özellikler

- 📺 **Donanımsal ve Yazılımsal HLS Desteği** - Cihazın codec yeteneklerine göre Native veya HLS.js ile M3U8 oynatımı.
- ⏪ **180 Dakika Kesintisiz DVR** - İzlediğiniz kanal anlık olarak diske indirilir (FFMPEG ile). 3 saate kadar geriye
  sarabilirsiniz.
- 🎮 **Akıllı TV D-Pad Navigasyonu** - Gelişmiş matris koordinat sistemi ile klavye veya TV kumandası ok tuşlarıyla tüm
  ekranda pürüzsüz gezinti.
- 🛡️ **VOD (Sinema/Dizi) Filtreleme** - Sadece Canlı TV kanallarını alır, .mp4/.mkv gibi VOD uzantılarını ve
  kategorilerini otomatik filtreler.
- 🔒 **Eşzamanlılık Koruması (Locking)** - Aynı anda bağlanan çoklu kullanıcılarda playlist doyasının çakışmasını önleyen
  indirme kilidi (Download Promise Lock) mimarisi.
- ⚡ **Otomatik Hayat Belirtisi (Heartbeat) & Tasarruf** - Kullanıcı uygulamadan çıktığında 5 dakika içinde sunucu FFMPEG
  sürecini keserek bant genişliği ve donanım tasarrufu sağlar.
- 🌟 **Favori Kanallar** - 1-9 numaralı tuşlar ile atama yapma, uzun basma (long-press) ile hızlı favori yönetimi.
- 📊 **Akıllı İzleme Geçmişi** - En çok izlenen veya o an yayını devam eden (DVR statüsündeki) kanalları en üste taşır.

## 📺 TV Kumandası ve Klavye Kısayolları

| Tuş / Kumanda    | İşlev                                           |
|------------------|-------------------------------------------------|
| **1-9**          | Favori kanallara hızlı geçiş (Ana Sayfada)      |
| **OK / Enter**   | Oynat / Duraklat / Seç                          |
| **↑ ↓ ← →**      | Menülerde gezinme / Oynatıcıda 10 sn ileri/geri |
| **Kırmızı Tuş**  | Geri sarılmış yayından 'CANLI' konuma zıplama   |
| **Sarı Tuş**     | Tam Ekran (Fullscreen)                          |
| **Mavi Tuş**     | Player içindeyken yanda Kanal Listesini açma    |
| **Exit / Back**  | Kanal listesini kapat / Kategoriye dön          |
| **Harf Tuşları** | Arama kutusuna otomatik odaklanma               |

## 🛠️ Teknik Altyapı ve Mimarisi

- **Backend:** `Node.js` + `Express`
- **Görüntü İşleme:** `FFmpeg` (Buffer klasörüne anlık `.ts` parçalama)
- **Frontend:** Vanilla JS, CSS3 Glassmorphism (TV Ekranlarına özel devasa font yapıları ve overlay öncelik sistemi)
- **Güvenlik:** FFMPEG başlatma/sonlandırma işlemlerinde RegEx korumalı PID denetimleri, zombi process temizleyici.

## ⚙️ Kurulum

### Yerel Ortamda Çalıştırma (Native)

```bash
# Bağımlılıkları yükle
npm install

# .env dosyası oluştur
echo "PLAYLIST_URL=https://playlist-url.m3u8" > .env

# Sunucuyu başlat (FFmpeg bilgisayarınızda kurulu olmalıdır)
npm start
```

Tarayıcıda açın: `http://localhost:3000`

### Docker ile Çalıştırma (Önerilen)

Docker imajı arka planda otomatik olarak FFmpeg kurduğu için işletim sistemi bağımsız sorunsuz çalışır.

```bash
# .env dosyası oluştur
cat > .env << EOF
PLAYLIST_URL=https://your-playlist-url.m3u8
TZ=Europe/Istanbul
EOF

# Build et ve çalıştır
docker build -t iptv-plus .
docker run -d \
  -p 3000:3000 \
  --env-file .env \
  -v $(pwd)/tmp:/tmp/iptv-buffer \
  --name iptv-plus \
  iptv-plus
```

## 🎛️ Ortam Değişkenleri (Environment Variables)

| Değişken       | Zorunlu mu? | Varsayılan       | Açıklama                                    |
|----------------|-------------|------------------|---------------------------------------------|
| `PLAYLIST_URL` | Evet        | -                | IP TV Sağlayıcınızın M3U8 linki             |
| `BUFFER_DIR`   | Hayır       | /tmp/iptv-buffer | FFMPEG'in stream dosyalarını yazacağı dizin |
| `TZ`           | Hayır       | Europe/Istanbul  | Uygulama içi Saat / Zaman Dilimi            |

## 📝 Kullanım Senaryoları

1. **İzleme:** Ana sayfadan kategori seçip herhangi bir kanalı başlatın.
2. **Favoriye Alma:** Herhangi bir kanal kutusuna fareyle (veya kumandanın OK tuşuyla) 1 saniye basılı tutun.
3. **DVR Kullanımı:** Oynatıcıdayken Kumandanın sağ/sol oklarıyla veya ekrandaki butonlarla zamanda geriye gidip
   reklamsız bölümleri atlayın.
4. **Tasarruf:** Sekmeyi kapattığınız an arkada biriken çöp dosyalar (orphan segments) ve FFMPEG kayıt işlemleri sistem
   tarafından tespit edilip temizlenir.

## 📜 Lisans

MIT License
