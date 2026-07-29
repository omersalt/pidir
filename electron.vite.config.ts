import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// NOT: Bu projenin gerçek yolu "# Yardımcı Araçlar" içeriyor ve "#" karakteri
// Vite/Rollup'ın göreli import çözümünü bozar. Bu yüzden derleme/dev, "#" içermeyen
// bir junction'dan (ör. C:\PidirDev) çalıştırılır ve preserveSymlinks:true ile Rollup'ın
// junction'ı gerçek yola (#) çözmesi engellenir. Girdi yolları da cwd tabanlıdır.
const root = process.cwd()

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { preserveSymlinks: true },
    build: {
      rollupOptions: {
        input: {
          index: resolve(root, 'src/main/index.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { preserveSymlinks: true },
    build: {
      rollupOptions: {
        input: {
          index: resolve(root, 'src/preload/index.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve(root, 'src/renderer'),
    resolve: {
      preserveSymlinks: true,
      alias: {
        '@renderer': resolve(root, 'src/renderer/src'),
        'tesseract.js': 'tesseract.js/dist/tesseract.esm.min.js'
      }
    },
    worker: {
      format: 'es'
    },
    plugins: [react()],
    build: {
      // electron-vite'ın renderer ön ayarı minify'ı AÇIKÇA false yapıyor. Sonuç:
      // ana chunk 2,21 MB ham kaynak olarak paketleniyor ve pdf.worker.min.mjs
      // (zaten küçültülmüş, 1,23 MB) yeniden GÜZELLEŞTİRİLİP 1,72 MB'a şişiyordu.
      // Açık ayarla toplam renderer 3,93 MB → ~2,18 MB.
      minify: 'esbuild',
      rollupOptions: {
        input: {
          index: resolve(root, 'src/renderer/index.html')
        }
      }
    }
  }
})
