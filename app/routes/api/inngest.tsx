import { createFileRoute } from '@tanstack/react-router'
import { serve } from 'inngest/cloudflare'
import { inngest } from '~/jobs/client'
import { functions } from '~/jobs/functions'

const handler = serve({ client: inngest, functions }) as (
  arg: { request: Request; env: Record<string, string | undefined> }
) => Promise<Response>

export const Route = createFileRoute('/api/inngest')({
  server: {
    handlers: {
      GET: ({ request }) => handler({ request, env: {} }),
      POST: ({ request }) => handler({ request, env: {} }),
      PUT: ({ request }) => handler({ request, env: {} }),
    },
  },
})
