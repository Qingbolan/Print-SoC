/**
 * Toolbar - Clean action bar component
 * Inspired by Overleaf's top navigation and toolbars
 */

import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';

interface ToolbarProps {
  children: React.ReactNode;
  className?: string;
  variant?: 'default' | 'ghost';
}

export function Toolbar({ children, className, variant = 'default' }: ToolbarProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-4 py-3 rounded-lg",
        variant === 'default' && "bg-muted/30 border border-border/50",
        variant === 'ghost' && "bg-transparent",
        className
      )}
    >
      {children}
    </div>
  );
}

interface ToolbarButtonProps {
  icon?: LucideIcon;
  children?: React.ReactNode;
  onClick?: () => void;
  variant?: 'default' | 'primary' | 'ghost';
  size?: 'sm' | 'default';
  className?: string;
  disabled?: boolean;
}

export function ToolbarButton({
  icon: Icon,
  children,
  onClick,
  variant = 'ghost',
  size = 'default',
  className,
  disabled,
}: ToolbarButtonProps) {
  const buttonVariant = variant === 'primary' ? 'default' : variant

  return (
    <Button
      variant={buttonVariant}
      size={size}
      onClick={onClick}
      disabled={disabled}
      className={cn("gap-2", className)}
    >
      {Icon && <Icon className="h-4 w-4" />}
      {children}
    </Button>
  );
}

interface ToolbarSeparatorProps {
  className?: string;
}

export function ToolbarSeparator({ className }: ToolbarSeparatorProps) {
  return (
    <div
      className={cn("w-px h-6 bg-border/50", className)}
    />
  );
}

interface ToolbarSectionProps {
  children: React.ReactNode;
  className?: string;
}

export function ToolbarSection({ children, className }: ToolbarSectionProps) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      {children}
    </div>
  );
}
