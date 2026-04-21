import { createAPIFileRoute } from '@tanstack/start/api'
import { serve } from 'inngest/cloudflare'
import { inngest } from '~/jobs/client'
import { functions } from '~/jobs/functions'

// inngest v4 serve() returns a handler compatible with Cloudflare Pages
const handler = serve({ client: inngest, functions }) as (
  arg: { request: Request; env: Record<string, string | undefined> }
) => Promise<Response>

export const APIRoute = createAPIFileRoute('/api/inngest')({
  GET: ({ request }) => handler({ request, env: {} }),
  POST: ({ request }) => handler({ request, env: {} }),
  PUT: ({ request }) => handler({ request, env: {} }),
})
