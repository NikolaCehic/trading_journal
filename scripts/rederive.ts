#!/usr/bin/env tsx
import { db } from '~/db/client'
import { user } from '~/db/schema/auth'
import { runDerivation } from '~/derivation/runner'
import { DERIVATION_VERSION } from '~/derivation/version'

function parseArg(flag: string): string | undefined {
  const prefix = `${flag}=`
  for (const arg of process.argv) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length)
  }
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const userArg = parseArg('--user')
  const versionArg = parseArg('--version')
  const version = versionArg ? parseInt(versionArg, 10) : DERIVATION_VERSION

  const users = userArg
    ? [{ id: userArg }]
    : await db.select({ id: user.id }).from(user)

  console.log(`Rederiving ${users.length} user(s) at version ${version}…`)
  for (const u of users) {
    const res = await runDerivation({ db, userId: u.id, version })
    console.log(`  ${u.id}: ${res.positionCount} positions, ${res.findingCount} findings`)
  }
  process.exit(0)
}

main().catch(err => { console.error(err); process.exit(1) })
