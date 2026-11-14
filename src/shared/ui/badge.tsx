import type { HTMLAttributes } from 'react'
import { cn } from './lib/cn'

export type BadgeTone = 'neutral' | 'accent' | 'positive' | 'caution'

const toneClasses: Record<BadgeTone, string> = {
  neutral: 'border-line-strong bg-surface-muted text-slate-600',
  accent: 'border-accent/30 bg-accent/10 text-accent',
  positive: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  caution: 'border-amber-300 bg-amber-50 text-amber-700',
}

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone
}

/**
 * Small status chip. Tone is always paired with visible text, so status is
 * never communicated by color alone.
 */
export function Badge({ tone = 'neutral', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        toneClasses[tone],
        className,
      )}
      {...props}
    />
  )
}
