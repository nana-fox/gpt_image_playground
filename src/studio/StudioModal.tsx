import { useEffect, type ReactNode } from 'react'
import { X } from '@phosphor-icons/react'

export default function StudioModal({ children, onClose, className = '' }: { children: ReactNode, onClose: () => void, className?: string }) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    const previousRootOverflow = document.documentElement.style.overflow
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      document.documentElement.style.overflow = previousRootOverflow
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [onClose])

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className={`base-modal ${className}`} role="dialog" aria-modal="true"><button className="modal-close" onClick={onClose} aria-label="关闭"><X size={20} /></button>{children}</section></div>
}
