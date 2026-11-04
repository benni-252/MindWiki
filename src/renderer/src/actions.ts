import type { MenuAction } from '../../shared/types'
import { errorMessage, flushPending, wiki } from './api'
import { useWiki } from './store'

/** Menü- und Knopfaktionen, die nicht an einen einzelnen Artikel gebunden sind. */
export async function runAction(action: MenuAction): Promise<void> {
  const s = useWiki.getState()
  try {
    switch (action) {
      case 'new-db':
      case 'open-db':
      case 'sample-db': {
        if (!(await s.confirmLeave('wiki'))) break
        const switched =
          action === 'new-db' ? await wiki.newDb() : action === 'open-db' ? await wiki.openDb() : await wiki.openSampleDb()
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
      case 'approvals':
      case 'shortcuts':
      case 'about':
        s.setDialog(action)
        break
      case 'logout':
        await s.logout()
        break
      case 'change-password':
        if (s.session) s.setDialog('change-password')
        break
      case 'users':
        if (s.can('admin')) s.setDialog('users')
        else if (s.session) s.toast('Nur der Admin kann Benutzer verwalten.', 'error')
        break
      case 'save':
        if (s.session) await s.saveNow()
        break
      case 'export-pdf':
        if (s.session && s.tree) await s.exportPdf(s.selectedId ?? s.tree.rootId)
        break
      case 'check-updates':
        s.setDialog('update')
        s.setUpdate(await wiki.checkForUpdates())
        break
      case 'auto-layout':
        if (s.tree) await s.resetLayout(s.tree.rootId)
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
