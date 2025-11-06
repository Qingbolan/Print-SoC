import { Settings, Terminal, Wifi } from "lucide-react"
import { PageHeader } from "@/components/PageHeader"
import { usePrinterStore } from "@/store/printer-store"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { safeOpenDevTools } from '@/lib/tauri-utils'
import { useSSHConnection } from '@/hooks/useSSHConnection'
import { toast } from 'sonner'
import { useState } from 'react'
import type { SSHConfig } from '@/types/printer'

export default function SettingsPage() {
  const { sshConfig, setSshConfig, connectionStatus } = usePrinterStore()
  const { connectWithRetry, disconnect, isConnecting } = useSSHConnection()

  const [formData, setFormData] = useState<SSHConfig>(
    sshConfig || {
      host: 'sunfire.comp.nus.edu.sg',
      port: 22,
      username: '',
      auth_type: { type: 'Password', password: '' },
    }
  )

  const handleOpenDevTools = async () => {
    const success = await safeOpenDevTools()
    if (success) {
      toast.success('Developer Tools opened')
    } else {
      toast.info('Developer Tools not available. Use browser DevTools (F12) instead.')
    }
  }

  const handleTestConnection = async () => {
    if (!formData.username || (formData.auth_type.type === 'Password' && !formData.auth_type.password)) {
      toast.error('Please fill in all fields')
      return
    }

    const result = await connectWithRetry(formData)
    if (result.success) {
      setSshConfig(formData)
      toast.success('Connection successful!')
    } else {
      toast.error(result.error || 'Connection failed')
    }
  }

  const handleDisconnect = () => {
    disconnect()
    toast.info('Disconnected')
  }

  const handleInputChange = (field: string, value: string | number) => {
    if (field === 'username' || field === 'host') {
      setFormData({ ...formData, [field]: value })
    } else if (field === 'port') {
      setFormData({ ...formData, port: Number(value) })
    } else if (field === 'password' && formData.auth_type.type === 'Password') {
      setFormData({
        ...formData,
        auth_type: { type: 'Password', password: value as string },
      })
    }
  }

  return (
    <div className="h-full overflow-auto">
      {/* Content */}
      <div className="max-w-3xl mx-auto p-8">
        <div className="space-y-8">
          <PageHeader
            title="Settings"
            description="Application preferences and connection information"
            icon={<Settings className="w-8 h-8" />}
          />

          {/* Connection Settings */}
          <section>
            <h2 className="text-xl font-semibold mb-4">SSH Connection</h2>
            <div className="space-y-4">
              {/* Current Status */}
              <div className="p-4 border border-border rounded-lg bg-muted/30">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Current Status</span>
                  <div className="flex items-center gap-2">
                    {connectionStatus.type === 'connected' && (
                      <Button
                        onClick={handleDisconnect}
                        variant="outline"
                        size="sm"
                      >
                        Disconnect
                      </Button>
                    )}
                  </div>
                </div>
                {connectionStatus.type === 'connecting' && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    Retry {connectionStatus.attempt}/{connectionStatus.maxAttempts} •
                    Elapsed: {connectionStatus.elapsedSeconds}s
                  </div>
                )}
              </div>

              {/* SSH Configuration Form */}
              <div className="p-4 border border-border rounded-lg bg-muted/30 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="host">Host</Label>
                  <Input
                    id="host"
                    type="text"
                    value={formData.host}
                    onChange={(e) => handleInputChange('host', e.target.value)}
                    placeholder="sunfire.comp.nus.edu.sg"
                    disabled={isConnecting || connectionStatus.type === 'connected'}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="port">Port</Label>
                  <Input
                    id="port"
                    type="number"
                    value={formData.port}
                    onChange={(e) => handleInputChange('port', e.target.value)}
                    placeholder="22"
                    disabled={isConnecting || connectionStatus.type === 'connected'}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="username">Username</Label>
                  <Input
                    id="username"
                    type="text"
                    value={formData.username}
                    onChange={(e) => handleInputChange('username', e.target.value)}
                    placeholder="Your NUS username"
                    disabled={isConnecting || connectionStatus.type === 'connected'}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={formData.auth_type.type === 'Password' ? formData.auth_type.password : ''}
                    onChange={(e) => handleInputChange('password', e.target.value)}
                    placeholder="Your NUS password"
                    disabled={isConnecting || connectionStatus.type === 'connected'}
                  />
                  <p className="text-xs text-muted-foreground">
                    Your password is only stored locally and never sent anywhere except to the SSH server
                  </p>
                </div>

                <Button
                  onClick={handleTestConnection}
                  disabled={isConnecting || connectionStatus.type === 'connected'}
                  className="w-full"
                >
                  <Wifi className="w-4 h-4 mr-2" />
                  {isConnecting ? 'Connecting...' : connectionStatus.type === 'connected' ? 'Connected' : 'Test Connection'}
                </Button>
              </div>
            </div>
          </section>

          {/* Print Settings */}
          <section>
            <h2 className="text-xl font-semibold mb-4">Print Settings</h2>
            <p className="text-sm text-muted-foreground">
              Print preferences will be available in future updates
            </p>
          </section>

          {/* Developer Tools */}
          <section>
            <h2 className="text-xl font-semibold mb-4">Developer Tools</h2>
            <div className="space-y-4">
              <div className="p-4 border border-border rounded-lg bg-muted/30">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <Terminal className="w-4 h-4" />
                      <span className="text-sm font-medium">Browser Console</span>
                    </div>
                    <p className="text-sm text-muted-foreground mb-3">
                      Open the developer console to view logs, errors, and debug information
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Keyboard shortcut: <kbd className="px-2 py-1 bg-muted border border-border rounded">Cmd/Ctrl+Shift+I</kbd> or <kbd className="px-2 py-1 bg-muted border border-border rounded">F12</kbd>
                    </p>
                  </div>
                  <Button
                    onClick={handleOpenDevTools}
                    variant="outline"
                    size="sm"
                    className="flex items-center gap-2"
                  >
                    <Terminal className="w-4 h-4" />
                    Open Console
                  </Button>
                </div>
              </div>
            </div>
          </section>

          {/* About */}
          <section className="pt-8 border-t border-border">
            <h2 className="text-xl font-semibold mb-4">About</h2>
            <div className="space-y-2 text-sm">
              <p>
                <strong>Print@SoC</strong> v0.1.0
              </p>
              <p className="text-muted-foreground">
                Smart printing for NUS School of Computing
              </p>
              <p className="text-muted-foreground">
                Built with Tauri, React, and Rust
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
