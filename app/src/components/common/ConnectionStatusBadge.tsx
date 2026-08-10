import { usePrinterStore } from '@/store/printer-store'
import { Badge } from '@/components/ui/badge'
import { Wifi, WifiOff, Loader2, AlertCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

export function ConnectionStatusBadge({ compact = false }: { compact?: boolean }) {
  const { connectionStatus } = usePrinterStore()
  const [elapsedTime, setElapsedTime] = useState(0)

  useEffect(() => {
    if (connectionStatus.type === 'connecting') {
      const interval = setInterval(() => {
        setElapsedTime(prev => prev + 1)
      }, 1000)
      return () => clearInterval(interval)
    } else {
      setElapsedTime(0)
    }
  }, [connectionStatus])

  const renderStatus = () => {
    switch (connectionStatus.type) {
      case 'disconnected':
        return (
          <Badge variant="secondary" className="bg-secondary text-secondary-foreground">
            <WifiOff className="w-3 h-3 mr-1" />
            {!compact && 'Disconnected'}
          </Badge>
        )

      case 'connecting':
        return (
          <Badge variant="secondary" className="bg-primary text-primary-foreground">
            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            {!compact && <>Connecting{elapsedTime > 0 && ` · ${elapsedTime}s`}</>}
          </Badge>
        )

      case 'connected':
        return (
          <Badge variant="secondary" className="bg-success text-success-foreground">
            <Wifi className="w-3 h-3 mr-1" />
            {!compact && 'Connected'}
          </Badge>
        )

      case 'error':
        return (
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" aria-label="Show connection error details">
                <Badge
                  variant="secondary"
                  className="cursor-pointer bg-destructive text-destructive-foreground"
                >
                  <AlertCircle className="w-3 h-3 mr-1" />
                  {!compact && 'Connection Failed'}
                </Badge>
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 space-y-3">
              <div>
                <div className="text-sm font-semibold text-foreground">Connection failed</div>
                <p className="mt-1 text-sm text-muted-foreground">{connectionStatus.message}</p>
              </div>
              <Button asChild size="sm" variant="secondary" className="w-full">
                <Link to="/settings">Open connection settings</Link>
              </Button>
            </PopoverContent>
          </Popover>
        )

      default:
        return null
    }
  }

  return (
    <div className="flex items-center" aria-label={`Connection status: ${connectionStatus.type}`}>
      {renderStatus()}
    </div>
  )
}
