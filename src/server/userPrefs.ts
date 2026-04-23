import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { auth } from '~/auth/server'
import { assertNotDemo } from '~/auth/assertNotDemo'
import { db } from '~/db/client'
import { user } from '~/db/schema/auth'
import { BUILTIN_DETECTOR_IDS } from '~/domain/finding'

const setTimezoneInput = z.object({
  timezone: z.string().min(1).max(64), // IANA tz strings like 'Europe/Berlin'
})

export const setTimezone = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => setTimezoneInput.parse(d))
  .handler(async ({ data }) => {
    const session = await auth.api.getSession({ headers: getRequest().headers })
    if (!session?.user) throw new Error('Unauthorized')
    // Validate the tz is a real one the runtime recognizes
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: data.timezone })
    } catch {
      throw new Error('invalid_timezone')
    }
    await db.update(user).set({ timezone: data.timezone }).where(eq(user.id, session.user.id))
    return { ok: true, timezone: data.timezone }
  })

export const setDigestEnabled = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => z.object({ enabled: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    const session = await auth.api.getSession({ headers: getRequest().headers })
    if (!session?.user) throw new Error('Unauthorized')
    assertNotDemo(session.user)
    await db.update(user).set({ digestEnabled: data.enabled }).where(eq(user.id, session.user.id))
    return { ok: true, enabled: data.enabled }
  })

export const setBuiltinDetectorEnabled = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => z.object({
    detectorId: z.enum(BUILTIN_DETECTOR_IDS),
    enabled: z.boolean(),
  }).parse(d))
  .handler(async ({ data }) => {
    const session = await auth.api.getSession({ headers: getRequest().headers })
    if (!session?.user) throw new Error('Unauthorized')
    assertNotDemo(session.user)
    const userId = session.user.id

    const [row] = await db.select({ disabled: user.disabledBuiltinDetectors })
      .from(user).where(eq(user.id, userId)).limit(1)
    const current = new Set(row?.disabled ?? [])

    if (data.enabled) current.delete(data.detectorId)
    else current.add(data.detectorId)

    await db.update(user)
      .set({ disabledBuiltinDetectors: Array.from(current) })
      .where(eq(user.id, userId))

    return { ok: true, enabled: data.enabled, disabled: Array.from(current) }
  })

export const getBuiltinDetectorSettings = createServerFn({ method: 'GET' })
  .handler(async (): Promise<{ disabled: string[] }> => {
    const session = await auth.api.getSession({ headers: getRequest().headers })
    if (!session?.user) throw new Error('Unauthorized')
    const [row] = await db.select({ disabled: user.disabledBuiltinDetectors })
      .from(user).where(eq(user.id, session.user.id)).limit(1)
    return { disabled: row?.disabled ?? [] }
  })
