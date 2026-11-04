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
  /** Beginn einer gemeldeten Störung, null wenn in Betrieb */
  outageSince: string | null
  /** Kurze Notiz zur Störung (Ursache, Ticket …) */
  outageNote: string | null
  /** Letzte protokollierte Änderung (null bei Artikeln aus der Zeit vor dem Verlauf) */
  lastChangeAt: string | null
  lastChangeBy: string | null
  /** Letzte Änderung durch jemand anderen als den aktuellen Nutzer */
  lastOtherChangeAt: string | null
  lastOtherChangeBy: string | null
  /** false: neu angelegt und noch nicht freigegeben (nur bei eingeschalteter Freigabe-Pflicht) */
  approved: boolean
  createdBy: string | null
  /** Offener Änderungsvorschlag (Entwurf) zu diesem Artikel */
  draftId: number | null
  draftBy: string | null
  draftAt: string | null
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

/** `articleId` hängt ab von `dependsOnId`: Fällt `dependsOnId` aus, ist `articleId` betroffen. */
export interface DependencyEdge {
  articleId: number
  dependsOnId: number
}

export interface TreeData {
  rootId: number
  articles: ArticleSummary[]
  links: LinkEdge[]
  dependencies: DependencyEdge[]
  /** Neue Artikel und Änderungen müssen von jemand anderem freigegeben werden */
  approvalRequired: boolean
  /** Namen gelöschter Benutzer – ihre Artikel werden gekennzeichnet */
  deletedUsers: string[]
}

/** Unterschiede zwischen einem freigegebenen Artikel und dem Änderungsvorschlag dazu. */
export interface DraftDiff {
  author: string
  since: string
  title: { before: string; after: string } | null
  iconChanged: boolean
  fields: { label: string; before: string | null; after: string | null }[]
  checklists: { title: string; change: 'added' | 'removed' | 'changed'; detail: string[] }[]
  text: { before: string; after: string } | null
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

export type ChangeKind =
  | 'create'
  | 'title'
  | 'text'
  | 'icon'
  | 'template'
  | 'field'
  | 'checklist'
  | 'dependency'
  | 'outage'
  | 'move'
  | 'trash'
  | 'approval'

/** Ein Eintrag im Verlauf eines Artikels: wer hat wann was geändert. */
export interface ChangeEntry {
  id: number
  articleId: number
  at: string
  author: string
  kind: ChangeKind
  summary: string
  /** Bei Textänderungen: Die Fassung vor dieser Änderung ist gespeichert und kann angesehen werden. */
  hasVersion: boolean
}

export interface RecentChange extends ChangeEntry {
  title: string
  /** Artikel liegt im Papierkorb */
  deleted: boolean
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
  /** Das mitgelieferte Beispiel-Wiki mit erfundenen Daten */
  isSample: boolean
}

/** admin: verwaltet Benutzer · editor (Bearbeiter): verfasst und gibt frei · author (Mitarbeiter): verfasst */
export type Role = 'admin' | 'editor' | 'author'

export const ROLE_LABEL: Record<Role, string> = { admin: 'Admin', editor: 'Bearbeiter', author: 'Mitarbeiter' }

export interface UserInfo {
  id: number
  username: string
  role: Role
  createdAt: string
  deleted: boolean
}

export interface Session {
  username: string
  role: Role
}

/** Was die Anmeldemaske braucht */
export interface LoginInfo {
  session: Session | null
  /** Admin hat noch das Start-Passwort „admin“ */
  defaultAdminPassword: boolean
  /** Es gibt außer dem Admin noch niemanden (frisches Wiki) */
  onlyAdmin: boolean
  isSample: boolean
  lastUser: string | null
}

/** Stand der Update-Prüfung (GitHub-Releases). */
export interface UpdateState {
  status: 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'error' | 'unsupported'
  /** Installierte Version */
  current: string
  /** Neue Version, falls vorhanden */
  version?: string
  percent?: number
  /** false: portable Version – nur Download-Seite öffnen */
  canInstall?: boolean
  message?: string
}

/** Artikeltext, der nicht gespeichert werden konnte – auf diesem Rechner aufgehoben. */
export interface UnsavedText {
  /** Artikel, wie er in der Mind Map heißt (zum Öffnen) */
  articleId: number
  /** Wohin der Text gespeichert werden sollte (Artikel oder eigener Entwurf) */
  contentId: number
  title: string
  /** Text als Editor-JSON */
  content: string
  /** Reiner Text (zum Kopieren) */
  text: string
  /** Zeitpunkt (ISO) */
  at: string
}

/** Abfrage von Benutzername und Passwort für einen Firmen-Proxy (bei der Update-Prüfung). */
export interface ProxyPrompt {
  /** Proxy-Server als „host:port“ */
  host: string
  /** Bereich, den der Proxy nennt (oft leer) */
  realm: string
  /** Vorschlag (zuletzt benutzt oder gespeichert) */
  username: string
  /** true: Der Proxy hat die letzte Eingabe abgelehnt */
  failed: boolean
  /** Merken möglich (Verschlüsselung für das Windows-Konto verfügbar) */
  canRemember: boolean
  /** Zählt die Abfragen – jede neue setzt das Formular zurück */
  attempt: number
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

