import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { PageHeader } from '@/components/layout/PageHeader'
import { Terminal } from 'lucide-react'

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

  const handleConnect = async () => {
    setIsLoading(true)
    setOutput('Connecting...')
    try {
      const config = {
        host,
        port: 22,
        username,
        auth_type: { type: 'Password', password }
      }
      const result = await invoke<ApiResponse<string>>('ssh_connect', { config })
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
    const printer = prompt('Enter printer queue (e.g., psts, pstsb):')
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
      // Try to list available printers
      const result = await invoke<ApiResponse<string>>('ssh_debug_command', {
        command: 'lpstat -a 2>/dev/null | head -20 || echo "lpstat not available"'
      })
      log(result.success ? result.data || '(no output)' : `ERROR: ${result.error}`)
    } catch (e) {
      log(`EXCEPTION: ${e}`)
    }
    setIsLoading(false)
  }

  return (
    <div className="h-full overflow-auto p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <PageHeader
          title="SSH Debug Console"
          description="Test SSH connection and commands directly"
          icon={<Terminal className="w-8 h-8" />}
        />

        {/* Connection */}
        <div className="p-4 border rounded-lg space-y-4">
          <h2 className="font-semibold">1. SSH Connection</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Host</Label>
              <Input value={host} onChange={e => setHost(e.target.value)} disabled={isConnected} />
            </div>
            <div>
              <Label>Username</Label>
              <Input value={username} onChange={e => setUsername(e.target.value)} disabled={isConnected} />
            </div>
          </div>
          <div>
            <Label>Password</Label>
            <Input type="password" value={password} onChange={e => setPassword(e.target.value)} disabled={isConnected} />
          </div>
          <div className="flex gap-2">
            <Button onClick={handleConnect} disabled={isLoading || isConnected}>
              Connect
            </Button>
            <Button onClick={handleDisconnect} disabled={isLoading || !isConnected} variant="outline">
              Disconnect
            </Button>
            <span className={`ml-4 self-center ${isConnected ? 'text-success' : 'text-muted-foreground'}`}>
              {isConnected ? 'Connected' : 'Not connected'}
            </span>
          </div>
        </div>

        {/* Command */}
        <div className="p-4 border rounded-lg space-y-4">
          <h2 className="font-semibold">2. Run Command</h2>
          <div className="flex gap-2">
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
            <Button size="sm" variant="outline" onClick={handleTestPrint} disabled={!isConnected}>Test Print</Button>
          </div>
        </div>

        {/* Output */}
        <div className="p-4 border rounded-lg space-y-2">
          <div className="flex justify-between items-center">
            <h2 className="font-semibold">Output</h2>
            <Button size="sm" variant="ghost" onClick={() => setOutput('')}>Clear</Button>
          </div>
          <Textarea
            value={output}
            readOnly
            className="font-mono text-sm h-80 bg-black text-green-400"
          />
        </div>
      </div>
    </div>
  )
}
