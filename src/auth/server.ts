import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { db } from '~/db/client'
import { env } from '~/lib/env'
import { ensureDefaultMistakeTags } from '~/server/seedJournal'

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg' }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  emailAndPassword: { enabled: false },
  socialProviders: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  user: {
    additionalFields: {
      isDemo: {
        type: 'boolean',
        required: true,
        defaultValue: false,
        input: false,
      },
    },
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          try {
            await ensureDefaultMistakeTags(db, user.id)
          } catch (err) {
            console.warn('seed mistake tags failed', { userId: user.id, err: String(err) })
          }
        },
      },
    },
  },
})

export type AuthSession = typeof auth.$Infer.Session
