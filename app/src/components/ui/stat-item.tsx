/**
 * StatItem - Lightweight statistics display component
 * Inspired by Overleaf's minimal design philosophy
 * Replaces heavy Card-based statistics
 */

import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StatItemProps {
  value: string | number;
  label: string;
  icon?: LucideIcon;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  className?: string;
}

export function StatItem({ value, label, icon: Icon, trend, className }: StatItemProps) {
  return (
    <div className={cn("flex min-w-0 items-center gap-3", className)}>
      {Icon && (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/7 text-primary">
          <Icon className="size-4" />
        </span>
      )}
      <div className="min-w-0">
      <div className="flex items-center gap-2">
        <span className="truncate text-lg font-semibold leading-5 text-foreground tabular-nums">{value}</span>
        {trend && (
          <span
            className={cn(
              "text-xs font-medium",
              trend.isPositive ? "text-green-600" : "text-red-600"
            )}
          >
            {trend.isPositive ? "+" : ""}{trend.value}%
          </span>
        )}
      </div>
      <span className="block truncate text-xs leading-5 text-muted-foreground">{label}</span>
      </div>
    </div>
  );
}

interface StatGroupProps {
  children: React.ReactNode;
  className?: string;
}

export function StatGroup({ children, className }: StatGroupProps) {
  return (
    <div
      className={cn(
        "grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] items-center gap-x-7 gap-y-3 rounded-md border border-[var(--card-border)] bg-card px-4 py-3 sm:px-5 [&>.w-px]:hidden",
        className
      )}
    >
      {children}
    </div>
  );
}

interface StatGridProps {
  children: React.ReactNode;
  columns?: 2 | 3 | 4;
  className?: string;
}

export function StatGrid({ children, columns = 3, className }: StatGridProps) {
  return (
    <div
      className={cn(
        "grid gap-6",
        {
          "grid-cols-1 md:grid-cols-2": columns === 2,
          "grid-cols-1 md:grid-cols-3": columns === 3,
          "grid-cols-2 md:grid-cols-4": columns === 4,
        },
        className
      )}
    >
      {children}
    </div>
  );
}
