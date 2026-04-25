import { cn } from '@/lib/utils'

const variantStyles = {
  success: 'bg-emerald-50 text-emerald-600 border-emerald-100',
  warning: 'bg-amber-50 text-amber-600 border-amber-100',
  error: 'bg-red-50 text-red-600 border-red-100',
  info: 'bg-blue-50 text-blue-600 border-blue-100',
  neutral: 'bg-slate-50 text-slate-600 border-slate-100'
}

const dotStyles = {
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  error: 'bg-red-500',
  info: 'bg-blue-500',
  neutral: 'bg-slate-400'
}

export function StatusBadge({ label, variant = 'neutral', showDot = false, size = 'md' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border font-medium',
        size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs',
        variantStyles[variant]
      )}
    >
      {showDot && <span className={cn('h-1.5 w-1.5 rounded-full', dotStyles[variant])} />}
      {label}
    </span>
  )
}

const ratingStyles = {
  A: 'bg-emerald-50 text-emerald-600 border-emerald-200',
  B: 'bg-slate-100 text-slate-600 border-slate-200',
  C: 'bg-amber-50 text-amber-600 border-amber-200',
  D: 'bg-orange-50 text-orange-600 border-orange-200',
  F: 'bg-red-50 text-red-600 border-red-200'
}

export function RatingBadge({ rating, size = 'md' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-full border font-semibold',
        size === 'sm' ? 'h-5 w-5 text-[10px]' : 'h-6 w-6 text-xs',
        ratingStyles[rating] || ratingStyles.B
      )}
    >
      {rating}
    </span>
  )
}
