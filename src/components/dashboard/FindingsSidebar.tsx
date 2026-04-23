import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Card, FindingCard, SeverityDot } from '~/components/tj/primitives'
import { findings } from './mockData'
import { adoptRule, archiveRule, getRuleViolationsThisWeek } from '~/server/rules'

const RULE_TEXT = "After any loss >1%, don't open a position for 30 minutes."

export function FindingsSidebar() {
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

  const top = findings[0]!
  const rest = findings.slice(1)

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
            <SeverityDot level={top.level} />
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg)' }}>{top.title}</div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--fg-subtle)', lineHeight: 1.5, marginLeft: 14 }}>
            {top.evidence}
          </div>

          {!adoptedRuleId ? (
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
          )}
        </div>

        {/* Remaining findings */}
        {rest.map((f, i) => (
          <FindingCard key={i + 1} level={f.level} title={f.title} evidence={f.evidence} />
        ))}
      </div>
    </Card>
  )
}
