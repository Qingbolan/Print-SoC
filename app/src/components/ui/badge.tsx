import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium [&>svg]:size-3 [&>svg]:pointer-events-none transition-colors',
  {
    variants: {
      variant: {
        default:
          'bg-primary/10 text-primary [a&]:hover:bg-primary/15',
        secondary:
          'bg-secondary text-secondary-foreground [a&]:hover:bg-[var(--secondary-hover)]',
        destructive:
          'bg-destructive/10 text-destructive [a&]:hover:bg-destructive/15',
        outline:
          'bg-muted text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground',
        success:
          'bg-success/10 text-success [a&]:hover:bg-success/15',
        warning:
          'bg-warning/10 text-warning-foreground [a&]:hover:bg-warning/15',
        accent:
          'bg-accent text-accent-foreground [a&]:hover:bg-[var(--accent-hover)]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<'span'> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'span'

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
