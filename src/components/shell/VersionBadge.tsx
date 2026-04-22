import { DERIVATION_VERSION } from '~/derivation/version'

export function VersionBadge() {
  return (
    <span
      title="Analysis engine version — bumps when detector logic changes"
      className="inline-flex items-center rounded-md border border-neutral-800 bg-neutral-900 px-2 py-0.5 text-xs text-neutral-400 font-mono tabular-nums"
    >
      v{DERIVATION_VERSION}
    </span>
  )
}
