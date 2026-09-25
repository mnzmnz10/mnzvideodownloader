@echo off
chcp 65001 >nul
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
    echo Python bulunamadi! Once https://www.python.org/downloads/ adresinden kurun.
    pause
    exit /b 1
)

if not exist ".venv\Scripts\python.exe" python -m venv .venv
".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -q -U -r requirements.txt pyinstaller
if errorlevel 1 (pause & exit /b 1)

".venv\Scripts\pyinstaller.exe" --noconfirm --onefile --windowed ^
    --name "VideoIndirici" ^
    --collect-data imageio_ffmpeg ^
    --collect-submodules yt_dlp ^
    indirici.py

echo.
if exist "dist\VideoIndirici.exe" (
    echo Tamamlandi:  dist\VideoIndirici.exe
    echo Bu tek dosyayi istediginiz bilgisayara kopyalayip calistirabilirsiniz.
) else (
    echo EXE olusturulamadi, yukaridaki hatalari kontrol edin.
)
pause
