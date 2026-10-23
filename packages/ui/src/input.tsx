import type { ComponentProps } from 'react';
import { cn } from './utils';
export function Input({className, ...props}: ComponentProps<'input'>) {
  return <input data-slot="input" className={cn('h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50', className)} {...props}/>;
}
