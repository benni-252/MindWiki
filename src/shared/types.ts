// Gemeinsame Typen für Main-Prozess, Preload und Oberfläche.

/** Artikel ohne Inhalt – alles, was die Mind Map braucht. */
export interface ArticleSummary {
  id: number
  parentId: number | null
  title: string
  position: number
  color: string | null
  /** Symbol-ID für den Knoten, siehe src/renderer/src/icons.tsx */
  icon: string | null
  collapsed: boolean
  hasText: boolean
  checkTotal: number
  checkDone: number
}

/** Ein Steckbrief-Feld eines Artikels (z. B. „IP-Adresse“ = „10.0.0.5“). */
export interface ArticleField {
  id: number
  articleId: number
  label: string
  value: string
  position: number
}

export interface Article {
  id: number
  parentId: number | null
  title: string
  /** TipTap-Dokument als JSON-String, null wenn noch leer */
  content: string | null
  color: string | null
  collapsed: boolean
  createdAt: string
  updatedAt: string
}

export interface LinkEdge {
  fromId: number
  toId: number
}

export interface TreeData {
  rootId: number
  articles: ArticleSummary[]
  links: LinkEdge[]
}

export interface ChecklistItem {
  id: number
  checklistId: number
  text: string
  position: number
  checked: boolean
  checkedAt: string | null
}

export interface Checklist {
  id: number
  articleId: number
  title: string
  position: number
  items: ChecklistItem[]
}

export interface RunSnapshotItem {
  text: string
  checked: boolean
}

export interface ChecklistRun {
  id: number
  checklistId: number
  completedAt: string
  note: string | null
  snapshot: RunSnapshotItem[]
}

export interface SearchHit {
  id: number
  title: string
  snippet: string
}

export interface TrashEntry {
  id: number
  title: string
  deletedAt: string
  count: number
}

export interface DbInfo {
  path: string
  name: string
}

export interface SaveResult {
  /** true, wenn sich Querverweise oder die Text-Markierung geändert haben (Mind Map neu laden) */
  treeChanged: boolean
}

/**
 * Alle Funktionen, die der Main-Prozess per IPC anbietet (synchron implementiert).
 * Die Oberfläche sieht sie als Promise-Varianten, siehe WikiApi.
 */
export interface WikiRpc {
  getTree(): TreeData
  getArticle(id: number): Article | null
  createArticle(parentId: number, title: string, afterId?: number | null, templateId?: string | null): number
  applyTemplate(id: number, templateId: string): void
  saveArticleContent(id: number, content: string, text: string): SaveResult
  renameArticle(id: number, title: string): void
  setArticleColor(id: number, color: string | null): void
  setArticleIcon(id: number, icon: string | null): void
  setCollapsed(id: number, collapsed: boolean): void
  moveArticle(id: number, newParentId: number): void
  reorderArticle(id: number, direction: -1 | 1): void
  deleteArticle(id: number): void
  search(query: string): SearchHit[]

  listTrash(): TrashEntry[]
  restoreArticle(id: number): void
  purgeArticle(id: number): void
  emptyTrash(): void

  getFields(articleId: number): ArticleField[]
  addField(articleId: number, label: string, value?: string): number
  updateField(id: number, label: string, value: string): void
  deleteField(id: number): void
  moveField(id: number, direction: -1 | 1): void

  getChecklists(articleId: number): Checklist[]
  createChecklist(articleId: number, title: string): number
  renameChecklist(id: number, title: string): void
  deleteChecklist(id: number): void
  moveChecklist(id: number, direction: -1 | 1): void
  addItem(checklistId: number, text: string): number
  updateItemText(id: number, text: string): void
  setItemChecked(id: number, checked: boolean): void
  deleteItem(id: number): void
  moveItem(id: number, direction: -1 | 1): void
  resetChecklist(id: number): void
  completeRun(checklistId: number, note: string | null): void
  getRuns(checklistId: number): ChecklistRun[]
  deleteRun(id: number): void

  saveImage(mime: string, data: Uint8Array): string

  getDbInfo(): DbInfo
  newDb(): Promise<boolean>
  openDb(): Promise<boolean>
  backupDb(): Promise<string | null>
  revealDb(): void
  confirmClose(): void
}

export const RPC_METHODS = [
  'getTree',
  'getArticle',
  'createArticle',
  'applyTemplate',
  'saveArticleContent',
  'renameArticle',
  'setArticleColor',
  'setArticleIcon',
  'setCollapsed',
  'moveArticle',
  'reorderArticle',
  'deleteArticle',
  'search',
  'listTrash',
  'restoreArticle',
  'purgeArticle',
  'emptyTrash',
  'getFields',
  'addField',
  'updateField',
  'deleteField',
  'moveField',
  'getChecklists',
  'createChecklist',
  'renameChecklist',
  'deleteChecklist',
  'moveChecklist',
  'addItem',
  'updateItemText',
  'setItemChecked',
  'deleteItem',
  'moveItem',
  'resetChecklist',
  'completeRun',
  'getRuns',
  'deleteRun',
  'saveImage',
  'getDbInfo',
  'newDb',
  'openDb',
  'backupDb',
  'revealDb',
  'confirmClose'
] as const satisfies readonly (keyof WikiRpc)[]

// Bricht die Typprüfung, wenn eine Methode in RPC_METHODS fehlt.
type MissingRpc = Exclude<keyof WikiRpc, (typeof RPC_METHODS)[number]>
export const rpcComplete: MissingRpc extends never ? true : MissingRpc = true

/** Ereignisse vom Main-Prozess an die Oberfläche (Menü, Schließen). */
export type MenuAction =
  | 'new-db'
  | 'open-db'
  | 'backup-db'
  | 'reveal-db'
  | 'search'
  | 'trash'
  | 'toggle-links'
  | 'fit'
  | 'shortcuts'
  | 'about'

export type WikiEvent = { type: 'menu'; action: MenuAction } | { type: 'request-close' }

type Promisify<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : never
}

export type WikiApi = Promisify<WikiRpc> & {
  onEvent(listener: (event: WikiEvent) => void): () => void
}

export const IMAGE_SCHEME = 'wikiimg'
export const imageUrl = (id: number): string => `${IMAGE_SCHEME}://img/${id}`
export const IMAGE_URL_PATTERN = /wikiimg:\/\/img\/(\d+)/g
