# IPTV Plus

TV kumandası ile kontrol edilebilen IPTV oynatıcı. DVR (geri sarma) özelliği ile kanalları canlı izlerken istediğiniz
anı geri sarabilirsiniz.

## Ozellikler

- 📺 **Canli IPTV yayini** - M3U8 playlist destegi
- 📂 **Kategori bazli navigasyon** - M3U8 group-title ile otomatik kategori siniflandirma
- 🌟 **Favori kanallar** - 1-9 tuslari ile hizli erisim, uzun basma ile ekleme/cikarma
- 📊 **En cok izlenenler** - Izleme geccmisi takibi
- 🔍 **Kanal arama** - Hizli kanal bulma
- ⏪ **180 dakika DVR** - Izlediginiz kanali diske kaydeder, geri sarabilirsiniz
- 🎮 **Kumanda destegi** - TV kumandasi tuslari ile kontrol
- ⏯️ **Progress bar** - Ilerleme durumu, zaman gosterimi
- 📡 **Canliya don** - Geri sarilmis yayinda canliya hizli donus
- ⛶ **Fullscreen** - Tam ekran modu

## TV Kumandasi Tuslari

| Tus          | Islev                                  |
|--------------|----------------------------------------|
| 1-9          | Favori kanal (Ana sayfada)             |
| OK / Enter   | Oynat/Duraklat                         |
| ↑ ↓          | Kanal degistir                         |
| ← →          | 10 sn geri/ileri                       |
| Exit / Back  | Kanal listesini kapat / Kategoriye don |
| Harf tuslari | Arama kutusuna odaklan                 |
| Menu         | Fullscreen                             |

## Kurulum

### Yereli calistirma

```bash
# Baglililiklari yukle
npm install

# .env dosyasi olustur
echo "PLAYLIST_URL=https://playlist-url.m3u8" > .env

# Calistir
npm start
```

Tarayicida acin: `http://localhost:3000`

### Docker ile

```bash
# .env dosyasi olustur
cat > .env << EOF
PLAYLIST_URL=https://your-playlist-url.m3u8
TZ=Europe/Istanbul
EOF

# Build et ve calistir
docker build -t iptv-plus .
docker run -d \
  -p 3000:3000 \
  --env-file .env \
  -v $(pwd)/tmp:/tmp/iptv-buffer \
  --name iptv-plus \
  iptv-plus
```

### Docker Compose

```bash
# .env dosyasi olustur
cat > .env << EOF
PLAYLIST_URL=https://your-playlist-url.m3u8
TZ=Europe/Istanbul
EOF

# Baslat
docker-compose up -d
```

## Yapilandirma

Environment variables:

| Degisken       | Zorunlu | Varsayilan       | Aciklama          |
|----------------|---------|------------------|-------------------|
| `PLAYLIST_URL` | Evet    | -                | M3U8 playlist URL |
| `BUFFER_DIR`   | Hayir   | /tmp/iptv-buffer | Buffer klasoru    |
| `PORT`         | Hayir   | 3000             | Sunucu portu      |
| `TZ`           | Hayir   | Europe/Istanbul  | Timezone          |

## Kullanim

1. **Ana Sayfa**: Kategoriler arasindan secim yapin
2. **Kanallar**: Kategori icerisinde kanal secin
3. **Favorilere Ekle**: Kanala uzun basin (800ms)
4. **Favoriden Cikar**: Favori kanala uzun basin
5. **Favori Ac**: 1-9 tusuna basin (Ana sayfada)
6. **Player**: DVR ile geri sarma, progress bar, canliya donus

## Gereksinimler

- Node.js 18+
- FFmpeg (Docker ile otomatik)
- M3U8 playlist URL (group-title destekli)

## Notlar

- DVR bufferi 180 dakikadir
- Favoriler tarayicida saklanir (localStorage)
- Izleme geccmisi 10 kanal tutulur
- Her kategoriye ozel kanal listesi

## Lisans

MIT
