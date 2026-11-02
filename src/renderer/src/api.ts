import type { WikiApi } from '../../shared/types'

export const wiki: WikiApi = window.wiki

/** Macht aus IPC-Fehlern ("Error invoking remote method …: Error: Text") wieder den reinen Text. */
export function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw.replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '')
}

// Offene, noch nicht gespeicherte Änderungen (entprellte Editor-Speicherungen).
const pending = new Map<string, () => Promise<void>>()

export function setPending(key: string, flush: (() => Promise<void>) | null): void {
  if (flush) pending.set(key, flush)
  else pending.delete(key)
}

export function hasPending(): boolean {
  return pending.size > 0
}

export async function flushPending(): Promise<void> {
  const tasks = [...pending.values()]
  pending.clear()
  await Promise.allSettled(tasks.map((t) => t()))
}
