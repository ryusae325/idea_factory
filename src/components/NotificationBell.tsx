import { useCallback, useEffect, useState } from 'react';
import type { Announcement, Notification, Profile } from '../lib/types';
import { fmtDate } from '../lib/types';
import { fetchAnnouncements, fetchLifetimeEarnings, fetchMyNotifications } from '../lib/data';

const READ_KEY = 'planmo_notif_read_at';
const TAX_ACK_KEY = 'planmo_tax_notif_ack';
const TAX_THRESHOLD = 1_000_000;

export default function NotificationBell({ profile }: { profile: Profile }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Announcement[]>([]);
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [taxDue, setTaxDue] = useState(false);
  const [hasNew, setHasNew] = useState(false);

  const evaluate = useCallback(async () => {
    try {
      const [list, notifList, earned] = await Promise.all([
        fetchAnnouncements(),
        fetchMyNotifications(profile.id),
        fetchLifetimeEarnings(profile.id),
      ]);
      setItems(list);
      setNotifs(notifList);
      const due = earned >= TAX_THRESHOLD;
      setTaxDue(due);
      const readAt = localStorage.getItem(READ_KEY) ?? '';
      const acked = localStorage.getItem(TAX_ACK_KEY) === '1';
      setHasNew(
        notifList.some((n) => n.created_at > readAt) ||
          list.some((a) => a.created_at > readAt) ||
          (due && !acked),
      );
    } catch {
      /* 通知の取得に失敗しても画面は動作させ続ける */
    }
  }, [profile.id]);

  useEffect(() => {
    evaluate();
  }, [evaluate]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) evaluate();
  };

  const markAllRead = () => {
    localStorage.setItem(READ_KEY, new Date().toISOString());
    if (taxDue) localStorage.setItem(TAX_ACK_KEY, '1');
    setHasNew(false);
  };

  return (
    <div className="relative">
      <button
        onClick={toggle}
        aria-label="お知らせ"
        className="relative grid h-9 w-9 place-items-center rounded-full bg-[#5f4530]/70 text-base ring-1 ring-[#8a6a4a] transition hover:bg-[#6d5138]"
      >
        🔔
        {hasNew && (
          <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-red-500 ring-2 ring-[#312217]" />
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-2 max-h-[70vh] w-80 overflow-y-auto rounded-xl border border-stone-200 bg-[#fffdf8] shadow-2xl">
            <div className="sticky top-0 flex items-center justify-between border-b border-stone-200 bg-[#fffdf8] px-4 py-2.5">
              <p className="text-xs font-bold text-stone-800">🔔 お知らせ</p>
              <button
                onClick={markAllRead}
                className="text-[10px] font-semibold text-orange-600 transition hover:text-orange-800 hover:underline"
              >
                すべて既読にする
              </button>
            </div>

            {taxDue && (
              <div className="mx-3 mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
                <p className="text-xs font-bold text-amber-900">🧾 確定申告のご案内</p>
                <p className="mt-1 text-[11px] leading-relaxed text-amber-800">
                  累計の売上分配が100万円を超えました。確定申告が必要な場合があります。詳しくは最寄りの税務署または税理士にご相談ください。
                </p>
              </div>
            )}

            {notifs.length === 0 && items.length === 0 && !taxDue ? (
              <p className="px-4 py-8 text-center text-xs text-stone-400">お知らせはまだありません。</p>
            ) : (
              <div className="p-3">
                {notifs.length > 0 && (
                  <>
                    <p className="px-1 pb-1.5 text-[10px] font-bold uppercase tracking-wide text-stone-400">
                      📌 進捗
                    </p>
                    <ul className="space-y-2">
                      {notifs.map((n) => (
                        <li key={n.id} className="rounded-lg bg-violet-50/70 p-3 ring-1 ring-violet-200">
                          <p className="text-[10px] font-semibold text-violet-400">{fmtDate(n.created_at)}</p>
                          <p className="mt-0.5 text-xs font-bold text-violet-900">{n.title}</p>
                          <p className="mt-1 whitespace-pre-line text-[11px] leading-relaxed text-violet-800">{n.body}</p>
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {items.length > 0 && (
                  <>
                    <p className="px-1 pb-1.5 pt-3 text-[10px] font-bold uppercase tracking-wide text-stone-400">
                      📢 運営からのお知らせ
                    </p>
                    <ul className="space-y-2">
                      {items.map((a) => (
                        <li key={a.id} className="rounded-lg bg-stone-50 p-3 ring-1 ring-stone-200">
                          <p className="text-[10px] font-semibold text-stone-400">{fmtDate(a.created_at)}</p>
                          <p className="mt-0.5 text-xs font-bold text-stone-800">{a.title}</p>
                          <p className="mt-1 whitespace-pre-line text-[11px] leading-relaxed text-stone-600">{a.body}</p>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
