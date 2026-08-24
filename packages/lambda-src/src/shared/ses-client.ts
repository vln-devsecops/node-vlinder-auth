import { SESv2Client } from '@aws-sdk/client-sesv2'

let sesClient: SESv2Client | undefined

export function getSesClient(): SESv2Client {
  if (!sesClient) {
    sesClient = new SESv2Client({})
  }
  return sesClient
}
