import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { PageHeader } from '@/components/layout/PageHeader'
import { PageScaffold } from '@/components/layout/PageScaffold'
import {
  SimpleCard,
  SimpleCardContent,
  SimpleCardHeader,
  SimpleCardTitle,
} from '@/components/ui/simple-card'
import { Circle, Play, Plug, Terminal, Trash2 } from 'lucide-react'
import type { PrintQuota } from '@/types/printer'

interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

export default function DebugPage() {
  const [host, setHost] = useState('stu.comp.nus.edu.sg')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [command, setCommand] = useState('echo "Hello from SSH"')
  const [output, setOutput] = useState('')
  const [isConnected, setIsConnected] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const log = (msg: string) => {
    setOutput(prev => prev + '\n' + msg)
  }

  const getConfig = () => ({
    host,
    port: 22,
    username,
    auth_type: { type: 'Password', password }
  })

  const handleConnect = async () => {
    setIsLoading(true)
    setOutput('Connecting...')
    try {
      const result = await invoke<ApiResponse<string>>('ssh_connect', { config: getConfig() })
      if (result.success) {
        log(`SUCCESS: ${result.data}`)
        setIsConnected(true)
      } else {
        log(`ERROR: ${result.error}`)
      }
    } catch (e) {
      log(`EXCEPTION: ${e}`)
    }
    setIsLoading(false)
  }

  const handleDisconnect = async () => {
    try {
      const result = await invoke<ApiResponse<string>>('ssh_disconnect')
      log(result.success ? 'Disconnected' : `Error: ${result.error}`)
      setIsConnected(false)
    } catch (e) {
      log(`EXCEPTION: ${e}`)
    }
  }

  const handleRunCommand = async () => {
    if (!command.trim()) return
    setIsLoading(true)
    log(`\n> ${command}`)
    try {
      const result = await invoke<ApiResponse<string>>('ssh_debug_command', { command })
      if (result.success) {
        log(result.data || '(no output)')
      } else {
        log(`ERROR: ${result.error}`)
      }
    } catch (e) {
      log(`EXCEPTION: ${e}`)
    }
    setIsLoading(false)
  }

  const handleTestPrint = async () => {
    const printer = prompt('Enter printer queue (e.g., psts-dx, psts-sx):')
    if (!printer) return

    setIsLoading(true)
    log('\n=== Testing Print Flow ===')

    // Step 1: Create test file
    log('1. Creating test file on server...')
    const createFileCmd = `echo "Test print from Print@SoC $(date)" > /tmp/test_print.txt`
    try {
      let result = await invoke<ApiResponse<string>>('ssh_debug_command', { command: createFileCmd })
      if (!result.success) {
        log(`ERROR: ${result.error}`)
        setIsLoading(false)
        return
      }
      log('   File created: /tmp/test_print.txt')

      // Step 2: Check file exists
      log('2. Verifying file...')
      result = await invoke<ApiResponse<string>>('ssh_debug_command', { command: 'cat /tmp/test_print.txt' })
      if (result.success) {
        log(`   Content: ${result.data}`)
      } else {
        log(`ERROR: ${result.error}`)
        setIsLoading(false)
        return
      }

      // Step 3: Try lpr command
      log(`3. Submitting to printer: ${printer}`)
      const lprCmd = `lpr -P ${printer} /tmp/test_print.txt`
      log(`   Command: ${lprCmd}`)
      result = await invoke<ApiResponse<string>>('ssh_debug_command', { command: lprCmd })
      if (result.success) {
        log('   SUCCESS! Job submitted.')
      } else {
        log(`   ERROR: ${result.error}`)
      }

      // Step 4: Check queue
      log('4. Checking queue...')
      result = await invoke<ApiResponse<string>>('ssh_debug_command', { command: `lpq -P ${printer}` })
      log(result.success ? result.data || '(empty)' : `ERROR: ${result.error}`)

    } catch (e) {
      log(`EXCEPTION: ${e}`)
    }
    setIsLoading(false)
  }

  const handleCheckQueues = async () => {
    setIsLoading(true)
    log('\n=== Available Print Queues ===')
    try {
      const result = await invoke<ApiResponse<string[]>>('print_list_queues', { sshConfig: getConfig() })
      log(result.success ? (result.data || []).join('\n') || '(no queues)' : `ERROR: ${result.error}`)
    } catch (e) {
      log(`EXCEPTION: ${e}`)
    }
    setIsLoading(false)
  }

  const handleCheckQuota = async () => {
    setIsLoading(true)
    log('\n=== Print Quota ===')
    try {
      const result = await invoke<ApiResponse<PrintQuota>>('print_get_quota', { sshConfig: getConfig() })
      if (result.success && result.data) {
        log(result.data.raw_output || JSON.stringify(result.data, null, 2))
      } else {
        log(`ERROR: ${result.error}`)
      }
    } catch (e) {
      log(`EXCEPTION: ${e}`)
    }
    setIsLoading(false)
  }

  return (
    <PageScaffold
      header={
        <PageHeader
          title="SSH Debug Console"
          description="Test SSH connection and commands directly"
          icon={<Terminal />}
          actions={
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Circle
                className={isConnected ? 'size-3 fill-success text-success' : 'size-3 fill-muted-foreground/35 text-muted-foreground/35'}
              />
              {isConnected ? 'Connected' : 'Not connected'}
            </div>
          }
        />
      }
      contentWidth="reading"
    >
      <div className="space-y-4">
        <SimpleCard>
          <SimpleCardHeader>
            <SimpleCardTitle className="flex items-center gap-2">
              <Plug className="size-4 text-primary" />
              SSH Connection
            </SimpleCardTitle>
          </SimpleCardHeader>
          <SimpleCardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Host</Label>
              <Input value={host} onChange={e => setHost(e.target.value)} disabled={isConnected} />
            </div>
            <div className="space-y-2">
              <Label>Username</Label>
              <Input value={username} onChange={e => setUsername(e.target.value)} disabled={isConnected} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Password</Label>
            <Input type="password" value={password} onChange={e => setPassword(e.target.value)} disabled={isConnected} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={handleConnect} disabled={isLoading || isConnected}>
              Connect
            </Button>
            <Button onClick={handleDisconnect} disabled={isLoading || !isConnected} variant="outline">
              Disconnect
            </Button>
          </div>
          </SimpleCardContent>
        </SimpleCard>

        <SimpleCard>
          <SimpleCardHeader>
            <SimpleCardTitle className="flex items-center gap-2">
              <Play className="size-4 text-primary" />
              Run Command
            </SimpleCardTitle>
          </SimpleCardHeader>
          <SimpleCardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={command}
              onChange={e => setCommand(e.target.value)}
              placeholder="Enter command..."
              onKeyDown={e => e.key === 'Enter' && handleRunCommand()}
              className="flex-1"
            />
            <Button onClick={handleRunCommand} disabled={isLoading || !isConnected}>
              Run
            </Button>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={() => setCommand('whoami')}>whoami</Button>
            <Button size="sm" variant="outline" onClick={() => setCommand('pwd')}>pwd</Button>
            <Button size="sm" variant="outline" onClick={() => setCommand('ls -la /tmp/')}>ls /tmp</Button>
            <Button size="sm" variant="outline" onClick={handleCheckQueues} disabled={!isConnected}>List Queues</Button>
            <Button size="sm" variant="outline" onClick={handleCheckQuota} disabled={!isConnected}>Check Quota</Button>
            <Button size="sm" variant="outline" onClick={handleTestPrint} disabled={!isConnected}>Test Print</Button>
          </div>
          </SimpleCardContent>
        </SimpleCard>

        <SimpleCard>
          <SimpleCardHeader className="flex flex-row items-center justify-between space-y-0">
            <SimpleCardTitle className="flex items-center gap-2">
              <Terminal className="size-4 text-primary" />
              Output
            </SimpleCardTitle>
            <Button size="icon" variant="ghost" onClick={() => setOutput('')} aria-label="Clear output">
              <Trash2 />
            </Button>
          </SimpleCardHeader>
          <SimpleCardContent>
          <Textarea
            value={output}
            readOnly
            className="h-80 resize-none bg-[#101820] font-mono text-sm text-[#B7E4C7]"
          />
          </SimpleCardContent>
        </SimpleCard>
      </div>
    </PageScaffold>
  )
}
