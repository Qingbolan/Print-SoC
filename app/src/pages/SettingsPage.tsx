import { version as appVersion } from '../../package.json'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Check,
  CircleAlert,
  Copy,
  FolderOpen,
  Info,
  LoaderCircle,
  LogOut,
  Plug,
  Printer,
  RefreshCw,
  ServerCog,
  Settings,
  Shield,
  Terminal,
  Trash2,
  User,
  Wifi,
} from 'lucide-react'
import { PageHeader } from "@/components/layout/PageHeader"
import { PageScaffold } from '@/components/layout/PageScaffold'
import { SectionNav } from '@/components/layout/SectionNav'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { usePrinterStore } from "@/store/printer-store"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { SimpleCard, SimpleCardHeader, SimpleCardTitle, SimpleCardContent } from '@/components/ui/simple-card'
import { safeInvoke, safeOpenDevTools } from '@/lib/tauri-utils'
import { useSSHConnection } from '@/hooks/useSSHConnection'
import { toast } from 'sonner'
import type { SSHConfig } from '@/types/printer'
import type { IntegrationStatus } from '@/types/integrations'
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

type SettingsSection = 'account' | 'print' | 'connection' | 'advanced'

const settingsSections = [
  { value: 'account', label: 'Account', icon: User },
  { value: 'print', label: 'Print defaults', mobileLabel: 'Print', icon: Printer },
  { value: 'connection', label: 'Connection', icon: Wifi },
  { value: 'advanced', label: 'Advanced', icon: Terminal },
] as const

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

