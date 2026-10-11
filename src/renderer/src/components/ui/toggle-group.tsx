import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils'

export const ToggleGroup = ToggleGroupPrimitive.Root

export function ToggleGroupItem({
  className,
  ...props
}: ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return (
    <ToggleGroupPrimitive.Item
      className={cn(
        'outline-none transition-colors data-[state=on]:bg-paper data-[state=on]:text-ink',
        className
      )}
      {...props}
    />
  )
}
