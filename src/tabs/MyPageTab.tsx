import { useEffect, useState } from 'react';
import type { BalanceEntry, Idea, Order, Profile } from '../lib/types';
import { fmtDate, fmtYen } from '../lib/types';
import { fetchMyBalanceHistory, fetchMyOrders, fetchMyStats } from '../lib/data';
import OrdersTable from '../components/OrdersTable';

interface Props {
  profile: Profile;
  ideas: Idea[];
  favorites: Set<number>;
  onToggleFav: (idea: Idea) => void;
  onOpen: (id: number) => void;
}

export default function MyPageTab({ profile, ideas, favorites, onToggleFav, onOpen }: Props) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [history, setHistory] = useState<BalanceEntry[]>([]);
  const [stats, setStats] = useState({ rating_count: 0, rating_avg: 0, total_sales: 0 });

  useEffect(() => {
    if (!profile) return;
    fetchMyOrders(profile.id).then(setOrders).catch(() => {});
    fetchMyBalanceHistory(profile.id).then(setHistory).catch(() => {});
    fetchMyStats().then(setStats).catch(() => {});
  }, [profile]);

  const myIdeas = ideas.filter((i) => i.creator_id === profile.id);
  const myModeling = ideas.filter((i) => i.modeler_id === profile.id);
  const favIdeas = ideas.filter((i) => favorites.has(i.id));

  return (
    <div className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="投稿したアイデア" value={`${myIdeas.length}件`} icon="💡" />
        <Stat label="担当中のモデリング" value={`${myModeling.length}件`} icon="🛠️" />
        <Stat label="売上残高" value={`${fmtYen(profile.balance)}円`} icon="💰" />
        <Stat label="受け取った評価" value={`${stats.rating_count}件`} icon="⭐" />
        <Stat
          label="平均評価"
          value={stats.rating_count > 0 ? `★${stats.rating_avg}` : '—'}
          icon="🌟"
        />
        <Stat label="合計売上高" value={`${fmtYen(stats.total_sales)}円`} icon="📈" />
      </div>

      <section>
        <h3 className="mb-3 text-sm font-bold text-stone-800">❤️ ほしいものリスト</h3>
        {favIdeas.length === 0 ? (
          <p className="rounded-xl bg-stone-50 px-4 py-5 text-center text-xs text-stone-400 ring-1 ring-stone-200">
            商品購入タブで商品の 🤍 を押すと、ここに追加されます。
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {favIdeas.map((i) => (
              <div
                key={i.id}
                onClick={() => onOpen(i.id)}
                className="group flex cursor-pointer items-center gap-3 rounded-xl border border-stone-200 bg-[#fffdf8] p-3 shadow-sm transition hover:shadow-md"
              >
                <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-stone-100">
                  {i.images?.[0] ?? i.image_url ? (
                    <img src={i.images?.[0] ?? i.image_url} alt={i.title} className="h-full w-full object-cover" />
                  ) : (
                    <div className="grid h-full w-full place-items-center text-xl text-stone-300">🧩</div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-1 text-[13px] font-bold text-stone-800">{i.title}</p>
                  <p className="text-[11px] text-stone-500">
                    {fmtYen(i.price_physical)}円＋製造・配送費／STL {fmtYen(i.price_digital)}円
                  </p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleFav(i);
                  }}
                  title="ほしいものリストから削除"
                  className="shrink-0 text-lg transition hover:scale-110"
                >
                  ❤️
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-3 text-sm font-bold text-stone-800">📌 自分が投稿したアイデア</h3>
        <MiniList items={myIdeas.map((i) => ({ title: i.title, status: i.status }))} empty="投稿したアイデアはありません。" />
      </section>

      <section>
        <h3 className="mb-3 text-sm font-bold text-stone-800">🛠️ 自分がモデリング担当の案件</h3>
        <MiniList items={myModeling.map((i) => ({ title: i.title, status: i.status }))} empty="担当している案件はありません。" />
      </section>

      <section>
        <h3 className="mb-3 text-sm font-bold text-stone-800">📦 注文・購入履歴 ＆ 配送状況</h3>
        <OrdersTable orders={orders} />
      </section>

      <section>
        <h3 className="mb-3 text-sm font-bold text-stone-800">📖 残高変動履歴</h3>
        {history.length === 0 ? (
          <p className="rounded-xl bg-stone-50 px-4 py-6 text-center text-xs text-stone-400 ring-1 ring-stone-200">履歴はありません。</p>
        ) : (
          <div className="overflow-x-auto rounded-xl ring-1 ring-stone-200">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="bg-stone-50 text-[11px] uppercase tracking-wide text-stone-500">
                  <th className="px-4 py-2.5 font-semibold">日時</th>
                  <th className="px-4 py-2.5 font-semibold">内容</th>
                  <th className="px-4 py-2.5 font-semibold">金額</th>
                  <th className="px-4 py-2.5 font-semibold">有効期限</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-t border-stone-100 bg-[#fffdf8]">
                    <td className="px-4 py-2.5 text-stone-500">{fmtDate(h.created_at)}</td>
                    <td className="px-4 py-2.5 text-stone-700">{h.type}</td>
                    <td className={`px-4 py-2.5 font-bold ${h.amount >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                      {h.amount >= 0 ? '+' : ''}
                      {fmtYen(h.amount)}円
                    </td>
                    <td className="px-4 py-2.5 text-stone-500">
                      {h.expires_at ? `〜 ${fmtDate(h.expires_at)}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="flex items-center gap-3.5 rounded-2xl border border-stone-200 bg-[#fffdf8] p-4 shadow-sm">
      <span className="grid h-11 w-11 place-items-center rounded-xl bg-orange-50 text-xl">{icon}</span>
      <div>
        <p className="text-[11px] font-semibold text-stone-500">{label}</p>
        <p className="text-lg font-bold text-stone-900">{value}</p>
      </div>
    </div>
  );
}

function MiniList({ items, empty }: { items: { title: string; status: string }[]; empty: string }) {
  if (items.length === 0) {
    return <p className="rounded-xl bg-stone-50 px-4 py-5 text-center text-xs text-stone-400 ring-1 ring-stone-200">{empty}</p>;
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((it, idx) => (
        <div key={idx} className="flex items-center justify-between rounded-xl border border-stone-200 bg-[#fffdf8] px-4 py-3 shadow-sm">
          <span className="line-clamp-1 text-[13px] font-semibold text-stone-800">{it.title}</span>
          <span className="ml-2 shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-bold text-stone-600">
            {it.status}
          </span>
        </div>
      ))}
    </div>
  );
}
