import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

const BuyerStepCardSkeleton = forwardRef(function BuyerStepCardSkeleton(
  { stepNumber, className },
  ref
) {
  return (
    <div
      ref={ref}
      className={cn('relative pl-10 pb-6 sm:pl-14', className)}
    >
      <div
        className="absolute left-0 top-0 z-10 flex h-8 w-8 animate-pulse items-center justify-center rounded-full border-2 border-dashed border-border bg-background sm:h-10 sm:w-10"
        aria-hidden
      >
        <span className="text-[10px] font-semibold text-muted-foreground sm:text-xs">
          {stepNumber}
        </span>
      </div>
      <div className="rounded-xl border border-border/60 bg-card shadow-sm">
        <div className="px-4 py-4 sm:px-5">
          <div className="mb-2 h-3 w-14 animate-pulse rounded bg-muted" />
          <div className="h-4 w-48 max-w-full animate-pulse rounded bg-muted" />
        </div>
        <div className="space-y-3 border-t border-border/40 px-4 pb-5 pt-4 sm:px-5">
          <div className="h-3 w-full animate-pulse rounded bg-muted" />
          <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
        </div>
      </div>
    </div>
  )
})

export default BuyerStepCardSkeleton
