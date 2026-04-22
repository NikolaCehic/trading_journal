import { inngest } from './client'

export type IngestionCompletePayload = {
  name: 'ingestion/complete'
  data: {
    importId: string
    userId: string
    newFillCount: number
  }
}

export type HLWalletPullPayload = {
  name: 'ingestion/hl-wallet-pull'
  data: {
    importId: string
    userId: string
    walletAddress: string
    exchangeAccountId: string
  }
}

export async function sendIngestionComplete(payload: IngestionCompletePayload['data']) {
  await inngest.send({ name: 'ingestion/complete', data: payload })
}

export async function sendHLWalletPull(payload: HLWalletPullPayload['data']) {
  await inngest.send({ name: 'ingestion/hl-wallet-pull', data: payload })
}

export type DerivationCompletePayload = {
  name: 'derivation/complete'
  data: { userId: string; derivationVersion: number; positionCount: number; findingCount: number }
}
export type DerivationRederivePayload = {
  name: 'derivation/rederive'
  data: { userId: string; derivationVersion: number }
}
export async function sendDerivationComplete(data: DerivationCompletePayload['data']) {
  await inngest.send({ name: 'derivation/complete', data })
}
export async function sendDerivationRederive(data: DerivationRederivePayload['data']) {
  await inngest.send({ name: 'derivation/rederive', data })
}

export type DigestComposePayload = {
  name: 'digest/compose'
  data: { userId: string; isoWeek: string }
}

export type DigestSendPayload = {
  name: 'digest/send'
  data: { userId: string; digestRunId: string }
}

export async function sendDigestCompose(data: DigestComposePayload['data']) {
  await inngest.send({ name: 'digest/compose', data })
}

export async function sendDigestSend(data: DigestSendPayload['data']) {
  await inngest.send({ name: 'digest/send', data })
}
