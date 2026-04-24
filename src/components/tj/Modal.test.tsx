// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { Modal } from './Modal'

afterEach(() => {
  cleanup()
})

describe('<Modal />', () => {
  it('renders role="dialog" with aria-modal="true" when open', () => {
    render(
      <Modal open onClose={() => {}} title="Test title">
        <div>body</div>
      </Modal>,
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    // Title is rendered and wired via aria-labelledby
    const labelId = dialog.getAttribute('aria-labelledby')
    expect(labelId).toBeTruthy()
    const heading = document.getElementById(labelId!)
    expect(heading).not.toBeNull()
    expect(heading!.textContent).toBe('Test title')
  })

  it('renders nothing when !open', () => {
    const { container } = render(
      <Modal open={false} onClose={() => {}} title="Hidden">
        <div>body</div>
      </Modal>,
    )
    expect(container.firstChild).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} title="Esc test">
        <button type="button">inside</button>
      </Modal>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose on backdrop click but not on inner click', () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} title="Click test">
        <button type="button" data-testid="inner-btn">
          inside
        </button>
      </Modal>,
    )
    const dialog = screen.getByRole('dialog')
    // The backdrop is the dialog's parent element.
    const backdrop = dialog.parentElement as HTMLElement
    expect(backdrop).not.toBeNull()

    // Clicking the inner dialog should NOT trigger onClose.
    fireEvent.click(screen.getByTestId('inner-btn'))
    fireEvent.click(dialog)
    expect(onClose).not.toHaveBeenCalled()

    // Clicking the backdrop itself should trigger onClose.
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
