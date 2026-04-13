import { cn } from '@/lib/utils'

const DEFAULT_SEGMENT_LABELS = [
  'Price drivers',
  'Patterns',
  'Local market',
  'Comparables',
  'Negotiation',
  'Nearby'
]

export default function BuyerStepProgressBar({
  viewedSteps,
  activeStep = -1,
  label = 'Analysis',
  segmentLabels = DEFAULT_SEGMENT_LABELS
}) {
  const reviewed = viewedSteps.filter(Boolean).length

  return (
    <div className="mb-2 flex flex-wrap items-center gap-1.5 px-1 py-3">
      <span className="mr-2 text-xs text-muted-foreground">{label}</span>
      {segmentLabels.map((segLabel, i) => {
        const passedByScroll =
          typeof activeStep === 'number' && activeStep >= 0 && i < activeStep
        const filled = viewedSteps[i] || passedByScroll
        return (
        <div key={`${segLabel}-${i}`} className="flex items-center gap-1.5">
          <div
            title={segLabel}
            className={cn(
              'h-1.5 rounded-full transition-colors duration-500',
              'w-4 sm:w-8',
              filled ? 'bg-primary' : 'bg-border/40'
            )}
          />
        </div>
        )
      })}
      <span className="ml-2 text-xs text-muted-foreground">
        {reviewed}/6 reviewed
      </span>
    </div>
  )
}
