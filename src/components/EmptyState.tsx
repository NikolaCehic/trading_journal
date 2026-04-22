import { Link } from '@tanstack/react-router'

interface EmptyStateProps {
  title: string
  body?: string
  action?: {
    label: string
    to: '/import' | '/trades' | '/dashboard'
  }
}

export function EmptyState({ title, body, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {body && <p className="max-w-xs text-sm text-muted-foreground">{body}</p>}
      {action && (
        <Link
          to={action.to}
          className="mt-2 inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600"
        >
          {action.label}
        </Link>
      )}
    </div>
  )
}
