import type { Printer } from '@/types/printer'
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { PrinterDetails } from './PrinterDetails'

export function PrinterDetailSheet({ printer, open, onOpenChange }: { printer: Printer | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  if (!printer) return null
  return <Sheet open={open} onOpenChange={onOpenChange}>
    <SheetContent side="right" className="w-full gap-0 border-0 p-0 sm:w-full sm:max-w-lg">
      <SheetTitle className="sr-only">{printer.group_id || printer.name}</SheetTitle>
      <SheetDescription className="sr-only">{printer.location.building} · {printer.location.room}</SheetDescription>
      {open && <PrinterDetails key={printer.id} initialPrinter={printer} onClose={() => onOpenChange(false)} />}
    </SheetContent>
  </Sheet>
}
