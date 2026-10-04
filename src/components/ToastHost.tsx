import { useEffect, useState } from 'react';
import { subscribeToasts, type ToastItem } from '../lib/toast';

const styles: Record<ToastItem['type'], string> = {
  success: 'bg-emerald-600',
  error: 'bg-rose-600',
  info: 'bg-[#0f2a4a] ring-1 ring-[#1e3a5f]',
};

export default function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => subscribeToasts(setItems), []);

  return (
    <div className="fixed inset-x-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-[100] flex flex-col items-stretch gap-2 sm:inset-x-auto sm:bottom-5 sm:right-5 sm:items-end">
      {items.map((t) => (
        <div
          key={t.id}
          className={`animate-[toastIn_.2s_ease] rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg shadow-slate-900/20 ${styles[t.type]}`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
