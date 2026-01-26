/**
 * SimpleCard - Minimal card component without heavy effects
 * Use sparingly for actual content grouping, not statistics
 * Inspired by Overleaf's flat design principles
 */

import { cn } from '@/lib/utils';

interface SimpleCardProps {
  children: React.ReactNode;
  className?: string;
  variant?: 'default' | 'ghost' | 'bordered';
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
        "rounded-lg transition-colors",
        {
          // Variants
          "bg-card border border-border": variant === 'default',
          "bg-transparent": variant === 'ghost',
          "bg-transparent border border-border": variant === 'bordered',

          // Padding
          "p-4": padding === 'sm',
          "p-6": padding === 'md',
          "p-8": padding === 'lg',

          // Hover effect
          "hover:bg-muted/50 cursor-pointer": hoverable,
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
    <div className={cn("space-y-1.5 mb-4", className)}>
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
    <h3 className={cn("text-lg font-semibold leading-none tracking-tight", className)}>
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
    <p className={cn("text-sm text-muted-foreground", className)}>
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
