/**
 * SimpleCard - Minimal card component without heavy effects
 * Use sparingly for actual content grouping, not statistics
 * Inspired by Overleaf's flat design principles
 */

import { cn } from '@/lib/utils';

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
    <div
      onClick={onClick}
      className={cn(
        "rounded-lg text-card-foreground transition-[background-color,border-color,box-shadow] duration-150",
        {
          "border border-[var(--card-border)] bg-card shadow-[var(--shadow-xs)]": variant === 'default',
          "border border-border/60 bg-muted/20": variant === 'subtle',
          "bg-transparent": variant === 'ghost',
          "bg-transparent border border-border/70": variant === 'bordered',

          // Padding
          "p-3": padding === 'sm',
          "p-5": padding === 'md',
          "p-6": padding === 'lg',

          // Hover effect
          "cursor-pointer hover:border-[var(--border-hover)] hover:bg-[var(--card-hover)] hover:shadow-[var(--shadow-sm)]": hoverable,
        },
        className
      )}
    >
      {children}
    </div>
  );
}

interface SimpleCardHeaderProps {
  children: React.ReactNode;
  className?: string;
}

export function SimpleCardHeader({ children, className }: SimpleCardHeaderProps) {
  return (
    <div className={cn("mb-4 space-y-1", className)}>
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
    <h3 className={cn("text-base font-semibold leading-6", className)}>
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
