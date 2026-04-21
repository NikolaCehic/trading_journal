import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import type { Config } from 'drizzle-kit'

const url = process.env['DIRECT_URL'] ?? process.env['DATABASE_URL']
if (!url) throw new Error('DATABASE_URL (or DIRECT_URL) must be set for drizzle-kit')

export default {
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
  strict: true,
  verbose: true,
} satisfies Config
