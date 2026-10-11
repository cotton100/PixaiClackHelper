import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils'

export const TooltipProvider = TooltipPrimitive.Provider
export const Tooltip = TooltipPrimitive.Root
export const TooltipTrigger = TooltipPrimitive.Trigger

export function TooltipContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Content>): React.JSX.Element {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          'z-50 overflow-hidden rounded-lg border border-line bg-surface p-1 text-ink shadow-xl',
          className
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  )
}
