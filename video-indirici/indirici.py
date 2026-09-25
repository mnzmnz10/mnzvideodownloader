"""
Video / Ses İndirici
--------------------
YouTube, Instagram, X (Twitter), TikTok, Facebook ve yt-dlp'nin desteklediği
binlerce siteden MP4 video veya MP3 ses indirmek için basit bir Windows arayüzü.

Gereksinimler: yt-dlp, imageio-ffmpeg  (bkz. requirements.txt)
"""

import os
import queue
import subprocess
import sys
import threading
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

try:
    import yt_dlp
except ImportError:  # pragma: no cover - kullanıcıya anlaşılır hata göster
    tk.Tk().withdraw()
    messagebox.showerror(
        "Eksik paket",
        "yt-dlp bulunamadı.\n\nLütfen 'baslat.bat' dosyasını çalıştırın\n"
        "veya komut satırında:  pip install -r requirements.txt",
    )
    sys.exit(1)

try:
    import imageio_ffmpeg

    FFMPEG_PATH = imageio_ffmpeg.get_ffmpeg_exe()
except Exception:  # sistemdeki ffmpeg kullanılır (PATH'te varsa)
    FFMPEG_PATH = None


APP_TITLE = "Video / Ses İndirici"
QUALITIES = ["En iyi", "2160p (4K)", "1440p", "1080p", "720p", "480p", "360p"]
MP3_BITRATES = ["320", "256", "192", "128"]
BROWSERS = ["Yok", "firefox", "chrome", "edge", "brave", "opera", "vivaldi"]


class DownloadCancelled(Exception):
    pass


def default_download_dir():
    path = os.path.join(os.path.expanduser("~"), "Downloads")
    return path if os.path.isdir(path) else os.path.expanduser("~")


def build_options(mode, quality, bitrate, out_dir, playlist, h264, thumbnail, browser):
    """Seçilen ayarlara göre yt-dlp seçeneklerini oluşturur."""
    opts = {
        "outtmpl": os.path.join(out_dir, "%(title).150B [%(id)s].%(ext)s"),
        "windowsfilenames": True,
        "noplaylist": not playlist,
        "ignoreerrors": playlist,  # listedeki tek bir hata tüm indirmeyi durdurmasın
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "retries": 10,
        "fragment_retries": 10,
        "concurrent_fragment_downloads": 4,
        "postprocessors": [],
    }
    if FFMPEG_PATH:
        opts["ffmpeg_location"] = FFMPEG_PATH
    if browser and browser != "Yok":
        opts["cookiesfrombrowser"] = (browser,)

    if mode == "mp3":
        opts["format"] = "bestaudio/best"
        opts["postprocessors"].append(
            {"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": bitrate}
        )
    else:
        height = None if quality == "En iyi" else int(quality.split("p")[0])
        sort = []
        if h264:
            # Windows'un kendi oynatıcısında sorunsuz açılan H.264 + AAC tercih edilir
            sort += ["vcodec:h264", "acodec:aac"]
        sort.insert(0, f"res:{height}" if height else "res")
        opts["format"] = "bv*+ba/b"
        opts["format_sort"] = sort
        opts["merge_output_format"] = "mp4"
        # Birleştirme sonrası farklı bir kapsayıcı çıktıysa yine mp4'e çevir
        opts["postprocessors"].append({"key": "FFmpegVideoRemuxer", "preferedformat": "mp4"})

    opts["postprocessors"].append({"key": "FFmpegMetadata", "add_metadata": True})
    if thumbnail:
        opts["writethumbnail"] = True
        opts["postprocessors"].append({"key": "EmbedThumbnail", "already_have_thumbnail": False})
    return opts


