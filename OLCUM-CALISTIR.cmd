@echo off
title Pidir acilis olcumu
echo Pidir acilis suresi olculuyor - 4 kez acilip kapanacak, ~1 dakika.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0olc-acilis.ps1" > "%~dp0olcum-sonuc.txt" 2>&1
type "%~dp0olcum-sonuc.txt"
echo.
echo Sonuc dosyasi: %~dp0olcum-sonuc.txt
pause
