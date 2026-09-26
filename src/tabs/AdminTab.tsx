import { useCallback, useEffect, useState } from 'react';
import type { ExchangeRequest, Order } from '../lib/types';
import { fmtDate, fmtYen } from '../lib/types';
import { fetchAllExchangeRequests, fetchAllOrders, processExchange, updateShipping } from '../lib/data';
import { toast } from '../lib/toast';

export default function AdminTab({ onChanged }: { onChanged: () => void }) {
  const [requests, setRequests] = useState<ExchangeRequest[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [tracking, setTracking] = useState<Record<number, string>>({});
  const [codes, setCodes] = useState<Record<number, string>>({});

  const reload = useCallback(async () => {
    const [r, o] = await Promise.all([fetchAllExchangeRequests(), fetchAllOrders()]);
    setRequests(r);
    setOrders(o);
  }, []);

  useEffect(() => {
    reload().catch((e) => toast((e as Error).message, 'error'));
  }, [reload]);

  const process = async (id: number) => {
    try {
      const msg = await processExchange(id, codes[id] ?? '');
      toast(msg);
      await reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const ship = async (id: number) => {
    try {
      const msg = await updateShipping(id, '発送済み', tracking[id] ?? '');
      toast(msg);
      await reload();
      onChanged();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <div className="space-y-8">
      <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5">
        <h3 className="text-sm font-bold text-amber-900">⚙️ 運営管理ダッシュボード</h3>
        <p className="mt-1 text-xs text-amber-700">交換申請の処理・注文の配送管理ができます。</p>
      </div>

      <section>
        <h3 className="mb-3 text-sm font-bold text-stone-800">🎁 ギフト交換申請の処理</h3>
        {requests.length === 0 ? (
          <Empty text="交換申請はありません。" />
        ) : (
          <div className="overflow-x-auto rounded-xl ring-1 ring-stone-200">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="bg-stone-50 text-[11px] uppercase tracking-wide text-stone-500">
                  <th className="px-4 py-2.5 font-semibold">ID</th>
                  <th className="px-4 py-2.5 font-semibold">ユーザー</th>
                  <th className="px-4 py-2.5 font-semibold">種類</th>
                  <th className="px-4 py-2.5 font-semibold">金額</th>
                  <th className="px-4 py-2.5 font-semibold">状態</th>
                  <th className="px-4 py-2.5 font-semibold">操作 / ギフトコード</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id} className="border-t border-stone-100 bg-[#fffdf8]">
                    <td className="px-4 py-2.5 text-stone-400">#{r.id}</td>
                    <td className="px-4 py-2.5 font-medium text-stone-800">
                      {r.requester?.display_name || r.requester?.username || '—'}
                    </td>
                    <td className="px-4 py-2.5 text-stone-600">{r.exchange_type}</td>
                    <td className="px-4 py-2.5 font-bold text-stone-700">{fmtYen(r.amount)}円</td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          r.status === '完了' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      {r.status === '未処理' ? (
                        <span className="flex items-center gap-2">
                          <input
                            value={codes[r.id] ?? ''}
                            onChange={(e) => setCodes((s) => ({ ...s, [r.id]: e.target.value }))}
                            placeholder="ギフトコード"
                            className="w-40 rounded-lg border border-stone-300 px-2.5 py-1.5 text-xs outline-none focus:border-orange-500"
                          />
                          <button
                            onClick={() => process(r.id)}
                            className="rounded-lg bg-orange-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-orange-700"
                          >
                            発行・処理
                          </button>
                        </span>
                      ) : (
                        <span className="text-xs text-stone-500">{r.gift_code}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-3 text-sm font-bold text-stone-800">📦 全ユーザーの注文・配送管理</h3>
        {orders.length === 0 ? (
          <Empty text="注文はありません。" />
        ) : (
          <div className="overflow-x-auto rounded-xl ring-1 ring-stone-200">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="bg-stone-50 text-[11px] uppercase tracking-wide text-stone-500">
                  <th className="px-4 py-2.5 font-semibold">ID</th>
                  <th className="px-4 py-2.5 font-semibold">購入者</th>
                  <th className="px-4 py-2.5 font-semibold">商品名</th>
                  <th className="px-4 py-2.5 font-semibold">種別</th>
                  <th className="px-4 py-2.5 font-semibold">状態</th>
                  <th className="px-4 py-2.5 font-semibold">追跡番号更新</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="border-t border-stone-100 bg-[#fffdf8]">
                    <td className="px-4 py-2.5 text-stone-400">#{o.id}</td>
                    <td className="px-4 py-2.5 font-medium text-stone-800">
                      {o.buyer?.display_name || o.buyer?.username || '—'}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-stone-800">{o.idea?.title ?? `#${o.idea_id}`}</td>
                    <td className="px-4 py-2.5 text-stone-600">
                      {o.item_type === 'physical' ? '物理プリント' : 'STLデータ'}
                    </td>
                    <td className="px-4 py-2.5 font-bold text-stone-700">{o.shipping_status}</td>
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-2">
                        <input
                          value={tracking[o.id] ?? o.tracking_number}
                          onChange={(e) => setTracking((s) => ({ ...s, [o.id]: e.target.value }))}
                          placeholder="追跡番号"
                          className="w-32 rounded-lg border border-stone-300 px-2.5 py-1.5 text-xs outline-none focus:border-orange-500"
                        />
                        <button
                          onClick={() => ship(o.id)}
                          className="rounded-lg bg-stone-800 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-stone-900"
                        >
                          更新
                        </button>
                      </span>
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

function Empty({ text }: { text: string }) {
  return (
    <p className="rounded-xl bg-stone-50 px-4 py-6 text-center text-xs text-stone-400 ring-1 ring-stone-200">
      {text}
    </p>
  );
}
