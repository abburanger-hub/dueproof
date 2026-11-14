import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Merges conditional class names and resolves conflicting Tailwind utilities.
 *
 * This is the standard shadcn/ui class helper. Adopting the same convention
 * now keeps every component compatible with shadcn/ui patterns if we import
 * shadcn components later.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
