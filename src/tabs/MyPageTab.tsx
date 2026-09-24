import { useEffect, useState } from 'react';
import type { BalanceEntry, Order, Profile } from '../lib/types';
import { fmtDate, fmtYen } from '../lib/types';
import { fetchMyBalanceHistory, fetchMyOrders } from '../lib/data';
import OrdersTable from '../components/OrdersTable';

interface Props {
  profile: Profile;
  ideas: { id: number; title: string; status: string; creator_id: string; modeler_id: string | null }[];
}

export default function MyPageTab({ profile, ideas }: Props) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [history, setHistory] = useState<BalanceEntry[]>([]);

  useEffect(() => {
    if (!profile) return;
    fetchMyOrders(profile.id).then(setOrders).catch(() => {});
    fetchMyBalanceHistory(profile.id).then(setHistory).catch(() => {});
  }, [profile]);

  const myIdeas = ideas.filter((i) => i.creator_id === profile.id);
  const myModeling = ideas.filter((i) => i.modeler_id === profile.id);

  return (
    <div className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="投稿したアイデア" value={`${myIdeas.length}件`} icon="💡" />
        <Stat label="担当中のモデリング" value={`${myModeling.length}件`} icon="🛠️" />
        <Stat label="売上残高" value={`${fmtYen(profile.balance)}円`} icon="💰" />
      </div>

      <section>
        <h3 className="mb-3 text-sm font-bold text-slate-800">📌 自分が投稿したアイデア</h3>
        <MiniList items={myIdeas.map((i) => ({ title: i.title, status: i.status }))} empty="投稿したアイデアはありません。" />
      </section>

      <section>
        <h3 className="mb-3 text-sm font-bold text-slate-800">🛠️ 自分がモデリング担当の案件</h3>
        <MiniList items={myModeling.map((i) => ({ title: i.title, status: i.status }))} empty="担当している案件はありません。" />
      </section>

      <section>
        <h3 className="mb-3 text-sm font-bold text-slate-800">📦 注文・購入履歴 ＆ 配送状況</h3>
        <OrdersTable orders={orders} />
      </section>

      <section>
        <h3 className="mb-3 text-sm font-bold text-slate-800">📖 残高変動履歴</h3>
        {history.length === 0 ? (
          <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-xs text-slate-400 ring-1 ring-slate-200">履歴はありません。</p>
        ) : (
          <div className="overflow-x-auto rounded-xl ring-1 ring-slate-200">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2.5 font-semibold">日時</th>
                  <th className="px-4 py-2.5 font-semibold">内容</th>
                  <th className="px-4 py-2.5 font-semibold">金額</th>
                  <th className="px-4 py-2.5 font-semibold">有効期限</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-t border-slate-100 bg-white">
                    <td className="px-4 py-2.5 text-slate-500">{fmtDate(h.created_at)}</td>
                    <td className="px-4 py-2.5 text-slate-700">{h.type}</td>
                    <td className={`px-4 py-2.5 font-bold ${h.amount >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                      {h.amount >= 0 ? '+' : ''}
                      {fmtYen(h.amount)}円
                    </td>
                    <td className="px-4 py-2.5 text-slate-500">
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
    <div className="flex items-center gap-3.5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <span className="grid h-11 w-11 place-items-center rounded-xl bg-indigo-50 text-xl">{icon}</span>
      <div>
        <p className="text-[11px] font-semibold text-slate-500">{label}</p>
        <p className="text-lg font-bold text-slate-900">{value}</p>
      </div>
    </div>
  );
}

function MiniList({ items, empty }: { items: { title: string; status: string }[]; empty: string }) {
  if (items.length === 0) {
    return <p className="rounded-xl bg-slate-50 px-4 py-5 text-center text-xs text-slate-400 ring-1 ring-slate-200">{empty}</p>;
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((it, idx) => (
        <div key={idx} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <span className="line-clamp-1 text-[13px] font-semibold text-slate-800">{it.title}</span>
          <span className="ml-2 shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
            {it.status}
          </span>
        </div>
      ))}
    </div>
  );
}
