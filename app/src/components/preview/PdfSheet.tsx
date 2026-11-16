import { useEffect, useRef, useState } from 'react'
import { Document, Page } from 'react-pdf'
import { fitPage } from '@/lib/print-preview'

function FittedPage({ pageNumber }: { pageNumber: number }) {
  const container = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 1, height: 1 })
  const [ratio, setRatio] = useState<number | null>(null)
  useEffect(() => {
    if (!container.current) return
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(container.current)
    return () => observer.disconnect()
  }, [])
  return (
    <div ref={container} className="flex h-full min-h-0 min-w-0 items-center justify-center overflow-hidden bg-white">
      <Page
        pageNumber={pageNumber}
        width={ratio ? fitPage(size.width, size.height, ratio, 1) : 1}
        onLoadSuccess={page => {
          const viewport = page.getViewport({ scale: 1 })
          setRatio(viewport.width / viewport.height)
        }}
        className={ratio ? '' : 'invisible'}
        renderTextLayer={false}
        renderAnnotationLayer={false}
        loading={null}
        error={<span className="text-xs text-red-700">Page could not be rendered</span>}
      />
    </div>
  )
}

/** One document context per sheet; page sizes use PDF.js crop boxes and rotation. */
export function PdfSheet({ file, pages, cols, rows, rotation = 0 }: {
  file: string; pages: (number | null)[]; cols: number; rows: number; rotation?: number
}) {
  return (
    <Document file={file} className="h-full w-full" loading={null} error={<p>PDF preview unavailable</p>}>
      <div className="grid h-full w-full bg-white" style={{
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
        transform: `rotate(${rotation}deg)`,
      }}>
        {Array.from({ length: cols * rows }, (_, index) => pages[index]
          ? <FittedPage key={pages[index]} pageNumber={pages[index]!} />
          : <div key={`blank-${index}`} className="bg-white" aria-label="Blank page area" />)}
      </div>
    </Document>
  )
}
