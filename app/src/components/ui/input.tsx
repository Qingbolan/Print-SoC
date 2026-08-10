import * as React from 'react'

import { cn } from '@/lib/utils'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // Base Fluent styles
        'h-11 w-full min-w-0 rounded-md px-3 py-1 text-sm sm:h-9',
        'bg-input border border-border',

        'transition-[border-color,box-shadow,background-color] duration-150',

        // Text and placeholder styling
        'text-foreground placeholder:text-muted-foreground',
        'selection:bg-primary selection:text-primary-foreground',

        // Focus states - Fluent ring style
        'outline-none',
        'focus-visible:border-primary',
        'focus-visible:ring-2 focus-visible:ring-ring/50',
        'focus-visible:bg-input-hover',

        // Hover state
        'hover:border-[var(--border-hover)]',
        'hover:bg-input-hover',

        // Invalid/error states
        'aria-invalid:border-destructive',
        'aria-invalid:ring-2 aria-invalid:ring-destructive/20',

        // Disabled state
        'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',

        // File input styling
        'file:inline-flex file:h-7 file:border-0 file:bg-transparent',
        'file:text-sm file:font-medium file:text-foreground',

        className,
      )}
      {...props}
    />
  )
}

export { Input }
