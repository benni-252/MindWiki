import { create } from 'zustand'
import { findTemplate } from '../../shared/templates'
import type { DbInfo, TreeData } from '../../shared/types'
import { errorMessage, flushPending, wiki } from './api'
import { countSubtree, impactOf, indexTree, pathTo } from './treeUtils'

export type DialogKind = 'search' | 'trash' | 'outages' | 'shortcuts' | 'about' | null

export interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
}

interface Toast {
  id: number
  text: string
  kind: 'info' | 'error'
}

/** true: Knoten sichtbar machen; 'flash': zusätzlich kurz hervorheben */
export type CenterMode = boolean | 'flash'

interface State {
  tree: TreeData | null
  dbInfo: DbInfo | null
  selectedId: number | null
  panelOpen: boolean
  panelMax: boolean
  readMode: boolean
  showLinks: boolean
  renamingId: number | null
  dialog: DialogKind
  toasts: Toast[]
  confirmRequest: (ConfirmOptions & { resolve: (ok: boolean) => void }) | null
  /** Bitte an die Mind Map, einen Knoten sichtbar zu machen (und ggf. hervorzuheben) */
  centerRequest: { id: number; nonce: number; flash: boolean } | null
  fitNonce: number
  /** Steigt, wenn sich Inhalt/Felder/Abläufe eines Artikels von außen geändert haben (Vorlage) */
  articleVersion: number

  loadAll(): Promise<void>
  loadTree(): Promise<void>
  select(id: number | null, center?: CenterMode): void
  openArticle(id: number, center?: CenterMode): void
  closePanel(): void
  setPanelMax(max: boolean): void
  setReadMode(read: boolean): void
  toggleLinks(): void
  setRenaming(id: number | null): void
  setDialog(dialog: DialogKind): void
  toast(text: string, kind?: Toast['kind']): void
  confirm(options: ConfirmOptions): Promise<boolean>
  requestFit(): void

  createChild(parentId: number, templateId?: string | null): Promise<void>
  createSibling(id: number, templateId?: string | null): Promise<void>
  rename(id: number, title: string): Promise<void>
  setColor(id: number, color: string | null): Promise<void>
  setIcon(id: number, icon: string | null): Promise<void>
  applyTemplate(id: number, templateId: string): Promise<void>
  toggleCollapsed(id: number): Promise<void>
  move(id: number, newParentId: number): Promise<void>
  reorder(id: number, direction: -1 | 1): Promise<void>
  remove(id: number): Promise<void>
  addDependency(articleId: number, dependsOnId: number): Promise<void>
  removeDependency(articleId: number, dependsOnId: number): Promise<void>
  /** Meldet eine Störung (oder ändert die Notiz) und sagt, wie viele Artikel betroffen sind */
  reportOutage(id: number, note?: string | null): Promise<void>
  resolveOutage(id: number): Promise<void>
  /** Klappt eingeklappte Vorfahren auf und öffnet den Artikel */
  reveal(id: number): Promise<void>
}

function readPref(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key)
    return v == null ? fallback : v === '1'
  } catch {
    return fallback
  }
}

function writePref(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0')
  } catch {
    // Einstellungen sind nur Komfort
  }
}

let toastId = 0
let nonce = 0

