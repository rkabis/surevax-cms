import * as React from 'react'
import { GripVertical } from 'lucide-react'
import { Group, Panel, Separator, type GroupProps } from 'react-resizable-panels'
import { cn } from '@/lib/utils'

type ResizablePanelGroupProps = GroupProps & {
  className?: string
}

const ResizablePanelGroup = ({
  className,
  orientation = 'horizontal',
  ...props
}: ResizablePanelGroupProps) => (
  <Group
    orientation={orientation}
    className={cn('flex h-full w-full', orientation === 'vertical' && 'flex-col', className)}
    {...props}
  />
)

const ResizablePanel = Panel

type ResizableHandleProps = React.ComponentProps<typeof Separator> & {
  withHandle?: boolean
  className?: string
}

const ResizableHandle = ({ withHandle, className, ...props }: ResizableHandleProps) => (
  <Separator
    className={cn(
      'relative flex w-px shrink-0 items-center justify-center bg-border',
      'after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2',
      'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1',
      className,
    )}
    {...props}
  >
    {withHandle && (
      <div className="z-10 flex h-4 w-3 items-center justify-center rounded-sm border bg-border">
        <GripVertical className="h-2.5 w-2.5" />
      </div>
    )}
  </Separator>
)

export { ResizablePanelGroup, ResizablePanel, ResizableHandle }
