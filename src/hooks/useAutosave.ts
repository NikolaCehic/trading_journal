import { useEffect, useRef, useState } from 'react'

export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error'

/**
 * Debounced autosave hook.
 *
 * Uses a ref for the latest `save` callback so a new closure on every render
 * does NOT reset the debounce timer — only changes to `value` or `delayMs`
 * trigger a reschedule.
 */
export function useAutosave<T>(
  value: T,
  save: (v: T) => Promise<void>,
  delayMs = 1200,
): AutosaveStatus {
  const [status, setStatus] = useState<AutosaveStatus>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestValue = useRef(value)
  latestValue.current = value
  const latestSave = useRef(save)
  latestSave.current = save

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      try {
        setStatus('saving')
        await latestSave.current(latestValue.current)
        setStatus('saved')
      } catch {
        setStatus('error')
      }
    }, delayMs)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [value, delayMs])

  return status
}
