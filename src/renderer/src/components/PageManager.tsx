import { useCallback, useRef, useState } from 'react'
import type { DocEntry } from '../types'
import { PageView } from './PageView'
import { CloseIcon } from './icons'

interface PageManagerProps {
  doc: DocEntry
  onClose: () => void
  onDelete: (indices: number[]) => void
  onRotate: (indices: number[], delta: number) => void
  onExtract: (indices: number[]) => void
  onReorder: (order: number[]) => void
}

const THUMB_W = 150

/** Sayfa yöneticisi: küçük resim ızgarası, çoklu seçim, döndür/sil/ayıkla + sürükle-sırala. */
export function PageManager({
  doc,
  onClose,
  onDelete,
  onRotate,
  onExtract,
  onReorder
}: PageManagerProps): React.JSX.Element {
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [overIdx, setOverIdx] = useState<number | null>(null)
  const anchor = useRef(0)

  const toggle = useCallback((i: number, e: React.MouseEvent) => {
    setSelected((prev) => {
      // Shift: sabit çapa'dan aralığı YENİDEN kur (birleştirme değil → daraltılabilir de).
      if (e.shiftKey && prev.size > 0) {
        const next = new Set<number>()
        const [a, b] = anchor.current < i ? [anchor.current, i] : [i, anchor.current]
        for (let k = a; k <= b; k++) next.add(k)
        return next
      }
      const next = new Set(prev)
      if (e.ctrlKey || e.metaKey) {
        if (next.has(i)) next.delete(i)
        else next.add(i)
      } else {
        next.clear()
        next.add(i)
      }
      return next
    })
    if (!e.shiftKey) anchor.current = i // shift-tık çapa'yı taşımamalı
  }, [])

  const sel = (): number[] => [...selected].sort((a, b) => a - b)
  const anySel = selected.size > 0

  const doReorder = useCallback(
    (from: number, to: number) => {
      if (from === to) return
      const order = doc.pages.map((_, i) => i)
      const [moved] = order.splice(from, 1)
      order.splice(to > from ? to - 1 : to, 0, moved)
      onReorder(order)
      setSelected(new Set())
    },
    [doc, onReorder]
  )

  return (
    <div className="pagemgr">
      <div className="pagemgr-bar">
        <strong className="pagemgr-title">Sayfalar</strong>
        <span className="pagemgr-count">
          {anySel ? `${selected.size} seçili` : `${doc.pages.length} sayfa`}
        </span>
        <div className="pagemgr-actions">
          <button className="btn ghost" disabled={!anySel} onClick={() => onRotate(sel(), -90)}>
            ⟲ Sola
          </button>
          <button className="btn ghost" disabled={!anySel} onClick={() => onRotate(sel(), 90)}>
            ⟳ Sağa
          </button>
          <button className="btn ghost" disabled={!anySel} onClick={() => onExtract(sel())}>
            Ayıkla
          </button>
          <button
            className="btn ghost danger"
            disabled={!anySel}
            onClick={() => {
              onDelete(sel())
              setSelected(new Set())
            }}
          >
            Sil
          </button>
        </div>
        <button className="icon-btn" title="Kapat (Esc)" onClick={onClose}>
          <CloseIcon size={16} />
        </button>
      </div>
      <div className="pagemgr-grid">
        {doc.pages.map((p, i) => (
          <div
            key={p.id}
            className={
              'pmthumb' +
              (selected.has(i) ? ' selected' : '') +
              (overIdx === i && dragIdx !== null ? ' over' : '')
            }
            style={{ width: THUMB_W }}
            draggable
            onClick={(e) => toggle(i, e)}
            onDragStart={() => setDragIdx(i)}
            onDragOver={(e) => {
              e.preventDefault()
              setOverIdx(i)
            }}
            onDragEnd={() => {
              setDragIdx(null)
              setOverIdx(null)
            }}
            onDrop={(e) => {
              e.preventDefault()
              if (dragIdx !== null) doReorder(dragIdx, i)
              setDragIdx(null)
              setOverIdx(null)
            }}
          >
            <div className="pmthumb-page" style={{ width: THUMB_W, height: THUMB_W * (p.height / p.width) }}>
              <PageView
                pdf={p.source.pdf}
                pageNumber={p.pageIndex + 1}
                naturalWidth={p.width}
                naturalHeight={p.height}
                version={0}
                detail={false}
              />
            </div>
            <span className="pmthumb-num">{i + 1}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
