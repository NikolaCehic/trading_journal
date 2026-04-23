import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Card, FindingCard, SeverityDot } from '~/components/tj/primitives'
import type { DashboardFinding } from '~/domain/dashboard'
import type { FindingSeverity } from '~/domain/finding'
import { adoptRule, archiveRule, getRuleViolationsThisWeek } from '~/server/rules'

const RULE_TEXT = "After any loss >1%, don't open a position for 30 minutes."

const DETECTOR_LABELS: Record<string, string> = {
  revenge_trading: 'Revenge trading',
  oversized_positions: 'Oversized positions',
  loss_of_discipline_windows: 'Discipline windows',
  position_sizing_instability: 'Sizing instability',
  cut_winners_ride_losers: 'Cut winners, ride losers',
  overtrading_after_losses: 'Overtrading after losses',
  fee_drag: 'Fee drag',
  scaling_into_losers: 'Scaling into losers',
  short_hold_scalping: 'Short-hold scalping',
  symbol_underperformance: 'Symbol underperformance',
  leverage_creep: 'Leverage creep',
  plan_adherence: 'Plan adherence',
}

function severityToLevel(severity: FindingSeverity): 'red' | 'amber' | 'neutral' {
  if (severity === 'critical') return 'red'
  if (severity === 'warning') return 'amber'
  return 'neutral'
}

function resolveTitle(f: DashboardFinding): string {
  if (f.detectorId.startsWith('custom:')) return f.title
  return DETECTOR_LABELS[f.detectorId] ?? f.title
}

function findingEvidence(f: DashboardFinding): string {
  const full = f.bodyMarkdown
  if (full.length <= 140) return full
  return full.slice(0, 140) + '…'
}

type Props = { findings: DashboardFinding[] }

export function FindingsSidebar({ findings }: Props) {
  const [adoptedRuleId, setAdoptedRuleId] = useState<string | null>(null)

  const adopt = useMutation({
    mutationFn: () =>
      adoptRule({ data: { detectorId: 'revenge_trading', ruleText: RULE_TEXT } }),
    onSuccess: (res) => setAdoptedRuleId(res.ruleId),
  })

  const archive = useMutation({
    mutationFn: (ruleId: string) => archiveRule({ data: { ruleId } }),
    onSuccess: () => setAdoptedRuleId(null),
  })

  const violationsQuery = useQuery({
    queryKey: ['rule-violations', adoptedRuleId],
    queryFn: () => getRuleViolationsThisWeek({ data: { ruleId: adoptedRuleId! } }),
    enabled: !!adoptedRuleId,
    refetchInterval: 60_000,
  })

  const violations = violationsQuery.data?.violations ?? null

  if (findings.length === 0) {
    return (
      <Card title="Findings" subtitle="0 active" style={{ overflow: 'hidden' }}>
        <div
          style={{
            padding: '16px 14px',
            fontSize: 13,
            color: 'var(--fg-subtle)',
          }}
        >
          No active findings.
        </div>
      </Card>
    )
  }

  const top = findings[0]!
  const rest = findings.slice(1)
  const topLevel = severityToLevel(top.severity)

  return (
    <Card title="Findings" subtitle={`${findings.length} active`} style={{ overflow: 'hidden' }}>
      <div>
        {/* Top finding — rule opt-in card */}
        <div
          style={{
            padding: '12px 14px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <SeverityDot level={topLevel} />
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg)' }}>{resolveTitle(top)}</div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--fg-subtle)', lineHeight: 1.5, marginLeft: 14 }}>
            {findingEvidence(top)}
          </div>

          {!top.detectorId.startsWith('custom:') && (
            !adoptedRuleId ? (
              <div style={{ marginLeft: 14, marginTop: 8 }}>
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    color: 'var(--fg-subtle)',
                    marginBottom: 6,
                  }}
                >
                  Suggested rule: {RULE_TEXT}
                </div>
                <button
                  type="button"
                  className="tj-btn tj-btn-sm"
                  disabled={adopt.isPending}
                  onClick={() => adopt.mutate()}
                >
                  {adopt.isPending ? 'Saving…' : 'Adopt this rule'}
                </button>
              </div>
            ) : (
              <div
                style={{
                  marginLeft: 14,
                  marginTop: 8,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <span className="tj-chip tj-chip-accent">
                  Rule active &middot; {violations !== null ? violations : '—'} violation
                  {violations === 1 ? '' : 's'} this week
                </span>
                <button
                  type="button"
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    fontSize: 11,
                    color: 'var(--fg-subtle)',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                  }}
                  disabled={archive.isPending}
                  onClick={() => archive.mutate(adoptedRuleId)}
                >
                  Archive
                </button>
              </div>
            )
          )}
        </div>

        {/* Remaining findings */}
        {rest.map((f, i) => (
          <FindingCard
            key={i + 1}
            level={severityToLevel(f.severity)}
            title={resolveTitle(f)}
            evidence={findingEvidence(f)}
          />
        ))}
      </div>
    </Card>
  )
}
