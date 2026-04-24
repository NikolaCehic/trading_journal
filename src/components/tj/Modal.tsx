import { useEffect, useId, useRef } from 'react'
import type { CSSProperties, ReactNode } from 'react'

const FOCUSABLE_SELECTOR =
  'button, [href], input:not([disabled]), textarea, select, [tabindex]:not([tabindex="-1"])'

export interface ModalProps {
  /** Whether the dialog is visible. When false, the component renders nothing. */
  open: boolean
  /** Called when the user dismisses the dialog (Escape, backdrop click, etc.). */
  onClose: () => void
  /** Title rendered at the top of the dialog; used for aria-labelledby. */
  title: ReactNode
  /** Dialog body. */
  children: ReactNode
  /**
   * Optional override for the inner dialog `<div>` style. Merged onto the
   * default .tj-card container styles (maxWidth, padding, overflow, etc.).
   */
  style?: CSSProperties
  /** Optional max-width override (px or any CSS length). Defaults to 480. */
  maxWidth?: number | string
}

/**
 * Accessible modal dialog primitive.
 *
 * - Backdrop covers the viewport and calls `onClose` on click.
 * - Inner dialog has `role="dialog"` + `aria-modal="true"` +
 *   `aria-labelledby` wired to a `useId`-generated title id.
 * - Focus is trapped inside the dialog while open; Tab/Shift-Tab cycle the
 *   tabbable elements, and Escape triggers `onClose`.
 * - On open, the currently-focused element is captured and restored on close.
 */
export function Modal({ open, onClose, title, children, style, maxWidth = 480 }: ModalProps) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  // Focus management: capture previous focus, focus first focusable inside,
  // trap Tab within, and restore on close.
  useEffect(() => {
    if (!open) return

    previousFocusRef.current = document.activeElement as HTMLElement | null

    const dialog = dialogRef.current
    if (dialog) {
      const focusables = dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      if (focusables.length > 0) {
        focusables[0]!.focus()
      } else {
        dialog.focus()
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const node = dialogRef.current
      if (!node) return
      const focusables = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => !el.hasAttribute('disabled') && el.tabIndex !== -1,
      )
      if (focusables.length === 0) {
        e.preventDefault()
        return
      }
      const first = focusables[0]!
      const last = focusables[focusables.length - 1]!
      const active = document.activeElement as HTMLElement | null
      if (e.shiftKey) {
        if (active === first || !node.contains(active)) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (active === last || !node.contains(active)) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      const prev = previousFocusRef.current
      if (prev && typeof prev.focus === 'function') {
        prev.focus()
      }
      previousFocusRef.current = null
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 50,
      }}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="tj-card"
        onClick={(e) => e.stopPropagation()}
        style={{
          padding: 24,
          maxWidth,
          width: '90vw',
          maxHeight: '80vh',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          ...style,
        }}
      >
        <h2
          id={titleId}
          style={{
            margin: 0,
            fontSize: 16,
            fontWeight: 600,
            color: 'var(--fg)',
            letterSpacing: '-0.01em',
          }}
        >
          {title}
        </h2>
        {children}
      </div>
    </div>
  )
}

/**
 * Convenience footer row for modal action buttons. Right-aligns its children
 * and applies standard spacing. Purely presentational — use any markup you
 * like, this is just the pattern the two existing dialogs share.
 */
export function ModalFooter({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'flex-end',
        gap: 8,
        marginTop: 4,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

export default Modal
