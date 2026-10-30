import {
  AppWindow,
  Archive,
  BookOpen,
  Building,
  Cable,
  Cloud,
  Code,
  Cpu,
  Database,
  FileText,
  Folder,
  Globe,
  HardDrive,
  Headset,
  KeyRound,
  Laptop,
  Lock,
  Mail,
  Monitor,
  Network,
  Package,
  Phone,
  Printer,
  Router,
  Server,
  Settings,
  Shield,
  Smartphone,
  Terminal,
  Ticket,
  TriangleAlert,
  User,
  Users,
  Wifi,
  Wrench,
  type LucideIcon
} from 'lucide-react'

// Symbole für Knoten. Die IDs werden in der Datenbank gespeichert – nur ergänzen, nicht umbenennen.
export const NODE_ICONS: { id: string; label: string; Icon: LucideIcon }[] = [
  { id: 'server', label: 'Server', Icon: Server },
  { id: 'network', label: 'Netzwerk', Icon: Network },
  { id: 'router', label: 'Router / Firewall', Icon: Router },
  { id: 'wifi', label: 'WLAN', Icon: Wifi },
  { id: 'cable', label: 'Verkabelung', Icon: Cable },
  { id: 'monitor', label: 'Arbeitsplatz', Icon: Monitor },
  { id: 'laptop', label: 'Notebook', Icon: Laptop },
  { id: 'smartphone', label: 'Smartphone', Icon: Smartphone },
  { id: 'printer', label: 'Drucker', Icon: Printer },
  { id: 'storage', label: 'Speicher', Icon: HardDrive },
  { id: 'database', label: 'Datenbank', Icon: Database },
  { id: 'cloud', label: 'Cloud', Icon: Cloud },
  { id: 'web', label: 'Web / Internet', Icon: Globe },
  { id: 'app', label: 'Software', Icon: AppWindow },
  { id: 'package', label: 'Paket / Lizenz', Icon: Package },
  { id: 'code', label: 'Code / Skript', Icon: Code },
  { id: 'terminal', label: 'Konsole', Icon: Terminal },
  { id: 'cpu', label: 'Hardware', Icon: Cpu },
  { id: 'security', label: 'Sicherheit', Icon: Shield },
  { id: 'access', label: 'Zugänge', Icon: KeyRound },
  { id: 'lock', label: 'Verschlüsselung', Icon: Lock },
  { id: 'backup', label: 'Backup / Archiv', Icon: Archive },
  { id: 'mail', label: 'E-Mail', Icon: Mail },
  { id: 'phone', label: 'Telefonie', Icon: Phone },
  { id: 'user', label: 'Benutzer', Icon: User },
  { id: 'users', label: 'Gruppe / Team', Icon: Users },
  { id: 'headset', label: 'Support / Kontakt', Icon: Headset },
  { id: 'building', label: 'Standort', Icon: Building },
  { id: 'book', label: 'Anleitung', Icon: BookOpen },
  { id: 'alert', label: 'Störung', Icon: TriangleAlert },
  { id: 'wrench', label: 'Wartung', Icon: Wrench },
  { id: 'settings', label: 'Konfiguration', Icon: Settings },
  { id: 'ticket', label: 'Ticket', Icon: Ticket },
  { id: 'file', label: 'Dokument', Icon: FileText },
  { id: 'folder', label: 'Ordner', Icon: Folder }
]

const byId = new Map(NODE_ICONS.map((i) => [i.id, i]))

export function NodeIcon({ id, size = 16, className }: { id: string | null; size?: number; className?: string }): React.JSX.Element | null {
  const entry = id ? byId.get(id) : undefined
  if (!entry) return null
  return <entry.Icon size={size} className={className} aria-label={entry.label} />
}

export function IconPicker({ value, onPick }: { value: string | null; onPick(id: string | null): void }): React.JSX.Element {
  return (
    <div className="icon-picker">
      <div className="icon-grid">
        {NODE_ICONS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            className={value === id ? 'active' : ''}
            title={label}
            aria-label={label}
            onClick={() => onPick(id)}
          >
            <Icon size={18} />
          </button>
        ))}
      </div>
      <button type="button" className="icon-none" disabled={!value} onClick={() => onPick(null)}>
        Kein Symbol
      </button>
    </div>
  )
}
