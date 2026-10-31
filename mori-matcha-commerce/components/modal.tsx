'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export default function Modal({ title, children, onClose, wide = false, closeLabel = '关闭 / Close / Tutup' }: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
  closeLabel?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const scroll = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const element = ref.current;
    const focusable = 'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]';
    element?.querySelector<HTMLElement>(focusable)?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close.current();
      if (event.key !== 'Tab' || !element) return;
      const elements = Array.from(element.querySelectorAll<HTMLElement>(focusable));
      const first = elements[0];
      const last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        last?.focus();
        event.preventDefault();
      } else if (!event.shiftKey && document.activeElement === last) {
        first?.focus();
        event.preventDefault();
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.body.style.overflow = scroll;
      document.removeEventListener('keydown', key);
      previous?.focus();
    };
  }, []);
  return <div className="mm-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className={'mm-modal ' + (wide ? 'mm-wide' : '')} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
      <div className="mm-modal-head">
        <h2>{title}</h2>
        <button className="mm-icon" aria-label={closeLabel} onClick={onClose}><X size={20} /></button>
      </div>
      <div className="mm-modal-body">{children}</div>
    </div>
  </div>;
}