async function writeClipboard(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value)
    return
  } catch {
    const input = document.createElement('textarea')
    input.value = value
    input.setAttribute('readonly', '')
    input.style.position = 'fixed'
    input.style.opacity = '0'
    document.body.appendChild(input)
    input.select()
    const copied = document.execCommand('copy')
    input.remove()
    if (!copied) throw new Error('Clipboard access denied')
  }
}

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

  const [selectedTab, setSelectedTab] = useState<SettingsSection>('account')
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
  const [integrationStatus, setIntegrationStatus] = useState<IntegrationStatus | null>(null)
  const [integrationLoading, setIntegrationLoading] = useState(false)
  const [integrationChecked, setIntegrationChecked] = useState(false)
  const [integrationError, setIntegrationError] = useState<string | null>(null)
  const [mcpTesting, setMcpTesting] = useState(false)

  const loadIntegrationStatus = useCallback(async (announce = false) => {
    setIntegrationLoading(true)
    setIntegrationError(null)
    const result = await safeInvoke('integration_get_status')
    setIntegrationLoading(false)
    setIntegrationChecked(true)

    if (result.success && result.data) {
      setIntegrationStatus(result.data)
      if (announce) toast.success('Integration status refreshed')
      return
    }

    const error = result.error || 'Unable to inspect system integrations'
    setIntegrationError(error)
    toast.error(error)
  }, [])

  useEffect(() => {
    if (selectedTab === 'advanced' && !integrationChecked && !integrationLoading) {
      void loadIntegrationStatus()
    }
  }, [integrationChecked, integrationLoading, loadIntegrationStatus, selectedTab])

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

  const handleTestMcp = async () => {
    setMcpTesting(true)
    const result = await safeInvoke('integration_test_mcp')
    setMcpTesting(false)

    if (result.success) {
      toast.success(result.data || 'MCP handshake succeeded')
    } else {
      toast.error(result.error || 'MCP health check failed')
    }
  }

  const copyIntegrationText = async (value: string, label: string) => {
    try {
      await writeClipboard(value)
      toast.success(`${label} copied`)
    } catch {
      toast.error(`Unable to copy ${label.toLowerCase()}`)
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

  const virtualPrinterReady = Boolean(
    integrationStatus?.virtual_printer.registered
      && integrationStatus.virtual_printer.backend_installed
      && integrationStatus.virtual_printer.configured
  )
  const serverType = savedCredentials?.serverType || (formData.host.includes('stf') ? 'stf' : 'stu')
  const integrationUsername = savedCredentials?.username || formData.username
  const cliCommand = integrationStatus?.cli.command || 'print-soc'
  const setupCommand = [
    shellQuote(cliCommand),
    '--install-virtual-printer',
    '--server',
    serverType,
    ...(integrationUsername ? ['--username', shellQuote(integrationUsername)] : []),
    '--ask-password',
    '--printer',
    shellQuote(settings.defaultPrinter || 'psts-dx'),
  ].join(' ')
  const removeCommand = `${shellQuote(cliCommand)} --uninstall-virtual-printer`
  const mcpClientConfig = JSON.stringify({
    mcpServers: {
      'print-soc': {
        command: integrationStatus?.mcp_server.command || 'print-soc',
        args: ['mcp'],
      },
    },
  }, null, 2)

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
          items={settingsSections.map((item) => ({
            ...item,
            label: 'mobileLabel' in item ? item.mobileLabel : item.label,
          }))}
        />
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-4">
        <SectionNav
          label="Preferences"
          value={selectedTab}
          items={settingsSections}
          onValueChange={(value) => setSelectedTab(value as SettingsSection)}
        />
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
                    <SelectTrigger className="w-full sm:w-auto">
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
                    <div className="flex items-center justify-between gap-3 pt-2">
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
                  <div className="flex items-center justify-between gap-3">
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
                  <div className="flex items-center justify-between gap-3">
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
              <SimpleCard variant="ghost">
                <SimpleCardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                  <div className="min-w-0">
                    <SimpleCardTitle className="flex items-center gap-2">
                      <ServerCog className="size-5 text-primary" />
                      System integrations
                    </SimpleCardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Inspect the local print bridge and service registration.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    title="Refresh integration status"
                    aria-label="Refresh integration status"
                    disabled={integrationLoading}
                    onClick={() => void loadIntegrationStatus(true)}
                  >
                    <RefreshCw className={integrationLoading ? 'animate-spin' : ''} />
                  </Button>
                </SimpleCardHeader>
                <SimpleCardContent className="space-y-3" aria-live="polite">
                  {integrationError && (
                    <div className="flex items-start gap-2 rounded-md bg-warning/10 p-3 text-sm text-warning-foreground">
                      <CircleAlert className="mt-0.5 size-4 shrink-0" />
                      <p>{integrationError}</p>
                    </div>
                  )}
                  <section className="rounded-md bg-muted/55 p-4">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Printer className="size-4 text-muted-foreground" />
                          <h4 className="font-medium">System virtual printer</h4>
                          {!integrationStatus ? (
                            <Badge variant="secondary">Inspecting</Badge>
                          ) : !integrationStatus.virtual_printer.supported ? (
                            <Badge variant="warning">Unsupported</Badge>
                          ) : virtualPrinterReady ? (
                            <Badge variant="success"><Check /> Ready</Badge>
                          ) : (
                            <Badge variant="warning"><CircleAlert /> Action needed</Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {integrationStatus?.virtual_printer.detail || 'Checking the CUPS queue, backend, and forwarding configuration.'}
                        </p>
                        {integrationStatus && (
                          <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
                            <span className="inline-flex items-center gap-1.5">
                              {integrationStatus.virtual_printer.registered ? <Check className="text-success" /> : <CircleAlert />}
                              Queue
                            </span>
                            <span className="inline-flex items-center gap-1.5">
                              {integrationStatus.virtual_printer.backend_installed ? <Check className="text-success" /> : <CircleAlert />}
                              Backend
                            </span>
                            <span className="inline-flex items-center gap-1.5">
                              {integrationStatus.virtual_printer.configured ? <Check className="text-success" /> : <CircleAlert />}
                              Config
                            </span>
                            <span>CLI: {integrationStatus.cli.available ? 'Detected' : 'Not installed'}</span>
                          </div>
                        )}
                      </div>
                      {integrationStatus?.virtual_printer.supported && (
                        <div className="flex shrink-0 flex-col gap-2 sm:items-end">
                          {!integrationStatus.cli.available ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              onClick={() => void copyIntegrationText('python3 -m pip install --user --upgrade print-at-soc', 'CLI install command')}
                            >
                              <Copy />
                              Copy CLI install
                            </Button>
                          ) : !integrationUsername ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              onClick={() => setSelectedTab('connection')}
                            >
                              <User />
                              Add account details
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              onClick={() => void copyIntegrationText(setupCommand, virtualPrinterReady ? 'Repair command' : 'Setup command')}
                            >
                              <Copy />
                              {virtualPrinterReady ? 'Copy repair command' : 'Copy setup command'}
                            </Button>
                          )}
                          {virtualPrinterReady && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => void copyIntegrationText(removeCommand, 'Remove command')}
                            >
                              <Copy />
                              Copy remove command
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </section>

                  <section className="rounded-md bg-muted/55 p-4">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Plug className="size-4 text-muted-foreground" />
                          <h4 className="font-medium">MCP server and client plugin</h4>
                          {integrationStatus?.mcp_server.available && (
                            <Badge variant="success"><Check /> Bundled</Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {integrationStatus?.mcp_server.detail || 'Checking the bundled stdio service.'}
                        </p>
                        {integrationStatus && (
                          <p className="font-mono text-xs text-muted-foreground">
                            Protocol {integrationStatus.mcp_server.protocol_version} · stdio transport
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={!integrationStatus?.mcp_server.available || mcpTesting}
                          onClick={() => void handleTestMcp()}
                        >
                          {mcpTesting ? <LoaderCircle className="animate-spin" /> : <Plug />}
                          {mcpTesting ? 'Testing' : 'Test server'}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={!integrationStatus?.mcp_server.available}
                          onClick={() => void copyIntegrationText(mcpClientConfig, 'MCP client config')}
                        >
                          <Copy />
                          Copy config
                        </Button>
                      </div>
                    </div>
                  </section>

                  <section className="rounded-md bg-muted/55 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <ServerCog className="size-4 text-muted-foreground" />
                          <h4 className="font-medium">Application plugins</h4>
                        </div>
                        <p className="mt-2 text-sm text-muted-foreground">
                          Runtime capabilities loaded by the desktop application.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1.5 sm:justify-end">
                        {integrationStatus?.runtime.plugins.map((plugin) => (
                          <Badge key={plugin} variant="outline">{plugin}</Badge>
                        )) || <Badge variant="secondary">Inspecting</Badge>}
                      </div>
                    </div>
                  </section>
                </SimpleCardContent>
              </SimpleCard>

              <SimpleCard variant="default">
                <SimpleCardContent>
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Terminal className="size-5 text-primary" />
                        <h3 className="text-lg font-semibold leading-6">Developer tools</h3>
                        {integrationStatus && (
                          <Badge variant="secondary">
                            {integrationStatus.runtime.debug_build ? 'Debug build' : 'Release build'}
                          </Badge>
                        )}
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">
                        Inspect logs and runtime errors in debug builds.
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Shortcut: <kbd className="rounded bg-muted px-2 py-1">Cmd/Ctrl+Shift+I</kbd> or <kbd className="rounded bg-muted px-2 py-1">F12</kbd>
                      </p>
                    </div>
                  <Button
                    onClick={handleOpenDevTools}
                      variant="secondary"
                      size="sm"
                      disabled={Boolean(integrationStatus && !integrationStatus.runtime.devtools_available)}
                  >
                      <Terminal />
                      {integrationStatus && !integrationStatus.runtime.devtools_available
                        ? integrationStatus.runtime.debug_build ? 'Desktop app required' : 'Unavailable in release'
                        : 'Open console'}
                  </Button>
                  </div>
                </SimpleCardContent>
              </SimpleCard>

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
                    <Badge variant="secondary">v{appVersion}</Badge>
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
