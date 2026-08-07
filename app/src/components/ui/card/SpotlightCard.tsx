import React, { useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface Position {
  x: number;
  y: number;
}

interface SpotlightCardProps extends React.PropsWithChildren<React.HTMLAttributes<HTMLDivElement>> {
  className?: string;
  spotlightColor?: `rgba(${number}, ${number}, ${number}, ${number})`;
  variant?: 'default' | 'strong' | 'thin';
  tintOpacity?: number;
  noise?: boolean;
  interactive?: boolean;
}

const SpotlightCard: React.FC<SpotlightCardProps> = ({
  children,
  className = '',
  spotlightColor = 'rgba(255, 255, 255, 0.32)',
  variant = 'default',
  tintOpacity = 0.7,
  noise = false,
  interactive = false,
  ...restProps
}) => {
  const divRef = useRef<HTMLDivElement>(null);
  const [isFocused, setIsFocused] = useState<boolean>(false);
  const [position, setPosition] = useState<Position>({ x: 0, y: 0 });
  const [opacity, setOpacity] = useState<number>(0);
  const spotlightOpacity = Math.min(0.26, Math.max(0.08, tintOpacity * 0.18));

  const handleMouseMove: React.MouseEventHandler<HTMLDivElement> = e => {
    if (!interactive || !divRef.current || isFocused) return;

    const rect = divRef.current.getBoundingClientRect();
    setPosition({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const handleFocus = () => {
    if (!interactive) return;
    setIsFocused(true);
    setOpacity(spotlightOpacity);
  };

  const handleBlur = () => {
    if (!interactive) return;
    setIsFocused(false);
    setOpacity(0);
  };

  const handleMouseEnter = () => {
    if (!interactive) return;
    setOpacity(spotlightOpacity);
  };

  const handleMouseLeave = () => {
    if (!interactive) return;
    setOpacity(0);
  };

  return (
    <div
      ref={divRef}
      onMouseMove={handleMouseMove}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={cn(
        'relative overflow-hidden rounded-lg border border-[var(--card-border)] bg-card text-card-foreground shadow-[var(--shadow-xs)]',
        'transition-[background-color,border-color,box-shadow] duration-150',
        variant === 'thin' && 'bg-card/75 shadow-none',
        variant === 'strong' && 'bg-[var(--elevated)] shadow-[var(--shadow-sm)]',
        interactive && 'hover:border-[var(--border-hover)] hover:bg-[var(--card-hover)] hover:shadow-[var(--shadow-sm)]',
        className,
      )}
      style={{
        position: 'relative',
        isolation: 'isolate',
      }}
      {...restProps}
    >
      {/* Noise texture */}
      {noise && (
        <div
          className="pointer-events-none absolute inset-0 rounded-lg opacity-[0.025]"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='4.2' numOctaves='5' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
            backgroundSize: '200px 200px',
            mixBlendMode: 'soft-light',
          }}
        />
      )}

      {/* Spotlight effect */}
      {interactive && (
        <div
          className="pointer-events-none absolute inset-0 rounded-lg opacity-0 transition-opacity duration-200 ease-out"
          style={{
            opacity,
            background: `radial-gradient(circle at ${position.x}px ${position.y}px, ${spotlightColor}, transparent 72%)`,
            mixBlendMode: 'soft-light',
          }}
        />
      )}

      {/* Content */}
      <div className="relative z-10">{children}</div>
    </div>
  );
};

export default SpotlightCard;