  addDependency(articleId: number, dependsOnId: number): void
  removeDependency(articleId: number, dependsOnId: number): void
  /** Meldet eine Störung oder ändert ihre Notiz; der Beginn bleibt dabei erhalten. */
  reportOutage(id: number, note: string | null): void
  resolveOutage(id: number): void

  getChanges(articleId: number): ChangeEntry[]
  getRecentChanges(limit: number): RecentChange[]
  /** Text (TipTap-JSON) vor einer Textänderung */
  getTextVersion(changeId: number): string | null
  restoreTextVersion(changeId: number): void
  /** Name des angemeldeten Benutzers */
  getUserName(): string

  getLoginInfo(): LoginInfo
  login(username: string, password: string): Promise<Session>
  logout(): void
  changePassword(oldPassword: string, newPassword: string): void
  listUsers(): UserInfo[]
  createUser(username: string, password: string, role: Role): number
  setUserRole(id: number, role: Role): void
  resetPassword(id: number, password: string): void
  deleteUser(id: number): void

  /** Entwurf zu einem freigegebenen Artikel beginnen (oder den eigenen weiterführen); liefert seine ID */
  startDraft(id: number): number
  discardDraft(id: number): void
  /** Neuen Artikel oder Änderungsvorschlag freigeben (nicht den eigenen) */
  approve(id: number): void
  reject(id: number, reason: string | null): void
  getDraftDiff(id: number): DraftDiff | null
  setApprovalRequired(on: boolean): void

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
  /** Beispiel-Wiki öffnen (beim ersten Mal anlegen) */
  openSampleDb(): Promise<boolean>
  /** Artikel als PDF speichern; liefert den Pfad oder null (abgebrochen) */
  exportPdf(id: number): Promise<string | null>
  getUpdateState(): UpdateState
  checkForUpdates(): Promise<UpdateState>
  downloadUpdate(): Promise<void>
  installUpdate(): void
  openReleasePage(): void
  /** Antwort auf die Proxy-Abfrage */
  answerProxyLogin(username: string, password: string, remember: boolean): void
  cancelProxyLogin(): void
  getProxyPrompt(): ProxyPrompt | null
  /** Proxys mit gespeicherter Anmeldung („host:port“) */
  getSavedProxyLogins(): string[]
  forgetProxyLogins(): void
  /** Nicht gespeicherten Text auf diesem Rechner aufheben bzw. wieder entfernen */
  keepUnsaved(text: Omit<UnsavedText, 'at'>): void
  dropUnsaved(contentId: number): void
  listUnsaved(): UnsavedText[]
  /** Die Oberfläche fragt vor dem Beenden noch nach – nicht nach 3 Sekunden zwangsweise schließen */
  holdClose(): void
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
  'addDependency',
  'removeDependency',
  'reportOutage',
  'resolveOutage',
  'getChanges',
  'getRecentChanges',
  'getTextVersion',
  'restoreTextVersion',
  'getUserName',
  'getLoginInfo',
  'login',
  'logout',
  'changePassword',
  'listUsers',
  'createUser',
  'setUserRole',
  'resetPassword',
  'deleteUser',
  'startDraft',
  'discardDraft',
  'approve',
  'reject',
  'getDraftDiff',
  'setApprovalRequired',
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
  'openSampleDb',
  'exportPdf',
  'getUpdateState',
  'checkForUpdates',
  'downloadUpdate',
  'installUpdate',
  'openReleasePage',
  'answerProxyLogin',
  'cancelProxyLogin',
  'getProxyPrompt',
  'getSavedProxyLogins',
  'forgetProxyLogins',
  'keepUnsaved',
  'dropUnsaved',
  'listUnsaved',
  'holdClose',
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
  | 'outages'
  | 'changes'
  | 'logout'
  | 'change-password'
  | 'users'
  | 'approvals'
  | 'sample-db'
  | 'check-updates'
  | 'export-pdf'
  | 'save'
  | 'toggle-links'
  | 'fit'
  | 'shortcuts'
  | 'about'

export type WikiEvent =
  | { type: 'menu'; action: MenuAction }
  | { type: 'request-close' }
  /** Jemand anderes hat die geöffnete Wiki-Datei geändert */
  | { type: 'external-change' }
  | { type: 'update'; state: UpdateState }
  /** Proxy verlangt eine Anmeldung (null: Abfrage schließen) */
  | { type: 'proxy-login'; prompt: ProxyPrompt | null }

type Promisify<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : never
}

export type WikiApi = Promisify<WikiRpc> & {
  onEvent(listener: (event: WikiEvent) => void): () => void
}

export const IMAGE_SCHEME = 'wikiimg'
export const imageUrl = (id: number): string => `${IMAGE_SCHEME}://img/${id}`
export const IMAGE_URL_PATTERN = /wikiimg:\/\/img\/(\d+)/g
