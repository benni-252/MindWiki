import { create } from 'zustand'
import { findTemplate } from '../../shared/templates'
import type { DbInfo, LoginInfo, Role, Session, TreeData, UpdateState } from '../../shared/types'
import { errorMessage, flushPending, hasPending, wiki } from './api'
import { countSubtree, impactOf, indexTree, pathTo, type SeenState } from './treeUtils'

export type DialogKind =
  | 'search'
  | 'trash'
  | 'outages'
  | 'changes'
  | 'users'
  | 'change-password'
  | 'approvals'
  | 'update'
  | 'shortcuts'
  | 'about'
  | null

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
  /** Name, unter dem eigene Änderungen im Verlauf erscheinen */
  userName: string
  /** Wann welcher Artikel zuletzt angesehen wurde (für „neu geändert“) */
  seen: SeenState | null
  /** Neue Version auf GitHub? */
  update: UpdateState
  /** Angemeldeter Benutzer; null → Anmeldemaske */
  session: Session | null
  loginInfo: LoginInfo | null

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
  /** Offenen Artikel komplett neu laden (Text, Felder, Abläufe) */
  reloadArticle(): void
  markSeen(id: number): void
  markAllSeen(): void
  login(username: string, password: string): Promise<void>
  logout(): Promise<void>
  refreshLoginInfo(): Promise<void>
  /** Mindestens diese Rolle? (author < editor < admin) */
  can(role: Role): boolean
  /** Ein anderer Rechner hat die Wiki-Datei geändert */
  externalChange(): Promise<void>
  startDraft(id: number): Promise<void>
  discardDraft(id: number): Promise<void>
  approve(id: number): Promise<void>
  reject(id: number, reason: string | null): Promise<void>
  setApprovalRequired(on: boolean): Promise<void>
  setUpdate(update: UpdateState): void
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

/** Gesehen-Stand pro Datei und Benutzer (mehrere Personen können denselben Rechner nutzen). */
const seenKey = (dbPath: string): string => `mindwiki.seen:${dbPath}`

const RANK: Record<Role, number> = { author: 1, editor: 2, admin: 3 }

function loadSeen(dbPath: string): SeenState {
  try {
    const raw = localStorage.getItem(seenKey(dbPath))
    const value = raw ? (JSON.parse(raw) as SeenState) : null
    if (value && typeof value.baseline === 'string' && value.items && typeof value.items === 'object') return value
  } catch {
    // ungültig oder kein Zugriff – neu beginnen
  }
  const fresh: SeenState = { baseline: new Date().toISOString(), items: {} }
  saveSeen(dbPath, fresh)
  return fresh
}

function saveSeen(dbPath: string, seen: SeenState): void {
  try {
    localStorage.setItem(seenKey(dbPath), JSON.stringify(seen))
  } catch {
    // nur Komfort
  }
}

/** Tippt der Nutzer gerade im Artikel (Feld, Ablaufschritt, Notiz)? */
function typingInPanel(): boolean {
  const el = document.activeElement as HTMLElement | null
  return !!el?.closest('.panel') && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}

/** Hinweis „von X geändert“ höchstens einmal pro Minute und Artikel, auch wenn jemand gerade viel tippt */
let lastForeignToast = { id: 0, at: 0 }

