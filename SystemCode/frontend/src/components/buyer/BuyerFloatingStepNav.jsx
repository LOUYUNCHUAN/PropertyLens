import { cn } from '@/lib/utils'

export default function BuyerFloatingStepNav({
  visible,
  stepCount,
  activeStep = -1,
  stepRefs,
  titles
}) {
  if (!visible) return null

  return (
    <div
      className={cn(
        'fixed right-4 top-1/2 z-40 hidden -translate-y-1/2 flex-col gap-2 lg:flex'
      )}
      aria-label="Jump to analysis step"
    >
      {Array.from({ length: stepCount }, (_, i) => (
        <button
          key={i}
          type="button"
          title={titles[i] || `Step ${i + 1}`}
          onClick={() =>
            stepRefs[i]?.current?.scrollIntoView({
              behavior: 'smooth',
              block: 'start'
            })
          }
          className={cn(
            'rounded-full transition-all duration-200',
            activeStep >= 0 && activeStep === i
              ? 'h-3 w-3 bg-primary'
              : 'h-2 w-2 bg-border hover:bg-primary/50'
          )}
        />
      ))}
    </div>
  )
}
