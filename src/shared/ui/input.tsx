import type {
  InputHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'
import { cn } from './lib/cn'

/**
 * Shared form control styling.
 *
 * Native elements are used deliberately: they are accessible by default,
 * need no JavaScript to open, and work with every assistive technology.
 */
const controlClasses =
  'w-full rounded-md border border-line-strong bg-white px-3 py-2 text-sm text-slate-900 ' +
  'placeholder:text-slate-400 aria-invalid:border-red-400 ' +
  'focus:border-accent disabled:cursor-not-allowed disabled:bg-surface-muted'

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(controlClasses, className)} {...props} />
}

export function TextArea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(controlClasses, className)} {...props} />
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(controlClasses, className)} {...props} />
}
