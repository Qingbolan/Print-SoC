import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useSSHConnection } from '@/hooks/useSSHConnection'
import { usePrinterStore } from '@/store/printer-store'
import { toast } from 'sonner'
import { motion, AnimatePresence } from 'framer-motion'
import { Loader2, ChevronRight, GraduationCap, Briefcase } from 'lucide-react'

export default function LoginPage() {
  const navigate = useNavigate()
  const { setSshConfig, savedCredentials, setSavedCredentials } = usePrinterStore()
  const { connect, isConnecting } = useSSHConnection()

  const [step, setStep] = useState<'welcome' | 'server' | 'credentials'>('welcome')
  const [serverType, setServerType] = useState<'stu' | 'stf' | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(true)
  const [autoLoginAttempted, setAutoLoginAttempted] = useState(false)

  // Build SSH config from current state
  const buildConfig = (server: 'stu' | 'stf', user: string, pass: string) => ({
    host: server === 'stu' ? 'stu.comp.nus.edu.sg' : 'stf.comp.nus.edu.sg',
    port: 22,
    username: user,
    auth_type: { type: 'Password' as const, password: pass },
  })

  // Perform login with given config
  const performLogin = async (
    config: ReturnType<typeof buildConfig>,
    server: 'stu' | 'stf',
    user: string,
    pass: string,
    remember: boolean,
    isAutoLogin: boolean
  ) => {
    const isDebugMode = import.meta.env.VITE_DEBUG_OFFLINE === 'true'

    if (isDebugMode) {
      // Debug mode: skip actual SSH connection
      console.log('🔧 Debug mode - Skipping SSH connection')
      toast.info('🔧 Debug Mode: Skipping SSH connection')
      setSshConfig(config)
      if (remember) {
        setSavedCredentials({ serverType: server, username: user, password: pass, rememberMe: true })
      }
      navigate('/home')
      return
    }

    if (!isAutoLogin) {
      toast.info(`Connecting to ${server.toUpperCase()} server...`)
    }

    // Backend handles retries - single call
    const result = await connect(config)

    if (result.success) {
      setSshConfig(config)
      if (remember) {
        setSavedCredentials({ serverType: server, username: user, password: pass, rememberMe: true })
      } else {
        setSavedCredentials(null)
      }
      toast.success(`Connected to ${server.toUpperCase()}!`)
      navigate('/home')
    } else {
      const errorMsg = result.error || 'Connection failed'
      if (isAutoLogin) {
        toast.error('Auto-login failed. Please login manually.')
      } else {
        toast.error(errorMsg)
      }
      console.error('SSH connection error:', errorMsg)
    }
  }

  // Auto-login effect
  useEffect(() => {
    if (savedCredentials && savedCredentials.rememberMe && !autoLoginAttempted) {
      setAutoLoginAttempted(true)
      setServerType(savedCredentials.serverType)
      setUsername(savedCredentials.username)
      setPassword(savedCredentials.password)
      setRememberMe(true)
      setStep('credentials')

      const config = buildConfig(
        savedCredentials.serverType,
        savedCredentials.username,
        savedCredentials.password
      )

      const isDebugMode = import.meta.env.VITE_DEBUG_OFFLINE === 'true'
      if (!isDebugMode) {
        toast.info(`Connecting to ${savedCredentials.serverType.toUpperCase()}...`)
      }

      performLogin(config, savedCredentials.serverType, savedCredentials.username, savedCredentials.password, true, true)
    } else if (savedCredentials && !autoLoginAttempted) {
      // Pre-fill credentials but don't auto-login
      setServerType(savedCredentials.serverType)
      setUsername(savedCredentials.username)
      setPassword(savedCredentials.password)
      setStep('credentials')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedCredentials, autoLoginAttempted])

  const handleConnect = async () => {
    if (!username || !password || !serverType) return

    const config = buildConfig(serverType, username, password)
    await performLogin(config, serverType, username, password, rememberMe, false)
  }

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
                  className="p-8 rounded-xl border-2 border-border bg-card hover:border-primary hover:bg-primary/10 fluent-transition fluent-shadow-xs hover:fluent-shadow-sm group"
                  aria-label="Select staff server: stf.comp.nus.edu.sg"
                >
                  <Briefcase className="w-10 h-10 mx-auto mb-4 text-primary group-hover:scale-110 transition-transform" aria-hidden="true" />
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

                <div className="flex items-center space-x-2">
                  <input
                    id="remember-me"
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="h-4 w-4 rounded border-border text-cyan-500 focus:ring-cyan-500 focus:ring-offset-0"
                  />
                  <label htmlFor="remember-me" className="text-sm text-foreground cursor-pointer">
                    Remember me (auto-login next time)
                  </label>
                </div>

                <p className="text-xs text-muted-foreground">
                  Your credentials are stored locally on your device and never sent to third parties.
                </p>

                <Button
                  type="submit"
                  className="w-full h-12 text-lg rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 fluent-shadow-sm hover:fluent-shadow fluent-transition border-0"
                  disabled={isConnecting || !username || !password}
                  aria-label={isConnecting ? 'Connecting to server' : 'Connect to server'}
                >
                  {isConnecting ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" aria-hidden="true" />
                      Connecting...
                    </>
                  ) : (
                    'Connect'
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
