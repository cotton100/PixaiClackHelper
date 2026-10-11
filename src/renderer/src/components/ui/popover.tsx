import * as PopoverPrimitive from '@radix-ui/react-popover'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils'

export const Popover = PopoverPrimitive.Root
export const PopoverTrigger = PopoverPrimitive.Trigger

export function PopoverContent({
  className,
  align = 'center',
  sideOffset = 6,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content>): React.JSX.Element {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-50 rounded-lg border border-line bg-surface p-2 text-ink shadow-xl outline-none',
          className
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}
