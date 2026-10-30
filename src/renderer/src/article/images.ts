import type { Editor } from '@tiptap/react'
import { errorMessage, wiki } from '../api'
import { useWiki } from '../store'

export const imageFiles = (list: FileList | null | undefined): File[] =>
  Array.from(list ?? []).filter((f) => f.type.startsWith('image/'))

/** Speichert Bilder in der Datenbank und fügt sie an der Cursor- bzw. Drop-Position ein. */
export async function insertImages(editor: Editor, files: File[], pos?: number): Promise<void> {
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue
    try {
      const src = await wiki.saveImage(file.type, new Uint8Array(await file.arrayBuffer()))
      const node = { type: 'image', attrs: { src, alt: file.name || 'Bild' } }
      if (pos != null) editor.chain().insertContentAt(pos, node).run()
      else editor.chain().focus().insertContent(node).run()
    } catch (err) {
      useWiki.getState().toast(errorMessage(err), 'error')
    }
  }
}
