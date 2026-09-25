# Video / Ses İndirici (Windows)

YouTube, Instagram, X (Twitter), TikTok, Facebook, Vimeo, Twitch, Reddit, Dailymotion,
SoundCloud ve **yt-dlp'nin desteklediği 1000'den fazla siteden** **MP4 video** veya
**MP3 ses** indiren basit bir masaüstü programı.

## Özellikler
- MP4 video (En iyi / 4K / 1440p / 1080p / 720p / 480p / 360p)
- MP3 ses (320 / 256 / 192 / 128 kbps)
- Aynı anda birden fazla bağlantı (her satıra bir adres)
- İsteğe bağlı: oynatma listesinin tamamını indirme
- Kapak resmi ve başlık bilgilerini dosyaya ekleme
- "Uyumlu mod": Windows'un kendi oynatıcısında sorunsuz açılan H.264 video
- Giriş gerektiren içerikler (Instagram vb.) için tarayıcı çerezlerini kullanma
- İlerleme çubuğu, hız / kalan süre, iptal
- ffmpeg ayrıca kurulmaz, program içinde gelir

## Kurulum ve Çalıştırma
1. [Python 3](https://www.python.org/downloads/) kurun
   (kurulumda **"Add python.exe to PATH"** kutusunu işaretleyin).
2. `baslat.bat` dosyasına çift tıklayın.
   İlk açılışta gerekli paketler otomatik kurulur, sonra program açılır.

## Tek dosya .exe yapmak
`exe_olustur.bat` dosyasına çift tıklayın. Bitince `dist\VideoIndirici.exe` oluşur;
bu dosyayı Python kurulu olmayan bilgisayarlarda da çalıştırabilirsiniz.

> Siteler sık değiştiği için bir süre sonra indirme hataları başlarsa:
> `baslat.bat` her açılışta yt-dlp'yi otomatik günceller; `.exe` kullanıyorsanız
> `exe_olustur.bat` ile yeniden derleyin.

## Sık karşılaşılan sorunlar
| Sorun | Çözüm |
|---|---|
| Instagram / gizli video "login required" hatası | **Tarayıcı çerezleri** kısmından siteye giriş yaptığınız tarayıcıyı seçin. En sorunsuz çalışan **Firefox**'tur. Chrome/Edge seçiliyse indirme sırasında tarayıcıyı kapatın. |
| Video açılmıyor / sadece ses var | "Uyumlu mod" kutusunu işaretli bırakın. 4K gibi sadece VP9/AV1 sunulan videolar için [VLC](https://www.videolan.org/) kullanın. |
| "Unsupported URL" | Site desteklenmiyor ya da bağlantı hatalı. |
| Antivirüs .exe'yi engelliyor | PyInstaller ile yapılan exe'lerde yanlış alarm sık olur; `baslat.bat` ile çalıştırın. |

## Not
Yalnızca indirme hakkınız olan içerikleri (kendi videolarınız, izin verilmiş veya
telifsiz içerikler) indirin; sitelerin kullanım koşullarına ve telif haklarına uyun.
