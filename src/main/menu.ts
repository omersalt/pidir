import { Menu } from 'electron'

// Çerçevesiz pencerede (frame:false) menü çubuğu YOK ve özel menü hızlandırıcıları
// ATEŞLENMEZ. Bu yüzden uygulama kısayolları (Aç/Kaydet/Yeni Pencere/Zoom/PiP)
// renderer'da (App.tsx keydown) ele alınır. Burada yalnız standart rol menüleri
// kalır — metin kutularında kopyala/yapıştır ve pencere komutları OS düzeyinde çalışsın.
export function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? ([{ role: 'appMenu' }] as Electron.MenuItemConstructorOptions[])
      : []),
    { role: 'editMenu' },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
