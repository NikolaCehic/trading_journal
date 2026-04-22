import Anthropic from '@anthropic-ai/sdk'
import { env } from '~/lib/env'

const MODEL = process.env['NARRATOR_MODEL'] ?? 'claude-sonnet-4-6'
const TIMEOUT_MS = 20_000

export type LlmCallResult = {
  content: string
  usage: { tokensIn: number; tokensOut: number }
}

export type LlmCallInput = {
  system: string
  user: string
  maxTokens?: number
  temperature?: number
}

export async function callLlm(input: LlmCallInput): Promise<LlmCallResult> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY as string })
  const resp = await client.messages.create(
    {
      model: MODEL,
      system: input.system,
      messages: [{ role: 'user', content: input.user }],
      max_tokens: input.maxTokens ?? 1024,
      temperature: input.temperature ?? 0.4,
    },
    { timeout: TIMEOUT_MS },
  )

  const text = resp.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
  return {
    content: text,
    usage: { tokensIn: resp.usage.input_tokens, tokensOut: resp.usage.output_tokens },
  }
}
