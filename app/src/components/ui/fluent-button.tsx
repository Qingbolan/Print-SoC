
import * as React from 'react'
import { Button as FluentButton, makeStyles, shorthands } from '@fluentui/react-components'
import { cn } from '@/lib/utils'

// Fluent UI Reveal effect styles
const useRevealButtonStyles = makeStyles({
  root: {
    position: 'relative',
    overflow: 'hidden',
    ...shorthands.borderRadius('8px'),
    ...shorthands.transition('all', '167ms', 'cubic-bezier(0.2, 0, 0, 1)'),

    // Base styles
    backgroundColor: 'rgba(252, 252, 253, 0.6)',
    backdropFilter: 'blur(20px) saturate(180%)',
    WebkitBackdropFilter: 'blur(20px) saturate(180%)',
    ...shorthands.border('1px', 'solid', 'rgba(255, 255, 255, 0.1)'),
    boxShadow: '0 2px 4px 0 rgba(0, 0, 0, 0.08)',

    // Reveal hover effect
    ':hover': {
      transform: 'translateY(-1px)',
      boxShadow: '0 4px 8px 0 rgba(0, 0, 0, 0.12)',
      ...shorthands.borderColor('rgba(255, 255, 255, 0.2)'),
      backgroundColor: 'rgba(252, 252, 253, 0.8)',
    },

    // Active/pressed effect
    ':active': {
      transform: 'scale(0.98)',
      transitionDuration: '67ms',
      boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.06)',
    },

    // Focus effect
    ':focus-visible': {
      outlineWidth: '2px',
      outlineStyle: 'solid',
      outlineColor: 'var(--colorBrandBackground)',
      outlineOffset: '2px',
    },
  },

  // Primary variant
  primary: {
    backgroundColor: 'var(--colorBrandBackground)',
    color: 'var(--colorNeutralForegroundOnBrand)',
    ...shorthands.border('1px', 'solid', 'transparent'),

    ':hover': {
      backgroundColor: 'var(--colorBrandBackgroundHover)',
      transform: 'translateY(-1px)',
      boxShadow: '0 6px 12px 0 rgba(84, 50, 168, 0.3)',
    },

    ':active': {
      backgroundColor: 'var(--colorBrandBackgroundPressed)',
      transform: 'scale(0.98)',
    },
  },

  // Reveal glow effect layer
  revealGlow: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: '0',
    height: '0',
    ...shorthands.borderRadius('50%'),
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    transform: 'translate(-50%, -50%)',
    ...shorthands.transition('width', '600ms', 'ease-out'),
    transitionProperty: 'width, height',
    pointerEvents: 'none',
  },
})

type RevealButtonElementProps = React.ButtonHTMLAttributes<HTMLButtonElement>
const FluentButtonElement = FluentButton as React.ComponentType<RevealButtonElementProps>

export interface RevealButtonProps extends RevealButtonElementProps {
  variant?: 'default' | 'primary' | 'subtle'
}

export function RevealButton({
  className,
  variant = 'default',
  children,
  onMouseMove,
  ...props
}: RevealButtonProps) {
  const styles = useRevealButtonStyles()
  const [glowPosition, setGlowPosition] = React.useState({ x: 0, y: 0 })
  const [isHovering, setIsHovering] = React.useState(false)

  const handleMouseMove = (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setGlowPosition({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    })
    onMouseMove?.(e)
  }

  return (
    <FluentButtonElement
      className={cn(
        styles.root,
        variant === 'primary' && styles.primary,
        className
      )}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      {...props}
    >
      {/* Reveal glow effect */}
      {isHovering && (
        <span
          className={styles.revealGlow}
          style={{
            left: `${glowPosition.x}px`,
            top: `${glowPosition.y}px`,
            width: '100px',
            height: '100px',
          }}
        />
      )}

      {/* Button content */}
      <span style={{ position: 'relative', zIndex: 1 }}>
        {children}
      </span>
    </FluentButtonElement>
  )
}
