import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { auth } from '~/auth/server'
import { db } from '~/db/client'
import { user } from '~/db/schema/auth'

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