export const useWiki = create<State>((set, get) => {
  /** Führt eine Änderung aus, lädt den Baum neu und zeigt Fehler als Hinweis. */
  async function mutate<T>(action: () => Promise<T>): Promise<T | undefined> {
    try {
      const result = await action()
      await get().loadTree()
      return result
    } catch (err) {
      const message = errorMessage(err)
      get().toast(message, 'error')
      // Abgemeldet oder Benutzer gelöscht → zurück zur Anmeldung
      if (/anmelden/i.test(message)) void get().loadAll()
      return undefined
    }
  }

  function draftOf(id: number): number | null {
    const tree = get().tree
    return (tree && indexTree(tree).byId.get(id)?.draftId) ?? null
  }

  /** Hinweis, wenn eine Änderung in der Mind Map einen neuen Entwurf angelegt hat */
  function announceDraft(id: number, before: number | null): void {
    if (before == null && draftOf(id) != null) {
      get().toast('Als Entwurf gespeichert – die anderen sehen die Änderung erst nach der Freigabe.')
    }
  }

  /** Ändert den Freigabe-Stand und lädt den offenen Artikel neu. */
  async function decide(action: () => Promise<unknown>, done: string | null): Promise<void> {
    await flushPending()
    const ok = await mutate(async () => {
      await action()
      return true
    })
    if (!ok) return
    get().reloadArticle()
    if (done) get().toast(done)
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
    userName: '',
    seen: null,
    session: null,
    loginInfo: null,
    update: { status: 'idle', current: __APP_VERSION__ },

    async loadAll() {
      const [dbInfo, loginInfo, update] = await Promise.all([wiki.getDbInfo(), wiki.getLoginInfo(), wiki.getUpdateState()])
      if (!loginInfo.session) {
        set({ dbInfo, loginInfo, update, session: null, tree: null, dialog: null, panelOpen: false, userName: '' })
        return
      }
      const tree = await wiki.getTree()
      const userName = loginInfo.session.username
      set({
        update,
        tree,
        dbInfo,
        loginInfo,
        session: loginInfo.session,
        userName,
        seen: loadSeen(`${dbInfo.path}|${userName.toLowerCase()}`),
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
      const hadDraft = draftOf(id)
      await mutate(() => wiki.renameArticle(id, title))
      announceDraft(id, hadDraft)
    },

    async setColor(id, color) {
      await mutate(() => wiki.setArticleColor(id, color))
    },

    async setIcon(id, icon) {
      const hadDraft = draftOf(id)
      await mutate(() => wiki.setArticleIcon(id, icon))
      announceDraft(id, hadDraft)
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
    },

    reloadArticle: () => set({ articleVersion: get().articleVersion + 1 }),

    markSeen(id) {
      const { seen, dbInfo, tree } = get()
      if (!seen || !dbInfo) return
      // Uhren verschiedener Rechner gehen nie ganz gleich: mindestens bis zur letzten fremden Änderung
      const other = tree ? (indexTree(tree).byId.get(id)?.lastOtherChangeAt ?? '') : ''
      const now = new Date().toISOString()
      const stamp = other > now ? other : now
      if (seen.items[id] && seen.items[id] >= stamp) return
      const next = { ...seen, items: { ...seen.items, [id]: stamp } }
      saveSeen(dbInfo.path, next)
      set({ seen: next })
    },

    markAllSeen() {
      const { dbInfo, tree } = get()
      if (!dbInfo) return
      const now = new Date().toISOString()
      const latest = (tree?.articles ?? []).reduce((max, a) => ((a.lastOtherChangeAt ?? '') > max ? (a.lastOtherChangeAt ?? '') : max), now)
      const next: SeenState = { baseline: latest, items: {} }
      saveSeen(dbInfo.path, next)
      set({ seen: next })
    },

    async login(username, password) {
      await wiki.login(username, password)
      await get().loadAll()
    },

    async logout() {
      await flushPending()
      await wiki.logout()
      await get().loadAll()
    },

    async refreshLoginInfo() {
      set({ loginInfo: await wiki.getLoginInfo() })
    },

    can(role) {
      const session = get().session
      return !!session && RANK[session.role] >= RANK[role]
    },

    setUpdate: (update) => set({ update }),

    startDraft: (id) => decide(() => wiki.startDraft(id), null),
    discardDraft: (id) => decide(() => wiki.discardDraft(id), 'Entwurf verworfen.'),
    approve: (id) => decide(() => wiki.approve(id), 'Freigegeben.'),
    reject: (id, reason) => decide(() => wiki.reject(id, reason), 'Abgelehnt.'),
    setApprovalRequired: (on) =>
      decide(() => wiki.setApprovalRequired(on), on ? 'Freigabe-Pflicht eingeschaltet.' : 'Freigabe-Pflicht ausgeschaltet.'),

    async externalChange() {
      const before = get().tree
      try {
        await get().loadTree()
      } catch {
        return // Datei kurz nicht erreichbar – beim nächsten Mal
      }
      const { tree, selectedId, panelOpen, userName } = get()
      if (!before || !tree || !panelOpen || selectedId == null) return
      const old = indexTree(before).byId.get(selectedId)
      const now = indexTree(tree).byId.get(selectedId)
      if (!now?.lastChangeBy || now.lastChangeAt === old?.lastChangeAt || now.lastChangeBy === userName) return

      const quiet = lastForeignToast.id === now.id && Date.now() - lastForeignToast.at < 60_000
      if (hasPending() || typingInPanel()) {
        if (!quiet) {
          get().toast(
            `${now.lastChangeBy} hat „${now.title}“ gerade auch geändert. Deine Eingaben werden gespeichert – frühere Fassungen findest du im Verlauf.`,
            'error'
          )
        }
      } else {
        get().reloadArticle()
        if (!quiet) get().toast(`„${now.title}“ wurde von ${now.lastChangeBy} geändert.`)
      }
      if (!quiet) lastForeignToast = { id: now.id, at: Date.now() }
    }
  }
})
