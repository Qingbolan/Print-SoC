import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { BrandLogo } from '@/components/common/brand'
import { Surface } from '@/components/ui/surface'
import { useSSHConnection } from '@/hooks/useSSHConnection'
import { usePrinterStore } from '@/store/printer-store'
import { toast } from 'sonner'
import { motion, AnimatePresence } from 'framer-motion'
import { Loader2, ChevronRight, GraduationCap, Briefcase } from 'lucide-react'

// Helper to hide splash screen
const hideSplash = () => {
  const win = window as unknown as { hideSplash?: () => void }
  win.hideSplash?.()
}

export default function LoginPage() {
  const navigate = useNavigate()
  const { savedCredentials, setSavedCredentials, setConnectedSession } = usePrinterStore()
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
    remember: boolean,
    isSavedProfileLogin: boolean
  ) => {
    const isDebugMode = import.meta.env.VITE_DEBUG_OFFLINE === 'true'

    if (isDebugMode) {
      // Debug mode: skip actual SSH connection
      console.log('🔧 Debug mode - Skipping SSH connection')
      toast.info('🔧 Debug Mode: Skipping SSH connection')
      setConnectedSession(config)
      if (remember) {
        setSavedCredentials({ serverType: server, username: user, rememberMe: true })
      } else {
        setSavedCredentials(null)
      }
      hideSplash()
      navigate('/home')
      return
    }

    if (!isSavedProfileLogin) {
      toast.info(`Connecting to ${server.toUpperCase()} server...`)
    }

    // Backend handles retries - single call
    const result = await connect(config)

    if (result.success) {
      if (remember) {
        setSavedCredentials({ serverType: server, username: user, rememberMe: true })
      } else {
        setSavedCredentials(null)
      }
      toast.success(`Connected to ${server.toUpperCase()}!`)
      hideSplash() // Hide splash before navigating
      navigate('/home')
    } else {
      const errorMsg = result.error || 'Connection failed'
      hideSplash() // Hide splash to show login form
      if (isSavedProfileLogin) {
        toast.error('Saved profile login failed. Please login manually.')
      } else {
        toast.error(errorMsg)
      }
      console.error('SSH connection error:', errorMsg)
    }
  }

  // Restore saved login identity without storing or replaying secrets.
  useEffect(() => {
    if (savedCredentials && !autoLoginAttempted) {
      // Restore the saved login identity only. Passwords are never stored.
      setAutoLoginAttempted(true)
      setServerType(savedCredentials.serverType)
      setUsername(savedCredentials.username)
      setPassword('')
      setRememberMe(true)
      setStep('credentials')
      toast.info('Saved account loaded. Enter your password to connect.')
      hideSplash() // Show login form
    } else if (!savedCredentials && !autoLoginAttempted) {
      // No saved credentials - show welcome screen
      setAutoLoginAttempted(true)
      hideSplash() // Show welcome screen
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedCredentials, autoLoginAttempted])

  const handleConnect = async () => {
    if (!username || !password || !serverType) return

    const config = buildConfig(serverType, username, password)
    await performLogin(config, serverType, username, rememberMe, false)
  }

  return (
    <div className="relative grid min-h-dvh grid-cols-12 items-center overflow-y-auto p-6">
      {/* Optimized animated background - Removed, using App.tsx background */}

      <AnimatePresence mode="wait">
        {/* Welcome Step */}
        {step === 'welcome' && (
          <motion.div
            key="welcome"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="relative z-10 col-span-12 space-y-7 text-center md:col-span-8 md:col-start-3 xl:col-span-6 xl:col-start-4"
            role="main"
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="space-y-4"
            >
              <BrandLogo
                className="mx-auto w-fit rounded-lg bg-card p-3"
                iconClassName="h-12 w-12"
                showName={false}
              />
              <h1 className="text-lg font-semibold tracking-normal text-primary">
                Print<span className="text-[var(--brand-orange)]">@</span>SoC
              </h1>
              <p className="text-sm text-muted-foreground">
                NUS School of Computing Printing Service
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
            >
              <Button
                size="lg"
                className="h-10 rounded-md bg-primary px-7 text-sm text-white hover:bg-[var(--primary-hover)]"
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
            className="relative z-10 col-span-12 md:col-span-8 md:col-start-3 xl:col-span-6 xl:col-start-4"
            role="main"
          >
            <Surface className="p-8">
              <div className="text-center mb-8">
                <h2 className="mb-2 text-lg font-semibold text-foreground">Choose your server</h2>
                <p className="text-muted-foreground">Select your NUS SoC account type</p>
              </div>

              <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2" role="group" aria-label="Server selection">
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  onClick={() => {
                    setServerType('stu')
                    setStep('credentials')
                  }}
                  className="group rounded-lg bg-muted/55 p-6 transition-colors duration-150 hover:bg-primary/7"
                  aria-label="Select student server: stu.comp.nus.edu.sg"
                >
                  <GraduationCap className="mx-auto mb-4 h-9 w-9 text-primary" aria-hidden="true" />
                  <div className="mb-1 text-lg font-semibold text-foreground">Student</div>
                  <div className="text-sm text-muted-foreground">stu.comp.nus.edu.sg</div>
                </motion.button>

                <motion.button
                  whileTap={{ scale: 0.98 }}
                  onClick={() => {
                    setServerType('stf')
                    setStep('credentials')
                  }}
                  className="group rounded-lg bg-muted/55 p-6 transition-colors duration-150 hover:bg-[var(--brand-orange-subtle)]"
                  aria-label="Select staff server: stf.comp.nus.edu.sg"
                >
                  <Briefcase className="mx-auto mb-4 h-9 w-9 text-[var(--brand-orange)]" aria-hidden="true" />
                  <div className="mb-1 text-lg font-semibold text-foreground">Staff</div>
                  <div className="text-sm text-muted-foreground">stf.comp.nus.edu.sg</div>
                </motion.button>
              </div>

              <Button
                variant="ghost"
                className="w-full text-muted-foreground hover:text-foreground"
                onClick={() => setStep('welcome')}
                aria-label="Go back to welcome screen"
              >
                Back
              </Button>
            </Surface>
          </motion.div>
        )}

        {/* Credentials Step */}
        {step === 'credentials' && serverType && (
          <motion.div
            key="credentials"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="relative z-10 col-span-12 sm:col-span-8 sm:col-start-3 lg:col-span-4 lg:col-start-5"
            role="main"
          >
            <Surface className="p-8">
              <div className="text-center mb-8">
                <h2 className="mb-2 text-lg font-semibold text-foreground">
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
                    placeholder="Your (SOC)ID [e.g. silan-hu]"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="h-10 text-sm"
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
                    className="h-10 text-sm"
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
                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary focus:ring-offset-0"
                  />
                  <label htmlFor="remember-me" className="cursor-pointer text-sm text-foreground">
                    Remember this account
                  </label>
                </div>

                <p className="text-xs text-muted-foreground">
                  Your password is used only for this SSH connection and is not stored by Print@SoC.
                </p>

                <Button
                  type="submit"
                  className="h-10 w-full bg-primary text-sm text-white hover:bg-[var(--primary-hover)]"
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
                  className="w-full text-muted-foreground hover:text-foreground"
                  onClick={() => setStep('server')}
                  aria-label="Go back to server selection"
                >
                  Back
                </Button>
              </form>
            </Surface>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Full-screen loading overlay when connecting */}
      <AnimatePresence>
        {isConnecting && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/95"
          >
            <motion.div
              className="mb-6 flex size-24 items-center justify-center rounded-md bg-primary"
              animate={{ scale: [1, 1.05, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
            >
              <img src="/logo-mark-white.png" alt="Print@SoC" className="size-full object-contain" />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
