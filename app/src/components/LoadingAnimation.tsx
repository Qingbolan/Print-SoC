import React, { useEffect, useState } from 'react'
import SplitText from '@/components/reactbits/splitText'
import { useTheme } from '@/lib/theme-context'

interface LoadingAnimationProps {
  text?: string
  subText?: string
  showSpinner?: boolean
  fullScreen?: boolean
  className?: string
}

export const LoadingAnimation: React.FC<LoadingAnimationProps> = ({
  text = 'Loading',
  subText,
  showSpinner = true,
  fullScreen = true,
  className = ''
}) => {
  const { resolvedTheme } = useTheme()
  const [dots, setDots] = useState('...')

  // Animated dots effect
  useEffect(() => {
    const interval = setInterval(() => {
      setDots(prev => {
        if (prev === '...') return '.'
        if (prev === '.') return '..'
        return '...'
      })
    }, 500)

    return () => clearInterval(interval)
  }, [])

  const containerClasses = fullScreen
    ? 'fixed inset-0 z-50 flex items-center justify-center'
    : 'flex items-center justify-center'

  return (
    <div className={`${containerClasses} ${className}`}>
      {/* Background with gradient orbs - matching App.tsx style */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden bg-background">
        {/* Base gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-background via-muted/30 to-background" />

        {/* Animated gradient orbs - using theme colors */}
        <div
          className="absolute top-0 right-0 h-[600px] w-[600px] rounded-full bg-primary/12 dark:bg-primary/20 blur-3xl"
          style={{
            animation: 'float 20s ease-in-out infinite',
            transform: 'translate(20%, -20%)'
          }}
        />
        <div
          className="absolute bottom-0 left-0 h-[500px] w-[500px] rounded-full bg-accent/10 dark:bg-accent/18 blur-3xl"
          style={{
            animation: 'float 25s ease-in-out infinite reverse',
            animationDelay: '5s',
            transform: 'translate(-20%, 20%)'
          }}
        />
        <div
          className="absolute top-1/3 left-1/2 h-[400px] w-[400px] rounded-full bg-primary/8 dark:bg-primary/15 blur-3xl"
          style={{
            animation: 'float 30s ease-in-out infinite',
            animationDelay: '10s',
            transform: 'translate(-50%, -50%)'
          }}
        />

        {/* Acrylic Material Layer */}
        <div
          className="absolute inset-0 bg-background/80 dark:bg-background/70"
          style={{
            backdropFilter: 'blur(60px) saturate(150%)',
            WebkitBackdropFilter: 'blur(60px) saturate(150%)',
          }}
        >
          {/* Noise texture */}
          <div
            className="absolute inset-0 opacity-[0.06] dark:opacity-[0.08]"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='3.5' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
              backgroundSize: '180px 180px',
              mixBlendMode: 'soft-light',
            }}
          />
        </div>
      </div>

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center gap-8">
        {/* Spinner */}
        {showSpinner && (
          <div className="relative w-20 h-20">
            {/* Outer ring */}
            <div
              className="absolute inset-0 rounded-full border-4 border-primary/20"
              style={{
                borderTopColor: resolvedTheme === 'dark' ? '#8A64D9' : '#5432A8',
                animation: 'spin 1.5s linear infinite'
              }}
            />
            {/* Inner ring */}
            <div
              className="absolute inset-2 rounded-full border-4 border-primary/10"
              style={{
                borderBottomColor: resolvedTheme === 'dark' ? '#A57FED' : '#6F49C5',
                animation: 'spin 1s linear infinite reverse'
              }}
            />
            {/* Center dot */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div
                className="w-3 h-3 rounded-full bg-primary"
                style={{
                  animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite'
                }}
              />
            </div>
          </div>
        )}

        {/* Main text with SplitText animation */}
        <div className="flex flex-col items-center gap-2">
          <SplitText
            text={text + dots}
            className="text-5xl font-bold text-foreground"
            tag="h1"
            splitType="chars"
            delay={50}
            duration={0.8}
            from={{ opacity: 0, y: 50, scale: 0.8 }}
            to={{ opacity: 1, y: 0, scale: 1 }}
            ease="elastic.out(1, 0.5)"
            autoPlay={true}
          />

          {subText && (
            <SplitText
              text={subText}
              className="text-lg text-muted-foreground"
              tag="p"
              splitType="words"
              delay={80}
              duration={0.6}
              from={{ opacity: 0, y: 20 }}
              to={{ opacity: 1, y: 0 }}
              ease="power3.out"
              autoPlay={true}
            />
          )}
        </div>

        {/* Progress bar - optional */}
        <div className="w-64 h-1 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-primary to-accent rounded-full"
            style={{
              animation: 'loading-bar 2s ease-in-out infinite'
            }}
          />
        </div>
      </div>

      {/* Inline animations */}
      <style>{`
        @keyframes spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }

        @keyframes float {
          0%, 100% {
            transform: translate(var(--tw-translate-x), var(--tw-translate-y)) scale(1);
          }
          50% {
            transform: translate(var(--tw-translate-x), var(--tw-translate-y)) scale(1.1);
          }
        }

        @keyframes pulse {
          0%, 100% {
            opacity: 1;
            transform: scale(1);
          }
          50% {
            opacity: 0.5;
            transform: scale(1.5);
          }
        }

        @keyframes loading-bar {
          0% {
            transform: translateX(-100%);
          }
          50% {
            transform: translateX(0%);
          }
          100% {
            transform: translateX(100%);
          }
        }
      `}</style>
    </div>
  )
}

export default LoadingAnimation
