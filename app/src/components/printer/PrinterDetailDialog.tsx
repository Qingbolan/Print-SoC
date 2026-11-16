import type { Printer } from '@/types/printer'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { PrinterDetails } from './PrinterDetails'

export function PrinterDetailDialog({ printer, open, onOpenChange }: { printer: Printer | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  if (!printer) return null
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg flex-col gap-0 overflow-hidden border-0 p-0">
      <DialogTitle className="sr-only">{printer.group_id || printer.name}</DialogTitle>
      <DialogDescription className="sr-only">{printer.location.building} · {printer.location.room}</DialogDescription>
      {open && <PrinterDetails key={printer.id} initialPrinter={printer} onClose={() => onOpenChange(false)} />}
    </DialogContent>
  </Dialog>
}
