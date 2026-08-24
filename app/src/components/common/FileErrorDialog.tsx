import { AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface FileErrorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  message: string
  technicalDetails?: string
}

export function FileErrorDialog({
  open,
  onOpenChange,
  title,
  message,
  technicalDetails,
}: FileErrorDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="min-w-0">
        <DialogHeader className="min-w-0 pr-8">
          <div className="flex items-center gap-2 text-left">
            <AlertCircle className="size-5 shrink-0 text-destructive" />
            <DialogTitle>{title}</DialogTitle>
          </div>
          <DialogDescription className="text-left leading-6">{message}</DialogDescription>
        </DialogHeader>

        {technicalDetails && (
          <details className="min-w-0 rounded-md bg-muted/70 p-3 text-left">
            <summary className="cursor-pointer text-sm font-medium text-foreground">
              Technical details
            </summary>
            <pre className="mt-3 max-h-36 min-w-0 overflow-auto whitespace-pre-wrap break-all font-mono text-xs leading-5 text-muted-foreground">
              {technicalDetails}
            </pre>
          </details>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button>Close</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
