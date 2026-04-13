import { forwardRef, useEffect, useRef } from 'react'
import { Check, ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import BuyerStepCardSkeleton from './BuyerStepCardSkeleton.jsx'

function mergeRefs(node, refA, refB) {
  if (typeof refA === 'function') refA(node)
  else if (refA) refA.current = node
  refB.current = node
}

const BuyerStepCard = forwardRef(function BuyerStepCard(
  {
    stepIndex,
    title,
    subtitle,
    expanded,
    onToggle,
    viewed,
    onViewed,
    isLast,
    onNext,
    children,
    loading
  },
  ref
) {
  const innerRef = useRef(null)

  useEffect(() => {
    const el = innerRef.current
    if (!el || viewed) return
    const root =
      typeof document !== 'undefined'
        ? document.querySelector('main.overflow-y-auto')
        : null
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) onViewed?.(stepIndex)
      },
      { threshold: 0.1, root: root ?? undefined, rootMargin: '0px 0px -8% 0px' }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [stepIndex, onViewed, viewed])

  const setRefs = (node) => {
    mergeRefs(node, ref, innerRef)
  }

  if (loading) {
    return (
      <BuyerStepCardSkeleton ref={setRefs} stepNumber={stepIndex + 1} />
    )
  }

  return (
    <div ref={setRefs} className="relative pl-10 pb-6 sm:pl-14">
      <div
        className={cn(
          'absolute left-0 top-0 z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 transition-all duration-300 sm:h-10 sm:w-10',
          viewed
            ? 'border-primary bg-primary'
            : 'border-border bg-background'
        )}
        aria-hidden
      >
        {viewed ? (
          <Check className="h-3.5 w-3.5 text-primary-foreground sm:h-4 sm:w-4" />
        ) : (
          <span className="text-[10px] font-semibold text-muted-foreground sm:text-xs">
            {stepIndex + 1}
          </span>
        )}
      </div>

      <div className="rounded-xl border border-border/60 bg-card shadow-sm">
        <button
          type="button"
          onClick={() => onToggle(stepIndex)}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left sm:px-5"
          aria-expanded={expanded}
        >
          <div className="min-w-0">
            <p className="mb-0.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Step {stepIndex + 1}
            </p>
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            {subtitle ? (
              <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
            ) : null}
          </div>
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
              expanded && 'rotate-180'
            )}
          />
        </button>

        {expanded ? (
          <div className="border-t border-border/40 px-4 pb-5 pt-4 sm:px-5">
            {children}
            {!isLast ? (
              <div className="mt-6 flex justify-end">
                <Button type="button" size="sm" variant="secondary" onClick={onNext}>
                  Continue to next step
                  <ChevronRight className="ml-1 h-4 w-4" aria-hidden />
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
})

export default BuyerStepCard
