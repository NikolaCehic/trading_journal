import { eq } from 'drizzle-orm'
import { importRecord, rawImportRow } from '~/db/schema/ingestion'
import { fill as fillTable } from '~/db/schema/canonical'
import type { DB } from '~/db/client'
import type { SourceAdapter } from '~/domain/adapter'
import { log } from '~/lib/log'

type RunImportArgs<TInput> = {
  importId: string
  userId: string
  adapter: SourceAdapter<TInput>
  input: TInput
}

type RunImportResult = {
  fillCount: number
  skippedCount: number
  erroredCount: number
}

export class Orchestrator {
  constructor(private readonly db: DB) {}

  async runImport<TInput>(args: RunImportArgs<TInput>): Promise<RunImportResult> {
    const { importId, userId, adapter, input } = args
    let fillCount = 0
    let skippedCount = 0
    let erroredCount = 0

    await this._updateStatus(importId, 'parsing')
    await this._updateStatus(importId, 'normalizing')

    for await (const rawRow of adapter.parse(input, importId)) {
      const rawRowId = `rr_${importId}_${rawRow.rowIndex}`
      try {
        await this.db.insert(rawImportRow).values({
          id: rawRowId,
          importId,
          userId,
          rowIndex: rawRow.rowIndex,
          rawData: rawRow.raw,
          normalizeStatus: 'normalized',
        }).onConflictDoNothing()
      } catch (err) {
        log.warn('Failed to persist raw row', { importId, rowIndex: rawRow.rowIndex, err: String(err) })
      }

      let canonicalFill
      try {
        canonicalFill = adapter.normalize(rawRow)
      } catch (err) {
        log.warn('normalize threw', { importId, rowIndex: rawRow.rowIndex, err: String(err) })
        canonicalFill = null
      }

      if (!canonicalFill) {
        skippedCount++
        try {
          await this.db.update(rawImportRow)
            .set({ normalizeStatus: 'skipped' })
            .where(eq(rawImportRow.id, rawRowId))
        } catch { /* non-fatal */ }
        continue
      }

      const fillId = `fill_${userId}_${canonicalFill.exchange}_${canonicalFill.externalId}`.slice(0, 128)
      try {
        // Data H-03: only increment fillCount when a row actually made it in.
        // `onConflictDoNothing` silently skips duplicates, so we rely on the
        // length of `.returning(...)` to detect whether an insert occurred.
        const inserted = await this.db.insert(fillTable).values({
          id: fillId,
          userId,
          exchange: canonicalFill.exchange,
          symbol: canonicalFill.symbol,
          instrumentType: canonicalFill.instrumentType,
          side: canonicalFill.side,
          price: canonicalFill.price,
          size: canonicalFill.size,
          fee: canonicalFill.fee,
          feeCurrency: canonicalFill.feeCurrency,
          executedAt: canonicalFill.executedAt,
          externalId: canonicalFill.externalId,
          rawImportRowId: rawRowId,
          normalizerHint: canonicalFill.normalizerHint ?? null,
        }).onConflictDoNothing().returning({ id: fillTable.id })

        if (inserted.length > 0) fillCount++
      } catch (err) {
        erroredCount++
        log.error('Failed to persist fill', { importId, externalId: canonicalFill.externalId, err: String(err) })
      }
    }

    await this.db.update(importRecord)
      .set({
        status: 'complete',
        fillCount,
        skippedCount,
        completedAt: new Date(),
      })
      .where(eq(importRecord.id, importId))

    return { fillCount, skippedCount, erroredCount }
  }

  private async _updateStatus(importId: string, status: 'parsing' | 'normalizing' | 'complete' | 'failed') {
    try {
      await this.db.update(importRecord)
        .set({ status, startedAt: status === 'parsing' ? new Date() : undefined })
        .where(eq(importRecord.id, importId))
    } catch (err) {
      log.warn('Could not update import status', { importId, status, err: String(err) })
    }
  }
}
