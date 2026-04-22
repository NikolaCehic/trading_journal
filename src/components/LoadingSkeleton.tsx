function SkeletonBox({ className }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded bg-muted ${className ?? ''}`}
      aria-hidden="true"
    />
  )
}

export function TableSkeleton() {
  return (
    <div className="p-6" role="status" aria-label="Loading trades">
      {/* Header row */}
      <div className="mb-4 flex gap-4">
        <SkeletonBox className="h-4 w-24" />
        <SkeletonBox className="h-4 w-16" />
        <SkeletonBox className="h-4 w-20" />
        <SkeletonBox className="h-4 w-16" />
        <SkeletonBox className="h-4 w-20" />
      </div>
      {/* Data rows */}
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="mb-3 flex gap-4">
          <SkeletonBox className="h-4 w-28" />
          <SkeletonBox className="h-4 w-14" />
          <SkeletonBox className="h-4 w-24" />
          <SkeletonBox className="h-4 w-16" />
          <SkeletonBox className="h-4 w-18" />
          <SkeletonBox className="ml-auto h-4 w-16" />
        </div>
      ))}
      <span className="sr-only">Loading trades…</span>
    </div>
  )
}

export function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-label="Loading trade detail">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <SkeletonBox className="h-6 w-40" />
        <SkeletonBox className="h-4 w-56" />
      </div>
      {/* Metric chips */}
      <div className="flex gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonBox key={i} className="h-10 w-24 rounded-lg" />
        ))}
      </div>
      {/* Timeline */}
      <div className="flex flex-col gap-2">
        <SkeletonBox className="h-4 w-32" />
        <SkeletonBox className="h-24 w-full rounded-lg" />
      </div>
      {/* Tabs area */}
      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonBox key={i} className="h-8 w-20 rounded-md" />
          ))}
        </div>
        <SkeletonBox className="h-32 w-full rounded-lg" />
      </div>
      <span className="sr-only">Loading trade detail…</span>
    </div>
  )
}
