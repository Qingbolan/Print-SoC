import { Settings, LogOut, Printer, FolderOpen, Trash2, Terminal, Wifi, User } from "lucide-react"
import { PageHeader } from "@/components/PageHeader"
import { usePrinterStore } from "@/store/printer-store"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { safeOpenDevTools } from '@/lib/tauri-utils'
import { useSSHConnection } from '@/hooks/useSSHConnection'
import { toast } from 'sonner'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { SSHConfig } from '@/types/printer'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectLabel,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

export default function SettingsPage() {
  const navigate = useNavigate()
  const {
    sshConfig,
    setSshConfig,
    connectionStatus,
    savedCredentials,
    clearSavedCredentials,
    settings,
    setSettings,
    printerGroups,
    printJobs,
    clearAllJobs,
    logout,
  } = usePrinterStore()

  const { connectWithRetry, disconnect, isConnecting } = useSSHConnection()

  const [formData, setFormData] = useState<SSHConfig>(
    sshConfig || {
      host: 'sunfire.comp.nus.edu.sg',
      port: 22,
      username: '',
      auth_type: { type: 'Password', password: '' },
    }
  )

  const [showLogoutDialog, setShowLogoutDialog] = useState(false)
  const [showClearHistoryDialog, setShowClearHistoryDialog] = useState(false)

  // Get all printers from groups
  const allPrinters = printerGroups.flatMap(g => g.printers)

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

  const handleClearCredentials = () => {
    clearSavedCredentials()
    toast.success('Auto-login credentials cleared')
  }

  const handleLogout = () => {
    logout()
    setShowLogoutDialog(false)
    toast.success('Logged out successfully')
    navigate('/login')
  }

  const handleClearHistory = () => {
    clearAllJobs()
    setShowClearHistoryDialog(false)
    toast.success('Print history cleared')
  }

  const handleDefaultPrinterChange = (printerQueueName: string) => {
    setSettings({ defaultPrinter: printerQueueName })
    toast.success('Default printer updated')
  }

  const handleAutoClearCacheChange = (checked: boolean) => {
    setSettings({ autoClearCache: checked })
    toast.success(checked ? 'Auto-clear cache enabled' : 'Auto-clear cache disabled')
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
            description="Manage your account, preferences, and connection settings"
            icon={<Settings className="w-8 h-8" />}
          />

          {/* Account Section */}
          <section>
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
              <User className="w-5 h-5" />
              Account
            </h2>
            <div className="space-y-4">
              {/* Current User Info */}
              {sshConfig && (
                <div className="p-4 border border-border rounded-lg bg-muted/30">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-medium text-foreground">Logged in as</div>
                        <div className="text-sm text-muted-foreground mt-1">
                          {sshConfig.username}@{sshConfig.host}
                        </div>
                      </div>
                      {connectionStatus.type === 'connected' && (
                        <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">
                          Connected
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Auto-login Settings */}
              {savedCredentials && (
                <div className="p-4 border border-border rounded-lg bg-muted/30">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-sm font-medium text-foreground">Auto-login Enabled</h3>
                        <p className="text-xs text-muted-foreground mt-1">
                          Server: {savedCredentials.serverType.toUpperCase()} • Username: {savedCredentials.username}
                        </p>
                      </div>
                      <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">
                        Active
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      You will be automatically logged in when you open the app.
                    </p>
                    <Button
                      onClick={handleClearCredentials}
                      variant="outline"
                      size="sm"
                      className="w-full"
                    >
                      Clear Auto-login
                    </Button>
                  </div>
                </div>
              )}

              {/* Logout Button */}
              <div className="p-4 border border-border rounded-lg bg-muted/30">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-medium text-foreground">Logout</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      Sign out and clear your session
                    </p>
                  </div>
                  <Button
                    onClick={() => setShowLogoutDialog(true)}
                    variant="destructive"
                    size="sm"
                    className="flex items-center gap-2"
                  >
                    <LogOut className="w-4 h-4" />
                    Logout
                  </Button>
                </div>
              </div>
            </div>
          </section>

          {/* Print Settings */}
          <section>
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
              <Printer className="w-5 h-5" />
              Print Settings
            </h2>
            <div className="space-y-4">
              {/* Default Printer */}
              <div className="p-4 border border-border rounded-lg bg-muted/30">
                <div className="space-y-3">
                  <div>
                    <Label htmlFor="default-printer" className="text-sm font-medium">
                      Default Printer
                    </Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      Select a printer to use by default
                    </p>
                  </div>
                  <Select
                    value={settings.defaultPrinter || undefined}
                    onValueChange={handleDefaultPrinterChange}
                  >
                    <SelectTrigger id="default-printer">
                      <SelectValue placeholder="No default printer set" />
                    </SelectTrigger>
                    <SelectContent>
                      {printerGroups.map((group) => (
                        <SelectGroup key={group.id}>
                          <SelectLabel>{group.display_name}</SelectLabel>
                          {group.printers.map((printer) => (
                            <SelectItem key={printer.queue_name} value={printer.queue_name}>
                              {printer.name} {printer.variant && `(${printer.variant})`}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ))}
                    </SelectContent>
                  </Select>
                  {settings.defaultPrinter && (
                    <div className="flex items-center justify-between pt-2">
                      <span className="text-xs text-muted-foreground">
                        Current: {allPrinters.find(p => p.queue_name === settings.defaultPrinter)?.name || 'Unknown'}
                      </span>
                      <Button
                        onClick={() => {
                          setSettings({ defaultPrinter: null })
                          toast.success('Default printer cleared')
                        }}
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                      >
                        Clear
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* Cache & Storage */}
          <section>
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
              <FolderOpen className="w-5 h-5" />
              Cache & Storage
            </h2>
            <div className="space-y-4">
              {/* Cache Location */}
              <div className="p-4 border border-border rounded-lg bg-muted/30">
                <div className="space-y-3">
                  <div>
                    <Label className="text-sm font-medium">Cache Location</Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      {settings.cacheLocation || 'Using default system location'}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    disabled
                  >
                    <FolderOpen className="w-4 h-4 mr-2" />
                    Change Location (Coming Soon)
                  </Button>
                </div>
              </div>

              {/* Auto-clear Cache */}
              <div className="p-4 border border-border rounded-lg bg-muted/30">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <Label className="text-sm font-medium">Auto-clear Cache</Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      Automatically clear cached files after printing
                    </p>
                  </div>
                  <Switch
                    checked={settings.autoClearCache}
                    onCheckedChange={handleAutoClearCacheChange}
                  />
                </div>
              </div>

              {/* Clear Print History */}
              <div className="p-4 border border-border rounded-lg bg-muted/30">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <Label className="text-sm font-medium">Print History</Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      {printJobs.length} job{printJobs.length !== 1 ? 's' : ''} in history
                    </p>
                  </div>
                  <Button
                    onClick={() => setShowClearHistoryDialog(true)}
                    variant="outline"
                    size="sm"
                    disabled={printJobs.length === 0}
                    className="flex items-center gap-2"
                  >
                    <Trash2 className="w-4 h-4" />
                    Clear History
                  </Button>
                </div>
              </div>
            </div>
          </section>

          {/* Connection Settings */}
          <section>
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
              <Wifi className="w-5 h-5" />
              SSH Connection
            </h2>
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

          {/* Developer Tools */}
          <section>
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
              <Terminal className="w-5 h-5" />
              Developer Tools
            </h2>
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
                Smart printing solution for NUS School of Computing
              </p>
              <p className="text-muted-foreground">
                Built with Tauri, React, and Rust
              </p>
            </div>
          </section>
        </div>
      </div>

      {/* Logout Confirmation Dialog */}
      <AlertDialog open={showLogoutDialog} onOpenChange={setShowLogoutDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Logout</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to logout? This will clear your session and disconnect from the server.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleLogout}>
              Logout
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Clear History Confirmation Dialog */}
      <AlertDialog open={showClearHistoryDialog} onOpenChange={setShowClearHistoryDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear Print History</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to clear all print history? This action cannot be undone. This will delete {printJobs.length} job{printJobs.length !== 1 ? 's' : ''}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleClearHistory}>
              Clear History
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
