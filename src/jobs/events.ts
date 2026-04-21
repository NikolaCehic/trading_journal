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
