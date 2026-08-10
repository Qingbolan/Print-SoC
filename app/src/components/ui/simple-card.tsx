/**
 * SimpleCard - Minimal card component without heavy effects
 * Use sparingly for actual content grouping, not statistics
 * Inspired by Overleaf's flat design principles
 */

import { cn } from '@/lib/utils';
import { Surface } from '@/components/ui/surface';

interface SimpleCardProps {
  children: React.ReactNode;
  className?: string;
  variant?: 'default' | 'subtle' | 'ghost' | 'bordered';
  padding?: 'sm' | 'md' | 'lg';
  hoverable?: boolean;
  onClick?: () => void;
}

export function SimpleCard({
  children,
  className,
  variant = 'default',
  padding = 'md',
  hoverable = false,
  onClick,
}: SimpleCardProps) {
  return (
    <Surface
      onClick={onClick}
      tone={variant === 'subtle' ? 'muted' : 'default'}
      interactive={hoverable}
      className={cn(
        "text-card-foreground",
        {
          "border-0 bg-transparent": variant === 'ghost',
          "border border-border bg-transparent": variant === 'bordered',

          // Padding
          "p-3": padding === 'sm',
          "p-5": padding === 'md',
          "p-7": padding === 'lg',

          // Hover effect
        },
        className
      )}
    >
      {children}
    </Surface>
  );
}

interface SimpleCardHeaderProps {
  children: React.ReactNode;
  className?: string;
}

export function SimpleCardHeader({ children, className }: SimpleCardHeaderProps) {
  return (
    <div className={cn("mb-4 space-y-1.5", className)}>
      {children}
    </div>
  );
}

interface SimpleCardTitleProps {
  children: React.ReactNode;
  className?: string;
}

export function SimpleCardTitle({ children, className }: SimpleCardTitleProps) {
  return (
    <h3 className={cn("text-lg font-semibold leading-6", className)}>
      {children}
    </h3>
  );
}

interface SimpleCardDescriptionProps {
  children: React.ReactNode;
  className?: string;
}

export function SimpleCardDescription({ children, className }: SimpleCardDescriptionProps) {
  return (
    <p className={cn("text-sm leading-5 text-muted-foreground", className)}>
      {children}
    </p>
  );
}

interface SimpleCardContentProps {
  children: React.ReactNode;
  className?: string;
}

export function SimpleCardContent({ children, className }: SimpleCardContentProps) {
  return (
    <div className={cn(className)}>
      {children}
    </div>
  );
}
