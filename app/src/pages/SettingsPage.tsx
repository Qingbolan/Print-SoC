import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Settings, LogOut, Printer, FolderOpen, Trash2, Terminal, Wifi, User, Shield, Info } from "lucide-react"
import { PageHeader } from "@/components/layout/PageHeader"
import { PageScaffold } from '@/components/layout/PageScaffold'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { usePrinterStore } from "@/store/printer-store"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { SimpleCard, SimpleCardHeader, SimpleCardTitle, SimpleCardContent } from '@/components/ui/simple-card'
import { safeOpenDevTools } from '@/lib/tauri-utils'
import { useSSHConnection } from '@/hooks/useSSHConnection'
import { toast } from 'sonner'
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

  const { connect, disconnect, isConnecting } = useSSHConnection()

  const [selectedTab, setSelectedTab] = useState<'account' | 'print' | 'connection' | 'advanced'>('account')
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

    const result = await connect(formData)
    if (result.success) {
      toast.success('Connection successful!')
    } else {
      toast.error(result.error || 'Connection failed')
    }
  }

  const handleDisconnect = async () => {
    const result = await disconnect()
    if (result.success) {
      toast.info('Disconnected')
    } else {
      toast.error(result.error || 'Failed to disconnect')
    }
  }

  const handleClearCredentials = () => {
    clearSavedCredentials()
    toast.success('Saved account cleared')
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
    <PageScaffold
      header={
        <PageHeader
          title="Settings"
          description="Manage your account, preferences, and connection settings"
          icon={<Settings />}
        />
      }
      contentWidth="wide"
    >
      <div className="mb-4 lg:hidden">
        <SegmentedControl
          ariaLabel="Settings category"
          value={selectedTab}
          onValueChange={setSelectedTab}
          mobileLayout="equal"
          items={[
            { value: 'account', label: 'Account', icon: User },
            { value: 'print', label: 'Print', icon: Printer },
            { value: 'connection', label: 'Connection', icon: Wifi },
            { value: 'advanced', label: 'Advanced', icon: Terminal },
          ]}
        />
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-4">
        <aside className="sticky top-0 hidden overflow-hidden rounded-md bg-[#0B3556] p-2 text-slate-200 lg:block">
          <div className="px-3 pb-3 pt-2 text-xs font-semibold uppercase text-slate-400">Preferences</div>
          {([
            { value: 'account', label: 'Account', icon: User },
            { value: 'print', label: 'Print defaults', icon: Printer },
            { value: 'connection', label: 'Connection', icon: Wifi },
            { value: 'advanced', label: 'Advanced', icon: Terminal },
          ] as const).map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => setSelectedTab(value)}
              className={`relative flex h-10 w-full items-center gap-3 rounded-md px-3 text-sm transition-colors ${selectedTab === value ? 'bg-white/10 text-white' : 'hover:bg-white/7 hover:text-white'}`}
            >
              <Icon className="size-4" />
              <span>{label}</span>
            </button>
          ))}
        </aside>
        <div className="min-w-0 space-y-4 lg:col-span-3">
          {selectedTab === 'account' && (
            <>
              {!sshConfig && !savedCredentials && (
                <SimpleCard variant="default">
                  <SimpleCardHeader>
                    <SimpleCardTitle className="flex items-center gap-2">
                      <Shield className="size-5 text-primary" />
                      No account connected
                    </SimpleCardTitle>
                  </SimpleCardHeader>
                  <SimpleCardContent>
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-sm text-muted-foreground">
                        Connect your NUS SoC account to load printers and submit jobs.
                      </p>
                      <Button size="sm" onClick={() => setSelectedTab('connection')}>
                        Connection settings
                      </Button>
                    </div>
                  </SimpleCardContent>
                </SimpleCard>
              )}
              {/* Current User Info */}
              {sshConfig && (
                <SimpleCard variant="default">
                  <SimpleCardHeader>
                    <SimpleCardTitle className="flex items-center gap-2">
                      <User className="w-5 h-5 text-primary" />
                      Current Session
                    </SimpleCardTitle>
                  </SimpleCardHeader>
                  <SimpleCardContent>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="font-medium">{sshConfig.username}</div>
                        <div className="text-sm text-muted-foreground">{sshConfig.host}</div>
                      </div>
                      {connectionStatus.type === 'connected' && (
                        <Badge variant="outline" className="bg-success/10 text-success">
                          Connected
                        </Badge>
                      )}
                    </div>
                  </SimpleCardContent>
                </SimpleCard>
              )}

              {/* Saved account settings */}
              {savedCredentials && (
                <SimpleCard variant="default">
                  <SimpleCardHeader>
                    <SimpleCardTitle className="flex items-center gap-2">
                      <Shield className="w-5 h-5 text-primary" />
                      Saved Account
                    </SimpleCardTitle>
                  </SimpleCardHeader>
                  <SimpleCardContent className="space-y-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
		                        <div className="font-medium">Account Remembered</div>
		                        <div className="text-sm text-muted-foreground">
		                          Server: {savedCredentials.serverType.toUpperCase()} • User: {savedCredentials.username}
		                        </div>
                      </div>
                      <Badge variant="outline" className="bg-success/10 text-success">
                        Active
                      </Badge>
                    </div>
                    <Button
                      onClick={handleClearCredentials}
                      variant="outline"
                      size="sm"
                      className="w-full"
	                    >
		                      Clear Saved Account
	                    </Button>
                  </SimpleCardContent>
                </SimpleCard>
              )}

              {/* Logout */}
              {(sshConfig || savedCredentials) && <SimpleCard variant="default">
                <SimpleCardHeader>
                  <SimpleCardTitle className="flex items-center gap-2">
                    <LogOut className="w-5 h-5 text-destructive" />
                    Logout
                  </SimpleCardTitle>
                </SimpleCardHeader>
                <SimpleCardContent>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-sm text-muted-foreground">
                        Sign out and clear your session
                      </div>
                    </div>
                    <Button
                      onClick={() => setShowLogoutDialog(true)}
                      variant="destructive"
                      size="sm"
                    >
                      <LogOut className="w-4 h-4 mr-2" />
                      Logout
                    </Button>
                  </div>
                </SimpleCardContent>
              </SimpleCard>}
            </>
          )}

          {selectedTab === 'print' && (
            <>
              {/* Default Printer */}
              <SimpleCard variant="default">
                <SimpleCardHeader>
                  <SimpleCardTitle className="flex items-center gap-2">
                    <Printer className="w-5 h-5 text-primary" />
                    Default Printer
                  </SimpleCardTitle>
                </SimpleCardHeader>
                <SimpleCardContent className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Select a printer to use by default for new print jobs
                  </p>
                  <Select
                    value={settings.defaultPrinter || undefined}
                    onValueChange={handleDefaultPrinterChange}
                  >
                    <SelectTrigger>
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
                    <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
                      <span className="text-sm text-muted-foreground">
                        Current: {allPrinters.find(p => p.queue_name === settings.defaultPrinter)?.name || 'Unknown'}
                      </span>
                      <Button
                        onClick={() => {
                          setSettings({ defaultPrinter: null })
                          toast.success('Default printer cleared')
                        }}
                        variant="ghost"
                        size="sm"
                      >
                        Clear
                      </Button>
                    </div>
                  )}
                </SimpleCardContent>
              </SimpleCard>

              {/* Cache Settings */}
              <SimpleCard variant="default">
                <SimpleCardHeader>
                  <SimpleCardTitle className="flex items-center gap-2">
                    <FolderOpen className="w-5 h-5 text-primary" />
                    Cache & Storage
                  </SimpleCardTitle>
                </SimpleCardHeader>
                <SimpleCardContent className="space-y-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="font-medium">Auto-clear Cache</div>
                      <div className="text-sm text-muted-foreground">
                        Automatically clear cached files after printing
                      </div>
                    </div>
                    <Switch
                      checked={settings.autoClearCache}
                      onCheckedChange={handleAutoClearCacheChange}
                    />
                  </div>
                </SimpleCardContent>
              </SimpleCard>

              {/* Print History */}
              <SimpleCard variant="default">
                <SimpleCardHeader>
                  <SimpleCardTitle className="flex items-center gap-2">
                    <Trash2 className="w-5 h-5 text-primary" />
                    Print History
                  </SimpleCardTitle>
                </SimpleCardHeader>
                <SimpleCardContent>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="font-medium">{printJobs.length} job{printJobs.length !== 1 ? 's' : ''}</div>
                      <div className="text-sm text-muted-foreground">
                        Clear all print history records
                      </div>
                    </div>
                    <Button
                      onClick={() => setShowClearHistoryDialog(true)}
                      variant="outline"
                      size="sm"
                      disabled={printJobs.length === 0}
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Clear History
                    </Button>
                  </div>
                </SimpleCardContent>
              </SimpleCard>
            </>
          )}

          {selectedTab === 'connection' && (
            <>
              {/* Connection Status */}
              <SimpleCard variant="default">
                <SimpleCardHeader>
                  <SimpleCardTitle className="flex items-center gap-2">
                    <Wifi className="w-5 h-5 text-primary" />
                    Connection Status
                  </SimpleCardTitle>
                </SimpleCardHeader>
                <SimpleCardContent>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="font-medium">
                        {connectionStatus.type === 'connected' ? 'Connected' :
                         connectionStatus.type === 'connecting' ? 'Connecting...' : 'Disconnected'}
                      </div>
                      {connectionStatus.type === 'connecting' && (
                        <div className="text-sm text-muted-foreground">
                          Elapsed: {connectionStatus.elapsedSeconds}s
                        </div>
                      )}
                    </div>
                    {connectionStatus.type === 'connected' && (
                      <Button onClick={handleDisconnect} variant="outline" size="sm">
                        Disconnect
                      </Button>
                    )}
                  </div>
                </SimpleCardContent>
              </SimpleCard>

              {/* SSH Configuration */}
              <SimpleCard variant="default">
                <SimpleCardHeader>
                  <SimpleCardTitle className="flex items-center gap-2">
                    <Terminal className="w-5 h-5 text-primary" />
                    SSH Configuration
                  </SimpleCardTitle>
                </SimpleCardHeader>
                <SimpleCardContent className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div className="space-y-2 sm:col-span-2">
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
	                      Your password is used only for this SSH connection and is not stored by Print@SoC.
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
                </SimpleCardContent>
              </SimpleCard>
            </>
          )}

          {selectedTab === 'advanced' && (
            <>
              {/* Developer Tools */}
              <SimpleCard variant="default">
                <SimpleCardHeader>
                  <SimpleCardTitle className="flex items-center gap-2">
                    <Terminal className="w-5 h-5 text-primary" />
                    Developer Tools
                  </SimpleCardTitle>
                </SimpleCardHeader>
                <SimpleCardContent className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Open the developer console to view logs, errors, and debug information
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Keyboard shortcut: <kbd className="px-2 py-1 bg-muted border border-border rounded">Cmd/Ctrl+Shift+I</kbd> or <kbd className="px-2 py-1 bg-muted border border-border rounded">F12</kbd>
                  </p>
                  <Button
                    onClick={handleOpenDevTools}
                    variant="outline"
                    className="w-full"
                  >
                    <Terminal className="w-4 h-4 mr-2" />
                    Open Console
                  </Button>
                </SimpleCardContent>
              </SimpleCard>

              {/* About */}
              <SimpleCard variant="default">
                <SimpleCardHeader>
                  <SimpleCardTitle className="flex items-center gap-2">
                    <Info className="w-5 h-5 text-primary" />
                    About
                  </SimpleCardTitle>
                </SimpleCardHeader>
                <SimpleCardContent className="space-y-2">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <span className="font-medium">Print@SoC</span>
                    <Badge variant="secondary">v0.1.0</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Smart printing solution for NUS School of Computing
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Built with Tauri, React, and Rust
                  </p>
                </SimpleCardContent>
              </SimpleCard>
            </>
          )}
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
              Are you sure you want to clear all print history? This action cannot be undone.
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
    </PageScaffold>
  )
}
