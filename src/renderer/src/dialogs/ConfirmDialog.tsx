import { useEffect, useRef } from 'react'
import { useWiki } from '../store'
import { Modal } from './Modal'

export function ConfirmDialog(): React.JSX.Element | null {
  const request = useWiki((s) => s.confirmRequest)
  const okRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (request) okRef.current?.focus()
  }, [request])

  if (!request) return null
  return (
    <Modal
      title={request.title}
      onClose={() => request.resolve(false)}
      footer={
        <>
          <button className="btn" onClick={() => request.resolve(false)}>
            Abbrechen
          </button>
          <button
            ref={okRef}
            className={`btn ${request.danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => request.resolve(true)}
          >
            {request.confirmLabel ?? 'OK'}
          </button>
        </>
      }
    >
      <p>{request.message}</p>
    </Modal>
  )
}
