import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'

const variants = {
  sidebar: {
    wrap: 'h-10 w-10 rounded-[10px]',
    icon: 'h-[22px] w-[22px]'
  },
  hero: {
    wrap: 'h-14 w-14 rounded-xl',
    icon: 'h-8 w-8'
  }
}

/** Magnifying-glass mark for PropertyLens (replaces raster logo). */
export default function BrandMark({ variant = 'sidebar', className }) {
  const v = variants[variant] ?? variants.sidebar
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center bg-primary/15 text-primary ring-1 ring-primary/25 dark:bg-primary/20 dark:ring-primary/35',
        v.wrap,
        className
      )}
      aria-hidden
    >
      <Search className={v.icon} strokeWidth={2.25} />
    </span>
  )
}
