'use client'

import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import { useQueryClient } from '@tanstack/react-query'
import { Textarea } from '~/components/ui/textarea'
import { Button } from '~/components/ui/button'
import { useAutosave } from '~/hooks/useAutosave'
import { upsertTradeNote } from '~/server/journal'
import type { TradeDetailBundle } from '~/server/trades'

export function NotesTab({ bundle }: { bundle: TradeDetailBundle }) {
  const positionId = bundle.position.id
  const queryClient = useQueryClient()

  const [body, setBody] = useState(bundle.note?.bodyMarkdown ?? '')
  const [preview, setPreview] = useState(false)

  const status = useAutosave(body, async (value) => {
    await upsertTradeNote({ data: { positionId, bodyMarkdown: value } })
    await queryClient.invalidateQueries({ queryKey: ['tradeDetail', positionId] })
  })

  return (
    <div className="flex flex-col gap-3 py-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-neutral-500">
          {status === 'saving' && 'Saving…'}
          {status === 'saved' && 'Saved.'}
          {status === 'error' && (
            <span className="text-pnl-loss">Save failed — changes are local.</span>
          )}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setPreview((v) => !v)}
          className="text-xs"
        >
          {preview ? 'Edit' : 'Preview'}
        </Button>
      </div>

      {/* Editor / Preview */}
      {preview ? (
        <div className="prose prose-invert prose-sm max-w-none rounded-md border border-neutral-800 bg-neutral-900/40 p-4 min-h-40">
          {body.trim() ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
              {body}
            </ReactMarkdown>
          ) : (
            <span className="text-neutral-500 italic">Nothing to preview.</span>
          )}
        </div>
      ) : (
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write your trade notes here… markdown is supported."
          className="min-h-40 resize-y font-mono text-sm"
          autoFocus
        />
      )}
    </div>
  )
}
