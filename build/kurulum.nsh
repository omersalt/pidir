; Varsayılan kurulum dizinini Ömer'in kök düzenine uydurur:
;   C:\Program Files\LLM Programları\Pidır
; Kullanıcı kurulum sihirbazında bunu yine değiştirebilir
; (electron-builder.yml → allowToChangeInstallationDirectory: true).
;
; NOT: Bu dosya UTF-8 BOM ile kaydedilmelidir. electron-builder NSIS'i Unicode
; kipinde derler; BOM olmadan "Programları" / "Pidır" bozulur ve kurulum VAR OLAN
; klasörün yanına ikinci bir klasör açar.

!macro preInit
  SetRegView 64
  WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "$PROGRAMFILES64\LLM Programları\Pidır"
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$PROGRAMFILES64\LLM Programları\Pidır"
  SetRegView 32
  WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "$PROGRAMFILES64\LLM Programları\Pidır"
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$PROGRAMFILES64\LLM Programları\Pidır"
!macroend
