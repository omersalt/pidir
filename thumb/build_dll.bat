@echo off
call "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat" >nul
cd /d C:\PidirDev\thumb
cl /nologo /std:c++17 /EHsc /MD /LD PidirPdfThumb.cpp /Fe:PidirPdfThumb.dll /link /DEF:exports.def
if errorlevel 1 (echo BUILD_FAIL & exit /b 1)
echo BUILD_OK