class App:
    def __init__(self, root):
        self.root = root
        self.events = queue.Queue()
        self.cancel_flag = threading.Event()
        self.worker = None

        root.title(APP_TITLE)
        root.geometry("720x560")
        root.minsize(600, 480)

        self.mode = tk.StringVar(value="mp4")
        self.quality = tk.StringVar(value="1080p")
        self.bitrate = tk.StringVar(value="320")
        self.out_dir = tk.StringVar(value=default_download_dir())
        self.playlist = tk.BooleanVar(value=False)
        self.h264 = tk.BooleanVar(value=True)
        self.thumbnail = tk.BooleanVar(value=True)
        self.browser = tk.StringVar(value="Yok")
        self.status = tk.StringVar(value="Hazır")

        self._build_ui()
        self._toggle_mode()
        self.root.after(100, self._poll_events)

    # ------------------------------------------------------------------ UI
    def _build_ui(self):
        pad = {"padx": 10, "pady": 5}
        main = ttk.Frame(self.root, padding=10)
        main.pack(fill="both", expand=True)

        ttk.Label(main, text="Bağlantı(lar) – her satıra bir adres:").pack(anchor="w")
        url_frame = ttk.Frame(main)
        url_frame.pack(fill="x", pady=(2, 5))
        self.url_text = tk.Text(url_frame, height=4, wrap="none", font=("Segoe UI", 10))
        self.url_text.pack(side="left", fill="x", expand=True)
        btns = ttk.Frame(url_frame)
        btns.pack(side="left", padx=(5, 0), fill="y")
        ttk.Button(btns, text="Yapıştır", command=self._paste).pack(fill="x")
        ttk.Button(btns, text="Temizle", command=lambda: self.url_text.delete("1.0", "end")).pack(
            fill="x", pady=(4, 0)
        )

        opts = ttk.LabelFrame(main, text="Ayarlar", padding=8)
        opts.pack(fill="x", pady=5)

        ttk.Label(opts, text="Biçim:").grid(row=0, column=0, sticky="w")
        ttk.Radiobutton(opts, text="MP4 Video", value="mp4", variable=self.mode,
                        command=self._toggle_mode).grid(row=0, column=1, sticky="w")
        ttk.Radiobutton(opts, text="MP3 Ses", value="mp3", variable=self.mode,
                        command=self._toggle_mode).grid(row=0, column=2, sticky="w")

        ttk.Label(opts, text="Video kalitesi:").grid(row=1, column=0, sticky="w", pady=4)
        self.quality_cb = ttk.Combobox(opts, textvariable=self.quality, values=QUALITIES,
                                       state="readonly", width=14)
        self.quality_cb.grid(row=1, column=1, sticky="w")
        self.h264_cb = ttk.Checkbutton(opts, text="Uyumlu mod (varsa H.264 seç)",
                                       variable=self.h264)
        self.h264_cb.grid(row=1, column=2, columnspan=2, sticky="w")

        ttk.Label(opts, text="MP3 kalitesi (kbps):").grid(row=2, column=0, sticky="w", pady=4)
        self.bitrate_cb = ttk.Combobox(opts, textvariable=self.bitrate, values=MP3_BITRATES,
                                       state="readonly", width=14)
        self.bitrate_cb.grid(row=2, column=1, sticky="w")

        ttk.Checkbutton(opts, text="Oynatma listesinin tamamını indir",
                        variable=self.playlist).grid(row=3, column=1, columnspan=2, sticky="w")
        ttk.Checkbutton(opts, text="Kapak resmini dosyaya ekle",
                        variable=self.thumbnail).grid(row=4, column=1, columnspan=2, sticky="w")

        ttk.Label(opts, text="Tarayıcı çerezleri:").grid(row=5, column=0, sticky="w", pady=4)
        ttk.Combobox(opts, textvariable=self.browser, values=BROWSERS, state="readonly",
                     width=14).grid(row=5, column=1, sticky="w")
        ttk.Label(opts, text="(Instagram / giriş gerektiren videolar için)",
                  foreground="gray").grid(row=5, column=2, columnspan=2, sticky="w")

        folder = ttk.Frame(main)
        folder.pack(fill="x", pady=5)
        ttk.Label(folder, text="Kayıt klasörü:").pack(side="left")
        ttk.Entry(folder, textvariable=self.out_dir).pack(side="left", fill="x", expand=True, padx=5)
        ttk.Button(folder, text="Seç...", command=self._choose_dir).pack(side="left")
        ttk.Button(folder, text="Aç", command=self._open_dir).pack(side="left", padx=(4, 0))

        actions = ttk.Frame(main)
        actions.pack(fill="x", pady=5)
        self.start_btn = ttk.Button(actions, text="İNDİR", command=self._start)
        self.start_btn.pack(side="left", ipadx=20, ipady=4)
        self.cancel_btn = ttk.Button(actions, text="İptal", command=self._cancel, state="disabled")
        self.cancel_btn.pack(side="left", padx=5, ipady=4)
        if not getattr(sys, "frozen", False):
            ttk.Button(actions, text="yt-dlp'yi güncelle", command=self._update_ytdlp).pack(
                side="right", ipady=4
            )

        self.progress = ttk.Progressbar(main, maximum=100)
        self.progress.pack(fill="x", pady=(5, 2))
        ttk.Label(main, textvariable=self.status).pack(anchor="w")

        log_frame = ttk.Frame(main)
        log_frame.pack(fill="both", expand=True, pady=(5, 0))
        self.log = tk.Text(log_frame, height=8, state="disabled", font=("Consolas", 9))
        scroll = ttk.Scrollbar(log_frame, command=self.log.yview)
        self.log.configure(yscrollcommand=scroll.set)
        self.log.pack(side="left", fill="both", expand=True)
        scroll.pack(side="right", fill="y")

        if not FFMPEG_PATH:
            self._log("UYARI: ffmpeg bulunamadı. MP3 dönüştürme ve video birleştirme çalışmayabilir.")

    def _toggle_mode(self):
        video = self.mode.get() == "mp4"
        self.quality_cb.configure(state="readonly" if video else "disabled")
        self.h264_cb.configure(state="normal" if video else "disabled")
        self.bitrate_cb.configure(state="disabled" if video else "readonly")

    def _paste(self):
        try:
            text = self.root.clipboard_get().strip()
        except tk.TclError:
            return
        if text:
            current = self.url_text.get("1.0", "end").strip()
            self.url_text.insert("end", ("\n" if current else "") + text)

    def _choose_dir(self):
        path = filedialog.askdirectory(initialdir=self.out_dir.get())
        if path:
            self.out_dir.set(path)

    def _open_dir(self):
        path = self.out_dir.get()
        if not os.path.isdir(path):
            return
        if sys.platform == "win32":
            os.startfile(path)
        else:
            subprocess.Popen(["xdg-open", path])

    def _log(self, msg):
        self.log.configure(state="normal")
        self.log.insert("end", msg + "\n")
        self.log.see("end")
        self.log.configure(state="disabled")

    # ------------------------------------------------------------ indirme
    def _start(self):
        urls = [u.strip() for u in self.url_text.get("1.0", "end").splitlines() if u.strip()]
        if not urls:
            messagebox.showwarning(APP_TITLE, "Lütfen en az bir bağlantı girin.")
            return
        out_dir = self.out_dir.get()
        try:
            os.makedirs(out_dir, exist_ok=True)
        except OSError as e:
            messagebox.showerror(APP_TITLE, f"Klasör oluşturulamadı:\n{e}")
            return

        opts = build_options(
            self.mode.get(), self.quality.get(), self.bitrate.get(), out_dir,
            self.playlist.get(), self.h264.get(), self.thumbnail.get(), self.browser.get(),
        )
        self.cancel_flag.clear()
        self.start_btn.configure(state="disabled")
        self.cancel_btn.configure(state="normal")
        self.progress["value"] = 0
        self.worker = threading.Thread(target=self._run, args=(urls, opts), daemon=True)
        self.worker.start()

    def _cancel(self):
        self.cancel_flag.set()
        self.status.set("İptal ediliyor...")

    def _run(self, urls, opts):
        put = self.events.put
        opts = dict(opts)
        opts["progress_hooks"] = [self._progress_hook]
        opts["postprocessor_hooks"] = [self._pp_hook]
        opts["logger"] = _QueueLogger(put)
        ok = fail = 0
        for i, url in enumerate(urls, 1):
            if self.cancel_flag.is_set():
                break
            put(("log", f"[{i}/{len(urls)}] {url}"))
            try:
                with yt_dlp.YoutubeDL(opts) as ydl:
                    code = ydl.download([url])
                if code:
                    fail += 1
                else:
                    ok += 1
            except DownloadCancelled:
                put(("log", "İndirme iptal edildi."))
                break
            except Exception as e:  # yt-dlp DownloadError vb.
                fail += 1
                put(("log", f"HATA: {_clean_error(e)}"))
        put(("done", (ok, fail, self.cancel_flag.is_set())))

    def _progress_hook(self, d):
        if self.cancel_flag.is_set():
            raise DownloadCancelled()
        name = os.path.basename(d.get("filename") or "")
        if d["status"] == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate")
            done = d.get("downloaded_bytes") or 0
            pct = done * 100 / total if total else 0
            text = f"İndiriliyor: %{pct:.1f}  {_fmt_size(done)}"
            if total:
                text += f" / {_fmt_size(total)}"
            if d.get("speed"):
                text += f"  •  {_fmt_size(d['speed'])}/sn"
            if d.get("eta") is not None:
                text += f"  •  kalan {int(d['eta'])} sn"
            self.events.put(("progress", (pct, text)))
        elif d["status"] == "finished":
            self.events.put(("progress", (100, f"İndirildi, işleniyor: {name}")))

    def _pp_hook(self, d):
        if d["status"] == "started":
            names = {
                "FFmpegExtractAudio": "MP3'e dönüştürülüyor...",
                "FFmpegMerger": "Görüntü ve ses birleştiriliyor...",
                "FFmpegVideoRemuxer": "MP4'e çevriliyor...",
                "EmbedThumbnail": "Kapak resmi ekleniyor...",
                "FFmpegMetadata": "Bilgiler ekleniyor...",
            }
            msg = names.get(d.get("postprocessor"))
            if msg:
                self.events.put(("status", msg))
        elif d["status"] == "finished" and d.get("postprocessor") == "MoveFiles":
            path = d.get("info_dict", {}).get("filepath")
            if path:
                self.events.put(("log", f"  ✔ Kaydedildi: {os.path.basename(path)}"))

    def _poll_events(self):
        try:
            while True:
                kind, data = self.events.get_nowait()
                if kind == "log":
                    self._log(data)
                elif kind == "status":
                    self.status.set(data)
                elif kind == "progress":
                    self.progress["value"], text = data[0], data[1]
                    self.status.set(text)
                elif kind == "done":
                    ok, fail, cancelled = data
                    self.start_btn.configure(state="normal")
                    self.cancel_btn.configure(state="disabled")
                    summary = f"Bitti: {ok} başarılı, {fail} hatalı" + (" (iptal edildi)" if cancelled else "")
                    self.status.set(summary)
                    self._log(summary)
                    if ok and not fail and not cancelled:
                        self.progress["value"] = 100
        except queue.Empty:
            pass
        self.root.after(100, self._poll_events)

    def _update_ytdlp(self):
        self._log("yt-dlp güncelleniyor...")

        def job():
            r = subprocess.run(
                [sys.executable, "-m", "pip", "install", "-U", "yt-dlp"],
                capture_output=True, text=True,
            )
            last = (r.stdout or r.stderr).strip().splitlines()[-1:] or [""]
            msg = "Güncellendi. Programı yeniden başlatın." if r.returncode == 0 else "Güncelleme başarısız."
            self.events.put(("log", f"{msg} {last[0]}"))

        threading.Thread(target=job, daemon=True).start()


