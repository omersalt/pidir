# Kurulum SONRASI acilis olcumu: kurulu Pidir vs eski portable.
$ErrorActionPreference = 'Continue'
$pdf = 'C:\Users\Ömer Salt\Downloads\hair experiment.pdf'
$kurulu = 'C:\Program Files\LLM Programları\Pidır\pidir\pidir.exe'
$portable = 'C:\PidirDev\dist\Pidır-0.1.0-portable.exe'

function Olc([string]$exe, [string]$etiket) {
    if (-not (Test-Path $exe)) { "{0,-24}: BULUNAMADI" -f $etiket; return }
    Get-Process -Name pidir -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Milliseconds 800
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $null = Start-Process -FilePath $exe -ArgumentList "`"$pdf`"" -PassThru
    $gorundu = $null
    while ($sw.ElapsedMilliseconds -lt 60000) {
        $p = Get-Process -Name pidir -ErrorAction SilentlyContinue |
             Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
        if ($p) { $gorundu = $sw.ElapsedMilliseconds; break }
        Start-Sleep -Milliseconds 25
    }
    $sw.Stop()
    if ($gorundu) { "{0,-24}: {1} ms" -f $etiket, $gorundu }
    else { "{0,-24}: 60 sn icinde pencere gorunmedi" -f $etiket }
    Start-Sleep -Milliseconds 1500
    Get-Process -Name pidir -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Milliseconds 500
}

".pdf komutu: " + (Get-ItemProperty 'HKCU:\SOFTWARE\Classes\pdf_auto_file\shell\open\command' -EA SilentlyContinue).'(default)'
""
Olc $kurulu   'KURULU (1. soguk)'
Olc $kurulu   'KURULU (2. sicak)'
Olc $portable 'ESKI portable'
