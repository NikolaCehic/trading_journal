import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { TradeDetailBundle } from '~/server/trades'
import { applyPositionTag, removePositionTag, upsertReflection, createTag } from '~/server/journal'
import type { EmotionalState } from '~/domain/journal'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import { toast } from 'sonner'

const EMOTIONS: Array<{ id: EmotionalState; label: string }> = [
  { id: 'calm', label: 'Calm' },
  { id: 'fomo', label: 'FOMO' },
  { id: 'revenge', label: 'Revenge' },
  { id: 'bored', label: 'Bored' },
  { id: 'anxious', label: 'Anxious' },
  { id: 'confident', label: 'Confident' },
]

export function TagsTab({ bundle }: { bundle: TradeDetailBundle }) {
  const pid = bundle.position.id
  const qc = useQueryClient()

  const [newTagLabel, setNewTagLabel] = useState('')
  const [newTagKind, setNewTagKind] = useState<'setup' | 'mistake'>('setup')

  const invalidate = () => qc.invalidateQueries({ queryKey: ['tradeDetail', pid] })

  const applySetup = useMutation({
    mutationFn: (tagId: string) =>
      applyPositionTag({ data: { positionIds: [pid], kind: 'setup', setupTagId: tagId } }),
    onSuccess: invalidate,
    onError: e => toast.error(String((e as Error).message)),
  })
  const applyMistake = useMutation({
    mutationFn: (tagId: string) =>
      applyPositionTag({ data: { positionIds: [pid], kind: 'mistake', mistakeTagId: tagId } }),
    onSuccess: invalidate,
    onError: e => toast.error(String((e as Error).message)),
  })
  const removeSetup = useMutation({
    mutationFn: (tagId: string) =>
      removePositionTag({ data: { positionId: pid, kind: 'setup', setupTagId: tagId } }),
    onSuccess: invalidate,
  })
  const removeMistake = useMutation({
    mutationFn: (tagId: string) =>
      removePositionTag({ data: { positionId: pid, kind: 'mistake', mistakeTagId: tagId } }),
    onSuccess: invalidate,
  })
  const createNew = useMutation({
    mutationFn: () => createTag({ data: { kind: newTagKind, label: newTagLabel } }),
    onSuccess: () => { setNewTagLabel(''); qc.invalidateQueries({ queryKey: ['tradeDetail', pid] }); qc.invalidateQueries({ queryKey: ['tags'] }) },
  })

  const appliedSetup = new Set(bundle.tags.setupTagIds)
  const appliedMistake = new Set(bundle.tags.mistakeTagIds)

  const [confidence, setConfidence] = useState<number | null>(bundle.reflection?.confidence ?? null)
  const [emotion, setEmotion]       = useState<EmotionalState | null>(bundle.reflection?.emotionalState as EmotionalState ?? null)

  const saveReflection = useMutation({
    mutationFn: () => upsertReflection({ data: { positionId: pid, confidence, emotionalState: emotion, reflectionMarkdown: bundle.reflection?.reflectionMarkdown ?? null } }),
    onSuccess: () => { toast.success('Reflection saved'); invalidate() },
    onError: e => toast.error(String((e as Error).message)),
  })

  return (
    <div className="flex flex-col gap-6 mt-2">
      {/* Setup tags */}
      <section>
        <h4 className="text-xs uppercase tracking-wide text-neutral-500 mb-2">Setup</h4>
        <div className="flex flex-wrap gap-2">
          {bundle.availableTags.setup.map(t => {
            const active = appliedSetup.has(t.id)
            return (
              <button
                key={t.id}
                onClick={() => active ? removeSetup.mutate(t.id) : applySetup.mutate(t.id)}
                className={`text-xs rounded-full px-3 py-1 border ${active ? 'border-brand bg-brand/10 text-brand' : 'border-neutral-800 text-neutral-400 hover:text-neutral-200'}`}
              >
                {t.label}
              </button>
            )
          })}
          {bundle.availableTags.setup.length === 0 && (
            <p className="text-xs text-neutral-500">No setup tags yet. Add one below.</p>
          )}
        </div>
      </section>

      {/* Mistake tags */}
      <section>
        <h4 className="text-xs uppercase tracking-wide text-neutral-500 mb-2">Mistakes</h4>
        <div className="flex flex-wrap gap-2">
          {bundle.availableTags.mistake.map(t => {
            const active = appliedMistake.has(t.id)
            return (
              <button
                key={t.id}
                onClick={() => active ? removeMistake.mutate(t.id) : applyMistake.mutate(t.id)}
                className={`text-xs rounded-full px-3 py-1 border ${active ? 'border-pnl-loss bg-pnl-loss/10 text-pnl-loss' : 'border-neutral-800 text-neutral-400 hover:text-neutral-200'}`}
              >
                {t.label}
              </button>
            )
          })}
        </div>
      </section>

      {/* Create tag */}
      <section className="flex items-center gap-2">
        <select
          value={newTagKind}
          onChange={(e) => setNewTagKind(e.target.value as 'setup' | 'mistake')}
          className="bg-neutral-900 border border-neutral-800 rounded-md text-xs px-2 py-1.5"
        >
          <option value="setup">Setup</option>
          <option value="mistake">Mistake</option>
        </select>
        <Input
          value={newTagLabel}
          onChange={(e) => setNewTagLabel(e.target.value)}
          placeholder="New tag label"
          className="h-8 text-xs w-48"
        />
        <Button size="sm" disabled={!newTagLabel.trim() || createNew.isPending} onClick={() => createNew.mutate()}>
          {createNew.isPending ? 'Adding…' : 'Add tag'}
        </Button>
      </section>

      {/* Confidence + emotion */}
      <section className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xs text-neutral-500 uppercase tracking-wide">Confidence</span>
          {[1,2,3,4,5].map(v => (
            <button
              key={v}
              onClick={() => setConfidence(confidence === v ? null : v)}
              className={`h-7 w-7 rounded-full border text-xs font-mono tabular-nums ${confidence === v ? 'border-brand text-brand bg-brand/10' : 'border-neutral-800 text-neutral-400'}`}
              aria-label={`Confidence ${v}`}
            >
              {v}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-neutral-500 uppercase tracking-wide">Emotion</span>
          <Select value={emotion ?? undefined} onValueChange={(v) => setEmotion(v as EmotionalState)}>
            <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              {EMOTIONS.map(e => <SelectItem key={e.id} value={e.id}>{e.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" onClick={() => saveReflection.mutate()} disabled={saveReflection.isPending}>
          {saveReflection.isPending ? 'Saving…' : 'Save'}
        </Button>
      </section>
    </div>
  )
}
