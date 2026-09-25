# MNZ Video Downloader

YouTube, Instagram, X (Twitter), TikTok, Facebook, Vimeo, Twitch, Reddit, SoundCloud gibi
**yüzlerce siteden** **MP4 video** veya **MP3 ses** indiren Windows masaüstü uygulaması.
Arayüz Electron ile yazıldı; indirme işini [yt-dlp](https://github.com/yt-dlp/yt-dlp),
dönüştürmeyi ffmpeg yapar.

## Özellikler
- 🎬 MP4 video: En iyi / 4K / 1440p / 1080p / 720p / 480p / 360p
- 🎵 MP3 ses: 320 / 256 / 192 / 128 kbps
- Aynı anda birden fazla bağlantı (her satıra bir tane), sıralı indirme kuyruğu
- İlerleme çubuğu, hız, kalan süre, iptal
- Oynatma listesinin tamamını indirme
- Kapak resmi ve başlık bilgilerini dosyaya ekleme
- **Uyumlu mod:** varsa H.264 video seçer, Windows'un kendi oynatıcısında sorunsuz açılır
- Giriş isteyen içerikler (Instagram vb.) için **uygulama içi giriş**: siteye bir kez giriş yaparsınız,
  oturum hatırlanır; ayrıca `cookies.txt` dosyası veya Firefox çerezleri de kullanılabilir
- ffmpeg uygulamayla birlikte gelir; yt-dlp ilk açılışta otomatik indirilir ve
  **her açılışta kendini günceller** (siteler değiştikçe indirme bozulmaz)
- Açık / koyu tema (Windows temasına uyar), ayarlar hatırlanır

## İndirme ve otomatik güncelleme
Sağ taraftaki **Releases** bölümünden son sürümü açın ve **Assets** altından indirin:

| Dosya | Açıklama |
|---|---|
| `mnzvideodownloader-<sürüm>-setup.exe` | **Önerilen.** Kurulum programı; **kendini otomatik günceller** |
| `mnzvideodownloader-<sürüm>-portable.exe` | Kurulumsuz tek dosya; güncellemeleri yalnızca bildirir |

Kurulum sürümü açılışta ve 4 saatte bir yeni sürümü kontrol eder, arka planda indirir ve
uygulama kapatılınca kurar (üstte çıkan **Şimdi yeniden başlat** ile hemen de kurulabilir).

`main` dalına her gönderimde GitHub Actions uygulamayı Windows'ta derler, sürüm numarasını
otomatik artırır (`1.2.<derleme no>`) ve Releases'a yayınlar; kurulu uygulamalar bunu
güncelleme olarak alır. Büyük sürüm değişikliği için `package.json` içindeki `version`'ın
ilk iki hanesini değiştirin.

> Uygulama imzasız olduğu için ilk açılışta Windows SmartScreen uyarı verebilir:
> **Ek bilgi → Yine de çalıştır**.

## Kaynaktan çalıştırma / derleme
[Node.js](https://nodejs.org/) (20 veya üstü) kurun, sonra:

```bat
npm install
npm start          :: uygulamayı çalıştır
npm test           :: testleri çalıştır
npm run dist       :: dist\ klasörüne kurulum + portable .exe üret
```

## Sık karşılaşılan sorunlar
| Sorun | Çözüm |
|---|---|
| Instagram / gizli video "login required" | **Çerezler → Uygulama içi giriş**'i seçin, siteye tıklayıp açılan pencerede giriş yapın ve pencereyi kapatın. |
| "Could not copy Chrome cookie database" / "Failed to decrypt with DPAPI" | Chrome, Edge ve Brave çerezlerini Windows'ta şifreledikleri için dışarıdan okunamıyor. **Uygulama içi giriş**'i kullanın. |
| YouTube girişi "tarayıcı güvenli değil" diyor | Google gömülü pencerelerde girişi engelleyebilir. YouTube'da çoğu video giriş gerektirmez; gerekirse **cookies.txt** seçeneğini kullanın. |
| Video açılmıyor | "Uyumlu mod"u açık tutun. 4K gibi yalnızca VP9/AV1 sunulan videolar için [VLC](https://www.videolan.org/) kullanın. |
| Sağ üstte kırmızı "İndirme motoru hazırlanamadı" | İnternet bağlantısını kontrol edip yazıya tıklayın (yeniden dener). |
| Birden bire indirmeler hata veriyor | Uygulamayı yeniden başlatın; yt-dlp açılışta güncellenir. |

## Proje yapısı
```
src/main.js            Electron ana süreç: pencere, ayarlar, indirme kuyruğu
src/preload.js         Arayüze açılan güvenli köprü (contextIsolation)
src/downloader.js      yt-dlp indirme/güncelleme, işlem başlatma ve iptal
src/updater.js         Uygulamanın GitHub Releases üzerinden otomatik güncellenmesi
src/args.js            yt-dlp argümanları + çıktı çözümleme (testli)
src/renderer/          Arayüz (HTML / CSS / JS)
test/                  node:test birim testleri
build/icon.png         Uygulama simgesi
```

## Not
Yalnızca indirme hakkınız olan içerikleri indirin; sitelerin kullanım koşullarına ve
telif haklarına uyun.
