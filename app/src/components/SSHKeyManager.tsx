import { useState, useEffect } from 'react'
import { Key, Copy, Check, Info, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { generateSSHKey, getKeyInfo, type SSHKeyInfo } from '@/lib/printer-api'

export function SSHKeyManager() {
  const [keyInfo, setKeyInfo] = useState<SSHKeyInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [copied, setCopied] = useState(false)

  const loadKeyInfo = async () => {
    setLoading(true)
    try {
      const result = await getKeyInfo()
      if (result.success && result.data) {
        setKeyInfo(result.data)
      }
    } catch (error) {
      console.error('Failed to load key info:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadKeyInfo()
  }, [])

  const handleGenerateKey = async () => {
    setGenerating(true)
    try {
      const result = await generateSSHKey('print-at-soc-generated')
      if (result.success) {
        toast.success('SSH key pair generated successfully!')
        await loadKeyInfo()
      } else {
        toast.error(result.error || 'Failed to generate SSH key')
      }
    } catch (error) {
      toast.error('Failed to generate SSH key')
      console.error(error)
    } finally {
      setGenerating(false)
    }
  }

  const handleCopyPublicKey = async () => {
    if (!keyInfo?.public_key_content) return

    try {
      await navigator.clipboard.writeText(keyInfo.public_key_content)
      setCopied(true)
      toast.success('Public key copied to clipboard!')
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      toast.error('Failed to copy to clipboard')
    }
  }

  if (loading) {
    return (
      <div className="p-4 border border-border rounded-lg bg-muted/30">
        <div className="flex items-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin" />
          <span className="text-sm">Loading SSH key information...</span>
        </div>
      </div>
    )
  }

  if (!keyInfo) {
    return null
  }

  return (
    <div className="p-4 border border-border rounded-lg bg-muted/30 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Key className="w-5 h-5" />
          <h3 className="text-sm font-medium text-foreground">SSH Key</h3>
        </div>
        {keyInfo.exists ? (
          <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">
            <Check className="w-3 h-3 mr-1" />
            Key Exists
          </Badge>
        ) : (
          <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600 border-yellow-500/20">
            No Key
          </Badge>
        )}
      </div>

      {!keyInfo.exists ? (
        <div className="space-y-3">
          <div className="flex items-start gap-2 p-3 bg-blue-500/10 rounded-md">
            <Info className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-blue-600">
              Generate an SSH key pair to enable password-free login. You'll need to add the public key to your server's authorized_keys file.
            </p>
          </div>
          <Button
            onClick={handleGenerateKey}
            disabled={generating}
            className="w-full"
            size="sm"
          >
            {generating ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Key className="w-4 h-4 mr-2" />
                Generate SSH Key Pair
              </>
            )}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">
              <div>Private Key: {keyInfo.private_key_path}</div>
              <div>Public Key: {keyInfo.public_key_path}</div>
            </div>
          </div>

          {keyInfo.public_key_content && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-foreground">Public Key Content:</div>
              <div className="relative">
                <pre className="text-xs p-3 bg-muted rounded-md overflow-x-auto max-w-full">
                  <code className="break-all whitespace-pre-wrap">
                    {keyInfo.public_key_content}
                  </code>
                </pre>
              </div>
              <Button
                onClick={handleCopyPublicKey}
                variant="outline"
                size="sm"
                className="w-full"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4 mr-2" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 mr-2" />
                    Copy Public Key
                  </>
                )}
              </Button>
            </div>
          )}

          <div className="flex items-start gap-2 p-3 bg-blue-500/10 rounded-md">
            <Info className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
            <div className="text-xs text-blue-600 space-y-1">
              <p className="font-medium">To use this key for login:</p>
              <ol className="list-decimal list-inside space-y-0.5 ml-2">
                <li>Copy the public key above</li>
                <li>SSH to your server and run: <code className="bg-blue-500/20 px-1 rounded">nano ~/.ssh/authorized_keys</code></li>
                <li>Paste the public key on a new line</li>
                <li>Save and exit (Ctrl+O, Enter, Ctrl+X)</li>
                <li>On the login page, select "Private Key" auth type and use the private key path shown above</li>
              </ol>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