export const useWiki = create<State>((set, get) => {
  /** Führt eine Änderung aus, lädt den Baum neu und zeigt Fehler als Hinweis. */
  async function mutate<T>(action: () => Promise<T>): Promise<T | undefined> {
    try {
      const result = await action()
      await get().loadTree()
      return result
    } catch (err) {
      get().toast(errorMessage(err), 'error')
      return undefined
    }
  }

  async function createAndRename(parentId: number, afterId: number | null, templateId: string | null): Promise<void> {
    const title = (templateId && findTemplate(templateId)?.title) || 'Neuer Artikel'
    const id = await mutate(() => wiki.createArticle(parentId, title, afterId, templateId))
    if (id == null) return
    set({ selectedId: id, renamingId: id, centerRequest: { id, nonce: ++nonce, flash: false } })
  }

  return {
    tree: null,
    dbInfo: null,
    selectedId: null,
    panelOpen: false,
    panelMax: false,
    readMode: readPref('mindwiki.readMode', false),
    showLinks: readPref('mindwiki.showLinks', true),
    renamingId: null,
    dialog: null,
    toasts: [],
    confirmRequest: null,
    centerRequest: null,
    fitNonce: 0,
    articleVersion: 0,

    async loadAll() {
      const [tree, dbInfo] = await Promise.all([wiki.getTree(), wiki.getDbInfo()])
      set({
        tree,
        dbInfo,
        selectedId: tree.rootId,
        panelOpen: false,
        panelMax: false,
        renamingId: null,
        fitNonce: get().fitNonce + 1
      })
    },

    async loadTree() {
      const tree = await wiki.getTree()
      const { selectedId } = get()
      const stillThere = selectedId != null && indexTree(tree).byId.has(selectedId)
      set({ tree, selectedId: stillThere ? selectedId : tree.rootId })
    },

    select(id, center = false) {
      set({
        selectedId: id,
        ...(center && id != null ? { centerRequest: { id, nonce: ++nonce, flash: center === 'flash' } } : {})
      })
    },

    openArticle(id, center = false) {
      get().select(id, center)
      set({ panelOpen: true })
    },

    closePanel: () => set({ panelOpen: false, panelMax: false }),
    setPanelMax: (panelMax) => set({ panelMax }),

    setReadMode(readMode) {
      writePref('mindwiki.readMode', readMode)
      set({ readMode })
    },

    toggleLinks() {
      const showLinks = !get().showLinks
      writePref('mindwiki.showLinks', showLinks)
      set({ showLinks })
    },

    setRenaming: (renamingId) => set({ renamingId }),
    setDialog: (dialog) => set({ dialog }),

    toast(text, kind = 'info') {
      const id = ++toastId
      set({ toasts: [...get().toasts, { id, text, kind }] })
      setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), kind === 'error' ? 6000 : 3000)
    },

    confirm(options) {
      return new Promise<boolean>((resolve) => {
        set({
          confirmRequest: {
            ...options,
            resolve: (ok) => {
              set({ confirmRequest: null })
              resolve(ok)
            }
          }
        })
      })
    },

    requestFit: () => set({ fitNonce: get().fitNonce + 1 }),

    createChild: (parentId, templateId = null) => createAndRename(parentId, null, templateId),

    async createSibling(id, templateId = null) {
      const tree = get().tree
      const article = tree && indexTree(tree).byId.get(id)
      if (!article) return
      if (article.parentId == null) return createAndRename(id, null, templateId)
      return createAndRename(article.parentId, id, templateId)
    },

    async rename(id, title) {
      await mutate(() => wiki.renameArticle(id, title))
    },

    async setColor(id, color) {
      await mutate(() => wiki.setArticleColor(id, color))
    },

    async setIcon(id, icon) {
      await mutate(() => wiki.setArticleIcon(id, icon))
    },

    async applyTemplate(id, templateId) {
      await flushPending()
      await mutate(() => wiki.applyTemplate(id, templateId))
      set({ articleVersion: get().articleVersion + 1 })
    },

    async toggleCollapsed(id) {
      const tree = get().tree
      const article = tree && indexTree(tree).byId.get(id)
      if (!article || !indexTree(tree).children.get(id)?.length) return
      await mutate(() => wiki.setCollapsed(id, !article.collapsed))
    },

    async move(id, newParentId) {
      await mutate(() => wiki.moveArticle(id, newParentId))
      set({ centerRequest: { id, nonce: ++nonce, flash: true } })
    },

    async reorder(id, direction) {
      await mutate(() => wiki.reorderArticle(id, direction))
    },

    async remove(id) {
      const tree = get().tree
      const article = tree && indexTree(tree).byId.get(id)
      if (!tree || !article) return
      if (article.parentId == null) {
        get().toast('Die Wurzel kann nicht gelöscht werden.', 'error')
        return
      }
      const count = countSubtree(tree, id)
      const ok = await get().confirm({
        title: 'In den Papierkorb verschieben?',
        message:
          count > 1
            ? `„${article.title}“ und ${count - 1} Unterartikel werden in den Papierkorb verschoben.`
            : `„${article.title}“ wird in den Papierkorb verschoben.`,
        confirmLabel: 'In den Papierkorb',
        danger: true
      })
      if (!ok) return
      await flushPending()
      await mutate(() => wiki.deleteArticle(id))
      set({ selectedId: article.parentId })
      get().toast('In den Papierkorb verschoben – wiederherstellen über Bearbeiten › Papierkorb.')
    },

    async addDependency(articleId, dependsOnId) {
      await mutate(() => wiki.addDependency(articleId, dependsOnId))
    },

    async removeDependency(articleId, dependsOnId) {
      await mutate(() => wiki.removeDependency(articleId, dependsOnId))
    },

    async reportOutage(id, note = null) {
      const wasDown = get().tree?.articles.find((a) => a.id === id)?.outageSince != null
      const ok = await mutate(async () => {
        await wiki.reportOutage(id, note)
        return true
      })
      const tree = get().tree
      if (!ok || wasDown || !tree) return
      const count = impactOf(tree).byOutage.get(id)?.length ?? 0
      get().toast(
        count === 0
          ? 'Störung gemeldet. Es hängen keine anderen Artikel davon ab.'
          : `Störung gemeldet – ${count} ${count === 1 ? 'Artikel ist' : 'Artikel sind'} betroffen.`
      )
    },

    async resolveOutage(id) {
      await mutate(() => wiki.resolveOutage(id))
    },

    async reveal(id) {
      const tree = get().tree
      if (!tree) return
      const collapsed = pathTo(tree, id)
        .slice(0, -1)
        .filter((a) => a.collapsed)
      if (collapsed.length > 0) {
        await mutate(async () => {
          for (const a of collapsed) await wiki.setCollapsed(a.id, false)
        })
      }
      get().openArticle(id, 'flash')
    }
  }
})
