import { useEffect, useState } from 'react';
import { subscribeToasts, type ToastItem } from '../lib/toast';

const styles: Record<ToastItem['type'], string> = {
  success: 'bg-emerald-600',
  error: 'bg-rose-600',
  info: 'bg-stone-800',
};

export default function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => subscribeToasts(setItems), []);

  return (
    <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          className={`animate-[toastIn_.2s_ease] rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg shadow-stone-900/20 ${styles[t.type]}`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
