import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import type { DB } from '~/db/client'

const TEST_USER_ID = 'test_idempotency_user'
const IMPORT_ID_1 = `imp_idem_test_${Date.now()}_1`
const IMPORT_ID_2 = `imp_idem_test_${Date.now()}_2`

const hasDb = !!process.env['DATABASE_URL'] && !process.env['DATABASE_URL']?.includes('x:x@localhost')

describe.skipIf(!hasDb)('Idempotent re-import (requires real DB)', () => {
  let db: DB
  let fillTable: typeof import('~/db/schema/canonical')['fill']
  let importRecord: typeof import('~/db/schema/ingestion')['importRecord']

  beforeAll(async () => {
    const dbModule = await import('~/db/client')
    const canonicalModule = await import('~/db/schema/canonical')
    const ingestionModule = await import('~/db/schema/ingestion')
    db = dbModule.db
    fillTable = canonicalModule.fill
    importRecord = ingestionModule.importRecord

    // Seed test user row
    const { sql } = await import('drizzle-orm')
    try {
      await db.execute(
        sql`INSERT INTO "user" (id, email, email_verified, is_demo, created_at, updated_at)
            VALUES (${TEST_USER_ID}, 'idem_test@test.invalid', false, false, NOW(), NOW())
            ON CONFLICT (id) DO NOTHING`
      )
    } catch { /* already exists */ }

    // Cleanup before test
    const { eq } = await import('drizzle-orm')
    await db.delete(fillTable).where(eq(fillTable.userId, TEST_USER_ID))
    await db.delete(importRecord).where(eq(importRecord.userId, TEST_USER_ID))
  })

  afterAll(async () => {
    const { eq } = await import('drizzle-orm')
    await db.delete(fillTable).where(eq(fillTable.userId, TEST_USER_ID))
    await db.delete(importRecord).where(eq(importRecord.userId, TEST_USER_ID))
  })

  it('first import creates fills', async () => {
    const { eq, count } = await import('drizzle-orm')
    const spotCsv = readFileSync(resolve('fixtures/binance-spot-sample.csv'), 'utf8')

    await db.insert(importRecord).values({
      id: IMPORT_ID_1,
      userId: TEST_USER_ID,
      exchange: 'binance',
      source: 'binance-csv',
      status: 'pending',
    })

    const { BinanceCsvAdapter } = await import('~/ingestion/adapters/binance-csv')
    const { Orchestrator } = await import('~/ingestion/orchestrator')

    const adapter = new BinanceCsvAdapter()
    const orch = new Orchestrator(db)
    const result = await orch.runImport({
      importId: IMPORT_ID_1,
      userId: TEST_USER_ID,
      adapter,
      input: spotCsv,
    })

    expect(result.fillCount).toBeGreaterThan(0)

    const [row] = await db.select({ n: count() }).from(fillTable)
      .where(eq(fillTable.userId, TEST_USER_ID))
    expect(row!.n).toBe(result.fillCount)
  })

  it('re-importing the same CSV produces zero new fills in the DB', async () => {
    const { eq, count } = await import('drizzle-orm')
    const spotCsv = readFileSync(resolve('fixtures/binance-spot-sample.csv'), 'utf8')

    await db.insert(importRecord).values({
      id: IMPORT_ID_2,
      userId: TEST_USER_ID,
      exchange: 'binance',
      source: 'binance-csv',
      status: 'pending',
    })

    const [before] = await db.select({ n: count() }).from(fillTable)
      .where(eq(fillTable.userId, TEST_USER_ID))

    const { BinanceCsvAdapter } = await import('~/ingestion/adapters/binance-csv')
    const { Orchestrator } = await import('~/ingestion/orchestrator')

    const adapter = new BinanceCsvAdapter()
    const orch = new Orchestrator(db)
    await orch.runImport({
      importId: IMPORT_ID_2,
      userId: TEST_USER_ID,
      adapter,
      input: spotCsv,
    })

    const [after] = await db.select({ n: count() }).from(fillTable)
      .where(eq(fillTable.userId, TEST_USER_ID))

    expect(after!.n).toBe(before!.n)
  })
})
