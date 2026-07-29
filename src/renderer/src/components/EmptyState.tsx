import { ImportArrowIcon } from './icons'

interface EmptyStateProps {
  onOpen: () => void
  lastPath: string | null
  onReopen: () => void
  dragActive: boolean
}

export function EmptyState({ onOpen, lastPath, onReopen, dragActive }: EmptyStateProps): React.JSX.Element {
  const lastName = lastPath ? lastPath.split(/[\\/]/).pop() : null
  return (
    <div className="empty">
      <div className={'empty-card' + (dragActive ? ' drag' : '')}>
        <div className="empty-glyph">
          <ImportArrowIcon size={40} strokeWidth={1.4} />
        </div>
        <h1>Pidır</h1>
        <p className="empty-sub">PDF aç ya da buraya sürükle</p>
        <button className="btn primary" onClick={onOpen}>
          PDF Aç
        </button>
        {lastName && (
          <button className="btn ghost" title={lastPath ?? undefined} onClick={onReopen}>
            Son: {lastName}
          </button>
        )}
      </div>
    </div>
  )
}