class _QueueLogger:
    """yt-dlp mesajlarını arayüzdeki günlüğe aktarır."""

    def __init__(self, put):
        self.put = put

    def debug(self, msg):
        pass

    def info(self, msg):
        pass

    def warning(self, msg):
        pass

    def error(self, msg):
        self.put(("log", f"HATA: {_clean_error(msg)}"))


def _clean_error(e):
    text = str(e).replace("ERROR: ", "")
    low = text.lower()
    if "login" in low or "cookies" in low or "private" in low:
        text += "\n  → İpucu: 'Tarayıcı çerezleri' kısmından giriş yaptığınız tarayıcıyı seçin."
    elif "unsupported url" in low:
        text += "\n  → Bu site desteklenmiyor olabilir."
    return text


def _fmt_size(n):
    n = float(n or 0)
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} TB"


def main():
    if sys.platform == "win32":
        try:  # yüksek çözünürlüklü ekranlarda bulanıklığı önler
            from ctypes import windll
            windll.shcore.SetProcessDpiAwareness(1)
        except Exception:
            pass
    root = tk.Tk()
    try:
        ttk.Style().theme_use("vista" if sys.platform == "win32" else "clam")
    except tk.TclError:
        pass
    App(root)
    root.mainloop()


if __name__ == "__main__":
    main()
