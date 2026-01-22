import { usePrinterStore } from '@/store/printer-store'
import { Badge } from '@/components/ui/badge'
import { Wifi, WifiOff, Loader2, AlertCircle } from 'lucide-react'
import { useEffect, useState } from 'react'

export function ConnectionStatusBadge() {
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
          <Badge variant="secondary" className="bg-gray-500 text-white">
            <WifiOff className="w-3 h-3 mr-1" />
            Disconnected
          </Badge>
        )

      case 'connecting':
        return (
          <Badge variant="secondary" className="bg-blue-500 text-white">
            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            Connecting{elapsedTime > 0 && ` • ${elapsedTime}s`}
          </Badge>
        )

      case 'connected':
        return (
          <Badge variant="secondary" className="bg-green-500 text-white">
            <Wifi className="w-3 h-3 mr-1" />
            Connected
          </Badge>
        )

      case 'error':
        return (
          <Badge
            variant="secondary"
            className="bg-red-500 text-white cursor-help"
            title={connectionStatus.message}
          >
            <AlertCircle className="w-3 h-3 mr-1" />
            Connection Failed
          </Badge>
        )

      default:
        return null
    }
  }

  return (
    <div className="flex items-center">
      {renderStatus()}
    </div>
  )
}
