import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowUpRight, Check, ChevronDown, MapPin, Star } from 'lucide-react'
import { usePrinterStore } from '@/store/printer-store'
import { BUILDING_GPS_COORDINATES } from '@/data/printers'
import { useGeolocation, calculateGpsDistance, formatGpsDistance } from '@/hooks/useGeolocation'
import { usePrintCopy } from '@/lib/print-copy'
import { Button } from '@/components/ui/button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { QueueDetails } from './QueueDetails'
import type { Printer } from '@/types/printer'

/** Shared presentation for the sheet and dialog; the selected queue owns every action. */
export function PrinterDetails({ initialPrinter, onClose }: { initialPrinter: Printer; onClose: () => void }) {
  const [queue, setQueue] = useState(initialPrinter.queue_name)
  const store = usePrinterStore()
  const printer = store.printers.find(item => item.queue_name === queue) ?? initialPrinter
  const variants = store.printers.filter(item => item.group_id && item.group_id === initialPrinter.group_id)
  const { text } = usePrintCopy()
  const navigate = useNavigate()
  const { position, loading, requestPosition, isSupported } = useGeolocation()
  const coords = BUILDING_GPS_COORDINATES[printer.location.building]
  const validPosition = position && (position.lat !== 0 || position.lng !== 0) ? position : null
  const distance = coords && validPosition ? calculateGpsDistance(validPosition.lat, validPosition.lng, coords.lat, coords.lng) : null
  const destination = coords ? `${coords.lat},${coords.lng}` : null
  const directions = destination ? `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=walking${validPosition ? `&origin=${validPosition.lat},${validPosition.lng}` : ''}` : null
  const isDefault = store.settings.defaultPrinter === printer.queue_name
  return <div className="flex min-h-0 flex-1 flex-col">
    <header className="shrink-0 px-6 pb-5 pt-8 sm:px-8">
      <p className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground"><MapPin className="size-3.5" />{printer.location.building} · {printer.location.floor}</p>
      <h3 className="pr-8 text-2xl font-semibold tracking-tight">{printer.group_id || printer.name}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{printer.location.room}</p>
      <p className="mt-3 text-xs text-muted-foreground">{printer.supports_color ? text.color : text.mono} <span aria-hidden="true">·</span> {printer.supported_paper_sizes.join(' / ')}</p>
      {variants.length > 1 && <div className="mt-5">
        <SegmentedControl ariaLabel={text.queueChoice} value={queue} onValueChange={setQueue} mobileLayout="equal" items={variants.map(item => ({ value: item.queue_name, label: item.variant === 'sx' ? text.simplex : item.variant === 'dx' ? text.duplex : item.queue_name }))} />
      </div>}
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 sm:px-8">
      <QueueDetails key={queue} queue={queue} active />
      <details className="group mt-6 border-t border-border/60 pt-4">
        <summary className="flex cursor-pointer list-none items-center justify-between py-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">{text.printerInfo}<ChevronDown className="size-4 transition-transform group-open:rotate-180" /></summary>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-5 gap-y-3 text-xs">
          <dt className="text-muted-foreground">{text.queue}</dt><dd className="text-right">{printer.queue_name}</dd>
          {printer.model && <><dt className="text-muted-foreground">{text.model}</dt><dd className="text-right">{printer.model}</dd></>}
          <dt className="text-muted-foreground">{text.banner}</dt><dd className="text-right">{printer.has_banner ? text.included : text.none}</dd>
        </dl>
        {directions && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs">
          <a href={directions} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">{text.directions}<ArrowUpRight className="size-3.5" /></a>
          {distance !== null ? <span className="text-muted-foreground">{formatGpsDistance(distance)}</span> : isSupported && <Button variant="ghost" size="sm" disabled={loading} onClick={requestPosition}>{loading ? text.locating : text.locate}</Button>}
        </div>}
      </details>
    </div>
    <footer className="grid shrink-0 grid-cols-1 items-center gap-2 border-t border-border/60 bg-background px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex sm:gap-3 sm:px-8">
      <Button variant="ghost" size="sm" disabled={isDefault} className="gap-2" onClick={() => store.setSettings({ defaultPrinter: queue })}>{isDefault ? <Check className="size-4" /> : <Star className="size-4" />}{isDefault ? text.defaultPrinter : text.setDefault}</Button>
      <Button className="order-first sm:order-none sm:ml-auto" disabled={['Offline', 'Error', 'OutOfPaper'].includes(printer.status)} onClick={() => { store.setQuickPrintPrinter(queue); onClose(); navigate('/home') }}>{text.usePrinter}<ArrowUpRight className="size-4" /></Button>
    </footer>
  </div>
}
