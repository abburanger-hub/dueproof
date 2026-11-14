import type { ButtonHTMLAttributes } from 'react'
import { cn } from './lib/cn'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost'
export type ButtonSize = 'md' | 'sm'

const baseClasses =
  'inline-flex items-center justify-center gap-2 rounded-md font-medium ' +
  'transition-colors disabled:cursor-not-allowed disabled:opacity-60'

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-white hover:bg-accent/90 active:bg-accent/95 disabled:hover:bg-accent',
  secondary:
    'border border-line-strong bg-surface text-slate-800 hover:bg-surface-muted',
  ghost: 'text-slate-700 hover:bg-surface-muted',
}

const sizeClasses: Record<ButtonSize, string> = {
  md: 'px-4 py-2 text-sm',
  sm: 'px-3 py-1.5 text-xs',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

/**
 * Accessible button primitive.
 *
 * - Defaults to `type="button"` so forms are never submitted accidentally.
 * - Disabled buttons keep `title`/hint text nearby so the reason is visible.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  type = 'button',
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(baseClasses, variantClasses[variant], sizeClasses[size], className)}
      {...props}
    />
  )
}
