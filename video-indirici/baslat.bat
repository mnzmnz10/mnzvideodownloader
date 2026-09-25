@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Video / Ses Indirici

where python >nul 2>nul
if errorlevel 1 (
    echo Python bulunamadi!
    echo https://www.python.org/downloads/ adresinden Python 3 kurun.
    echo Kurulumda "Add python.exe to PATH" kutusunu isaretlemeyi unutmayin.
    pause
    exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
    echo Ilk kurulum yapiliyor, lutfen bekleyin...
    python -m venv .venv || (pause & exit /b 1)
)

echo Gerekli paketler kontrol ediliyor / guncelleniyor...
".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -q -U -r requirements.txt
if errorlevel 1 (
    echo Paketler kurulamadi. Internet baglantinizi kontrol edin.
    pause
    exit /b 1
)

start "" ".venv\Scripts\pythonw.exe" indirici.py
