import type { MenuAction } from '../../shared/types'
import { errorMessage, flushPending, wiki } from './api'
import { useWiki } from './store'

/** Menü- und Knopfaktionen, die nicht an einen einzelnen Artikel gebunden sind. */
export async function runAction(action: MenuAction): Promise<void> {
  const s = useWiki.getState()
  try {
    switch (action) {
      case 'new-db':
      case 'open-db': {
        await flushPending()
        const switched = action === 'new-db' ? await wiki.newDb() : await wiki.openDb()
        if (switched) {
          await useWiki.getState().loadAll()
          const info = useWiki.getState().dbInfo
          s.toast(`Wiki „${info?.name ?? ''}“ geöffnet.`)
        }
        break
      }
      case 'backup-db': {
        await flushPending()
        const file = await wiki.backupDb()
        if (file) s.toast(`Sicherung gespeichert: ${file}`)
        break
      }
      case 'reveal-db':
        await wiki.revealDb()
        break
      case 'search':
      case 'trash':
      case 'outages':
      case 'changes':
      case 'user-name':
      case 'shortcuts':
      case 'about':
        s.setDialog(action)
        break
      case 'toggle-links':
        s.toggleLinks()
        break
      case 'fit':
        s.requestFit()
        break
    }
  } catch (err) {
    s.toast(errorMessage(err), 'error')
  }
}
