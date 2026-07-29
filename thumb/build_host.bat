@echo off
call "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat" >nul
cd /d C:\PidirDev\thumb
cl /nologo /std:c++17 /EHsc /MD host_test.cpp /link ole32.lib shlwapi.lib gdi32.lib
if errorlevel 1 (echo BUILD_FAIL & exit /b 1)
echo BUILD_OK
