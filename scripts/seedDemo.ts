#!/usr/bin/env tsx
import { seedDemoUser } from '~/server/demoSeed'

async function main() {
  console.log('Seeding demo user…')
  const result = await seedDemoUser()
  console.log(`Seeded: ${result.fills} fills → ${result.positions} positions → ${result.findings} findings`)
  console.log(`Demo user id: ${result.userId}`)
  process.exit(0)
}

main().catch((err) => { console.error(err); process.exit(1) })
