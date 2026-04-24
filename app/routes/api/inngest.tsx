import { createFileRoute } from '@tanstack/react-router'
import { serve } from 'inngest/remix'
import { inngest } from '~/jobs/client'
import { functions } from '~/jobs/functions'

const handler = serve({ client: inngest, functions })

export const Route = createFileRoute('/api/inngest')({
  server: {
    handlers: {
      GET: ({ request }) => handler({ request }),
      POST: ({ request }) => handler({ request }),
      PUT: ({ request }) => handler({ request }),
    },
  },
})
