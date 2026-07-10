export const calls: Array<{ event: unknown; context: unknown }> = []

export default function onHookInvoked(event: unknown, context: unknown): void {
  calls.push({ event, context })
}
