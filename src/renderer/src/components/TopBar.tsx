import { MinusIcon, PlusIcon, SearchIcon } from './icons'

interface TopBarProps {
  name: string
  page: number
  total: number
  scale: number
  mac: boolean
  win: boolean
  show: boolean
  onOpen: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onFitWidth: () => void
  onFind: () => void
  onMenu: (x: number, y: number) => void
}

// 100% = gerçek boyut (PDF puanı 96 dpi'da 96/72 CSS px'e denk gelir).
const percent = (scale: number): number => Math.round(scale * 75)

function FitWidthIcon(): React.JSX.Element {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="5" width="16" height="14" rx="1.5" />
      <path d="M8 12h8M8 12l2-2M8 12l2 2M16 12l-2-2M16 12l-2 2" />
    </svg>
  )
}

function DotsIcon(): React.JSX.Element {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  )
}

/**
 * qView ruhu: varsayılan görünmez; imleç üste yaklaşınca beliren ince çubuk.
 * Windows'ta sağ üstteki yerel pencere düğmelerine yer bırakır (padding-right).
 */
export function TopBar({
  name,
  page,
  total,
  scale,
  mac,
  win,
  show,
  onOpen,
  onZoomIn,
  onZoomOut,
  onFitWidth,
  onFind,
  onMenu
}: TopBarProps): React.JSX.Element {
  return (
    <div className={'topbar' + (mac ? ' mac' : '') + (win ? ' win' : '') + (show ? ' show' : '')}>
      <button className="topbar-name" title="Aç… (Ctrl+O)" onClick={onOpen}>
        {name || 'Pidır'}
      </button>
      <div className="topbar-spacer" />
      <span className="topbar-page">
        {page} / {total}
      </span>
      <div className="topbar-cluster">
        <button className="icon-btn" title="Uzaklaştır" onClick={onZoomOut}>
          <MinusIcon size={15} />
        </button>
        <button className="topbar-pct" title="Genişliğe sığdır" onClick={onFitWidth}>
          %{percent(scale)}
        </button>
        <button className="icon-btn" title="Yakınlaştır" onClick={onZoomIn}>
          <PlusIcon size={15} />
        </button>
        <button className="icon-btn" title="Genişliğe sığdır" onClick={onFitWidth}>
          <FitWidthIcon />
        </button>
        <button className="icon-btn" title="Ara (Ctrl+F)" onClick={onFind}>
          <SearchIcon size={15} />
        </button>
        <button
          className="icon-btn"
          title="Menü"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            onMenu(r.right - 220, r.bottom + 6)
          }}
        >
          <DotsIcon />
        </button>
      </div>
    </div>
  )
}
