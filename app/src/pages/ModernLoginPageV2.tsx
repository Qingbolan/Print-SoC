import { useState, useEffect, useCallback, memo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { testSSHConnection } from '@/lib/printer-api'
import { usePrinterStore } from '@/store/printer-store'
import { toast } from 'sonner'
import { motion, AnimatePresence } from 'framer-motion'
import { Loader2, ChevronRight, GraduationCap, Briefcase } from 'lucide-react'

export default function ModernLoginPageV2() {
  const navigate = useNavigate()
  const { setSshConfig, setIsConnected } = usePrinterStore()

  const [step, setStep] = useState<'welcome' | 'server' | 'credentials'>('welcome')
  const [serverType, setServerType] = useState<'stu' | 'stf' | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const handleConnect = useCallback(async () => {
    if (!username || !password || !serverType) return

    setLoading(true)
    const isDebugMode = import.meta.env.VITE_DEBUG_OFFLINE === 'true'

    if (isDebugMode) {
      toast.info(`🔧 Debug Mode: Skipping SSH connection`)
    } else {
      toast.info(`Connecting to ${serverType.toUpperCase()} server...`)
    }

    const host = serverType === 'stu' ? 'stu.comp.nus.edu.sg' : 'stf.comp.nus.edu.sg'
    const config = {
      host,
      port: 22,
      username,
      auth_type: { type: 'Password' as const, password },
    }

    try {
      let result

      if (isDebugMode) {
        // 离线调试模式：跳过SSH连接
        console.log('🔧 Debug mode enabled - Skipping SSH connection to:', host)
        result = { success: true }
      } else {
        // 正常模式：实际连接SSH
        console.log('Testing SSH connection to:', host)
        result = await testSSHConnection(config)
        console.log('SSH connection result:', result)
      }

      if (result.success) {
        setSshConfig(config)
        setIsConnected(true)
        const successMsg = isDebugMode
          ? `Debug Mode: Bypassed ${serverType.toUpperCase()} connection`
          : `Connected to ${serverType.toUpperCase()} successfully!`
        toast.success(successMsg)
        setTimeout(() => navigate('/home'), 500)
      } else {
        toast.error(result.error || 'Connection failed')
        console.error('SSH connection error:', result.error)
      }
    } catch (error) {
      const errorMsg = String(error)
      toast.error('Connection failed: ' + errorMsg)
      console.error('SSH connection exception:', error)
    } finally {
      setLoading(false)
    }
  }, [username, password, serverType, setSshConfig, setIsConnected, navigate])

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      {/* Optimized animated background - Removed, using App.tsx background */}

      <AnimatePresence mode="wait">
        {/* Welcome Step */}
        {step === 'welcome' && (
          <motion.div
            key="welcome"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="max-w-2xl w-full text-center space-y-8 relative z-10"
            role="main"
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="space-y-4"
            >
              <h1 className="text-5xl font-bold bg-gradient-to-r from-cyan-500 via-blue-500 to-purple-500 dark:from-cyan-400 dark:via-blue-400 dark:to-purple-400 bg-clip-text text-transparent">
                Hi, first time to use?
              </h1>
              <p className="text-xl text-muted-foreground">
                Welcome to Print@SoC
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
            >
              <Button
                size="lg"
                className="text-lg px-8 py-6 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 fluent-shadow-sm hover:fluent-shadow fluent-transition border-0"
                onClick={() => setStep('server')}
                aria-label="Get started with setup"
              >
                Get Started
                <ChevronRight className="ml-2 w-5 h-5" aria-hidden="true" />
              </Button>
            </motion.div>
          </motion.div>
        )}

        {/* Server Selection Step */}
        {step === 'server' && (
          <motion.div
            key="server"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="max-w-2xl w-full relative z-10"
            role="main"
          >
            <div>
              <div className="text-center mb-8">
                <h2 className="text-3xl font-bold mb-2 text-foreground">Choose your server</h2>
                <p className="text-muted-foreground">Select your NUS SoC account type</p>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-8" role="group" aria-label="Server selection">
                <motion.button
                  whileHover={{ scale: 1.02, y: -5 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => {
                    setServerType('stu')
                    setStep('credentials')
                  }}
                  className="p-8 rounded-xl border-2 border-border bg-card hover:border-cyan-500 hover:bg-cyan-500/10 fluent-transition fluent-shadow-xs hover:fluent-shadow-sm group"
                  aria-label="Select student server: stu.comp.nus.edu.sg"
                >
                  <GraduationCap className="w-10 h-10 mx-auto mb-4 text-cyan-400 group-hover:scale-110 transition-transform" aria-hidden="true" />
                  <div className="font-bold text-xl mb-2 text-foreground">Student</div>
                  <div className="text-sm text-muted-foreground">stu.comp.nus.edu.sg</div>
                </motion.button>

                <motion.button
                  whileHover={{ scale: 1.02, y: -5 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => {
                    setServerType('stf')
                    setStep('credentials')
                  }}
                  className="p-8 rounded-xl border-2 border-border bg-card hover:border-purple-500 hover:bg-purple-500/10 fluent-transition fluent-shadow-xs hover:fluent-shadow-sm group"
                  aria-label="Select staff server: stf.comp.nus.edu.sg"
                >
                  <Briefcase className="w-10 h-10 mx-auto mb-4 text-purple-400 group-hover:scale-110 transition-transform" aria-hidden="true" />
                  <div className="font-bold text-xl mb-2 text-foreground">Staff</div>
                  <div className="text-sm text-muted-foreground">stf.comp.nus.edu.sg</div>
                </motion.button>
              </div>

              <Button
                variant="ghost"
                className="w-full text-muted-foreground hover:text-foreground fluent-transition"
                onClick={() => setStep('welcome')}
                aria-label="Go back to welcome screen"
              >
                Back
              </Button>
            </div>
          </motion.div>
        )}

        {/* Credentials Step */}
        {step === 'credentials' && serverType && (
          <motion.div
            key="credentials"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="max-w-md w-full relative z-10"
            role="main"
          >
            <div>
              <div className="text-center mb-8">
                <h2 className="text-2xl font-bold mb-2 text-foreground">
                  Sign in to {serverType.toUpperCase()}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {serverType}.comp.nus.edu.sg
                </p>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  handleConnect()
                }}
                className="space-y-6"
                aria-label="SSH connection form"
              >
                <div className="space-y-2">
                  <label htmlFor="username" className="text-sm font-medium text-foreground">
                    NUSNET ID
                  </label>
                  <Input
                    id="username"
                    type="text"
                    placeholder="e0123456"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="h-12 text-lg bg-input border-border text-foreground placeholder:text-muted-foreground focus:border-cyan-500 focus:ring-cyan-500"
                    autoFocus
                    autoComplete="username"
                    required
                    aria-required="true"
                  />
                </div>

                <div className="space-y-2">
                  <label htmlFor="password" className="text-sm font-medium text-foreground">
                    Password
                  </label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-12 text-lg bg-input border-border text-foreground placeholder:text-muted-foreground focus:border-cyan-500 focus:ring-cyan-500"
                    autoComplete="current-password"
                    required
                    aria-required="true"
                  />
                </div>

                <Button
                  type="submit"
                  className="w-full h-12 text-lg rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 fluent-shadow-sm hover:fluent-shadow fluent-transition border-0"
                  disabled={loading || !username || !password}
                  aria-label={loading ? 'Connecting to server' : 'Connect to server'}
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" aria-hidden="true" />
                      Connecting...
                    </>
                  ) : (
                    <>
                      Connect
                    </>
                  )}
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  className="w-full text-muted-foreground hover:text-foreground fluent-transition"
                  onClick={() => setStep('server')}
                  aria-label="Go back to server selection"
                >
                  Back
                </Button>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
