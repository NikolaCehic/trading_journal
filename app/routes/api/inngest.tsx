import { createAPIFileRoute } from '@tanstack/start/api'
import { serve } from 'inngest/cloudflare'
import { inngest } from '~/jobs/client'
import { functions } from '~/jobs/functions'

const handler = serve({ client: inngest, functions })

export const APIRoute = createAPIFileRoute('/api/inngest')({
  GET: ({ request }) => handler.GET(request),
  POST: ({ request }) => handler.POST(request),
  PUT: ({ request }) => handler.PUT(request),
})
