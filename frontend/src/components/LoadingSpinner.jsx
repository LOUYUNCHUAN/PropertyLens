export default function LoadingSpinner({ label = 'Loading...' }) {
  return (
    <div className="flex items-center justify-center py-8 gap-3 text-[13px] text-[color:var(--ink-muted)]">
      <div className="flex gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-[color:var(--sage)] animate-bounce" />
        <span className="w-1.5 h-1.5 rounded-full bg-[color:var(--sage)] animate-bounce [animation-delay:0.1s]" />
        <span className="w-1.5 h-1.5 rounded-full bg-[color:var(--sage)] animate-bounce [animation-delay:0.2s]" />
      </div>
      <span>{label}</span>
    </div>
  )
}

