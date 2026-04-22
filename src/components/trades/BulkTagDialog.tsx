import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '~/components/ui/dialog'
import { Button } from '~/components/ui/button'
import { applyPositionTag } from '~/server/journal'
import { toast } from 'sonner'

export function BulkTagDialog({
  open,
  onOpenChange,
  positionIds,
  availableTags,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  positionIds: string[]
  availableTags: {
    setup: { id: string; label: string; color?: string | null }[]
    mistake: { id: string; label: string; color?: string | null }[]
  }
}) {
  const [kind, setKind] = useState<'setup' | 'mistake'>('setup')
  const [tagId, setTagId] = useState<string | null>(null)
  const qc = useQueryClient()

  const m = useMutation({
    mutationFn: async () => {
      if (!tagId) return
      return applyPositionTag({
        data: {
          positionIds,
          kind,
          setupTagId: kind === 'setup' ? tagId : undefined,
          mistakeTagId: kind === 'mistake' ? tagId : undefined,
        },
      })
    },
    onSuccess: (res) => {
      toast.success(`Tagged ${res?.applied ?? 0} trade${res?.applied === 1 ? '' : 's'}`)
      qc.invalidateQueries({ queryKey: ['tradeList'] })
      onOpenChange(false)
    },
    onError: (err) => toast.error(`Failed: ${String((err as Error).message)}`),
  })

  const options = kind === 'setup' ? availableTags.setup : availableTags.mistake

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Tag {positionIds.length} trade{positionIds.length === 1 ? '' : 's'}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex gap-2 text-xs">
            <Button
              variant={kind === 'setup' ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                setKind('setup')
                setTagId(null)
              }}
            >
              Setup
            </Button>
            <Button
              variant={kind === 'mistake' ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                setKind('mistake')
                setTagId(null)
              }}
            >
              Mistake
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {options.length === 0 && (
              <p className="text-xs text-neutral-500">
                No {kind} tags yet. Create one from a trade detail page first.
              </p>
            )}
            {options.map((t) => (
              <button
                key={t.id}
                onClick={() => setTagId(t.id)}
                className={`text-xs rounded-full px-2 py-1 border ${
                  tagId === t.id
                    ? 'border-brand bg-brand/10 text-brand'
                    : 'border-neutral-800 text-neutral-300 hover:border-neutral-600'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!tagId || m.isPending} onClick={() => m.mutate()}>
            {m.isPending ? 'Applying…' : 'Apply tag'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
