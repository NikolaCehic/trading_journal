import { neon, Pool, neonConfig } from '@neondatabase/serverless'
import { drizzle as drizzleHttp } from 'drizzle-orm/neon-http'
import { drizzle as drizzleWs } from 'drizzle-orm/neon-serverless'
import * as schema from './schema'

const databaseUrl = process.env['DATABASE_URL']
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required. Set it in your environment or .env.local.')
}

// HTTP client — fast, fetch-based, used everywhere EXCEPT transactional writes.
// Fine for short queries but caps payload size (ceiling is a few MB) and has no
// transaction support.
const sql = neon(databaseUrl)
export const db = drizzleHttp(sql, { schema })
export type DB = typeof db

// WebSocket client — supports real transactions of arbitrary size. Used only
// by `persistDerivation` (and any future large transactional writes) because
// the Neon HTTP batch endpoint 413s on 40M+ wallets with thousands of rows.
// Prefer DIRECT_URL (non-pooled) for WS; the pooler endpoint rejects long-
// lived WS sessions.
const wsUrl = process.env['DIRECT_URL'] ?? databaseUrl
if (typeof globalThis.WebSocket !== 'undefined') {
  neonConfig.webSocketConstructor = globalThis.WebSocket
}
const pool = new Pool({ connectionString: wsUrl })
export const dbTx = drizzleWs(pool, { schema })
export type DBTx = typeof dbTx
