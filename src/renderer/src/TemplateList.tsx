import { FilePlus } from 'lucide-react'
import { TEMPLATES } from '../../shared/templates'
import { NodeIcon } from './icons'

/** Auswahlliste „Leerer Artikel“ + IT-Vorlagen (für Kontextmenü und Plus-Knopf). */
export function TemplateList({ onPick, blank = true }: { onPick(templateId: string | null): void; blank?: boolean }): React.JSX.Element {
  return (
    <div className="template-list" role="menu">
      {blank && (
        <button type="button" role="menuitem" onClick={() => onPick(null)}>
          <FilePlus size={18} />
          <span>
            <strong>Leerer Artikel</strong>
            <small>Ohne Vorgaben</small>
          </span>
        </button>
      )}
      {TEMPLATES.map((t) => (
        <button key={t.id} type="button" role="menuitem" onClick={() => onPick(t.id)}>
          <NodeIcon id={t.icon} size={18} />
          <span>
            <strong>{t.name}</strong>
            <small>{t.description}</small>
          </span>
        </button>
      ))}
    </div>
  )
}
