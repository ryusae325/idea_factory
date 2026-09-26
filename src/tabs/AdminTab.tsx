import { useCallback, useEffect, useState } from 'react';
import type { ExchangeRequest, Order } from '../lib/types';
import { fmtDate, fmtYen } from '../lib/types';
import { fetchAllExchangeRequests, fetchAllOrders, processExchange, updateShipping, recordPartnerOrder, getStlDownloadUrl } from '../lib/data';
import { toast } from '../lib/toast';

export default function AdminTab({ onChanged }: { onChanged: () => void }) {
  const [requests, setRequests] = useState<ExchangeRequest[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [tracking, setTracking] = useState<Record<number, string>>({});
  const [codes, setCodes] = useState<Record<number, string>>({});
  const [partners, setPartners] = useState<Record<number, string>>({});
  const [showAll, setShowAll] = useState(false);

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

  const partnerOrder = async (id: number) => {
    try {
      const msg = await recordPartnerOrder(id, partners[id] ?? '');
      toast(msg);
      await reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const downloadStl = async (o: Order) => {
    if (!o.idea?.stl_path) return toast('3Dデータがまだ登録されていません', 'error');
    try {
      const url = await getStlDownloadUrl(o.idea.stl_path);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${o.idea?.title ?? 'model'}.stl`;
      a.click();
      toast('ダウンロードを開始しました');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const copyAddress = async (o: Order) => {
    const text = [
      `注文番号: #${o.id}`,
      `商品: ${o.idea?.title ?? `#${o.idea_id}`}（物理プリント）`,
      `お名前: ${o.shipping_name || '—'}`,
      `住所: ${o.shipping_postal || ''} ${o.shipping_address || '—'}`.trim(),
      `電話: ${o.shipping_phone || '—'}`,
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast('配送先情報をコピーしました');
    } catch {
      toast('コピーに失敗しました', 'error');
    }
  };

  const physicalOrders = orders.filter((o) => o.item_type === 'physical');
  const pendingPhysical = physicalOrders.filter((o) => o.partner_status !== '発注済');
  const visiblePhysical = showAll ? physicalOrders : pendingPhysical;

  return (
    <div className="space-y-8">
      <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5">
        <h3 className="text-sm font-bold text-amber-900">⚙️ 運営管理ダッシュボード</h3>
        <p className="mt-1 text-xs text-amber-700">
          交換申請の処理・注文の配送管理ができます。物理プリント注文は、3Dデータをダウンロードして製造パートナーに発注し、配送先（購入者）へ直接発送を依頼してください。
        </p>
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
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold text-stone-800">🏭 製造・発送管理（物理プリント）</h3>
          {physicalOrders.length > 0 && (
            <button
              onClick={() => setShowAll((s) => !s)}
              className="rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-orange-700 ring-1 ring-orange-200 transition hover:bg-orange-50"
            >
              {showAll ? '未発注のみ表示' : `すべて表示（${physicalOrders.length}件）`}
            </button>
          )}
        </div>
        {visiblePhysical.length === 0 ? (
          <Empty text={physicalOrders.length === 0 ? '物理プリントの注文はありません。' : '未発注の注文はありません。'} />
        ) : (
          <div className="space-y-4">
            {visiblePhysical.map((o) => (
              <div key={o.id} className="rounded-xl bg-[#fffdf8] p-5 ring-1 ring-stone-200">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-bold text-stone-800">
                    #{o.id} {o.idea?.title ?? `#${o.idea_id}`}
                    <span className="ml-2 text-xs font-medium text-stone-400">
                      {o.buyer?.display_name || o.buyer?.username || '—'} ・ {fmtDate(o.created_at)} ・ {fmtYen(o.price)}円
                      {o.fulfillment_fee > 0 ? `（＋製造・配送費 ${fmtYen(o.fulfillment_fee)}円）` : ''}
                    </span>
                  </p>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      o.partner_status === '発注済' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
                    }`}
                  >
                    {o.partner_status === '発注済' ? `発注済${o.partner_order_id ? `（${o.partner_order_id}）` : ''}` : '未発注'}
                  </span>
                </div>

                <div className="mt-3 rounded-lg bg-stone-50 p-3.5 ring-1 ring-stone-200">
                  <p className="text-[11px] font-bold text-stone-600">📦 配送先（購入者）</p>
                  {o.shipping_name || o.shipping_address ? (
                    <p className="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-stone-800">
                      {o.shipping_name || '—'}
                      {'\n'}
                      {o.shipping_postal || ''} {o.shipping_address || ''}
                      {o.shipping_phone ? `\nTel: ${o.shipping_phone}` : ''}
                    </p>
                  ) : (
                    <p className="mt-1 text-[13px] text-stone-400">配送先情報がありません（無料購入など）。</p>
                  )}
                  <button
                    onClick={() => copyAddress(o)}
                    className="mt-2 rounded-lg bg-stone-100 px-3 py-1.5 text-[10px] font-semibold text-stone-600 ring-1 ring-stone-200 transition hover:bg-stone-200"
                  >
                    📋 配送先情報をコピー
                  </button>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => downloadStl(o)}
                    className="rounded-lg bg-emerald-50 px-3 py-1.5 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-200 transition hover:bg-emerald-100"
                  >
                    ⬇️ 3Dデータ（STL）
                  </button>
                  {o.partner_status !== '発注済' ? (
                    <span className="flex items-center gap-2">
                      <input
                        value={partners[o.id] ?? ''}
                        onChange={(e) => setPartners((s) => ({ ...s, [o.id]: e.target.value }))}
                        placeholder="パートナー注文番号（任意）"
                        className="w-48 rounded-lg border border-stone-300 px-2.5 py-1.5 text-xs outline-none focus:border-orange-500"
                      />
                      <button
                        onClick={() => partnerOrder(o.id)}
                        className="rounded-lg bg-orange-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-orange-700"
                      >
                        🚚 発注済みにする
                      </button>
                    </span>
                  ) : (
                    <span className="text-[10px] text-stone-400">
                      発注日時: {o.ordered_at ? fmtDate(o.ordered_at) : '—'}
                    </span>
                  )}
                </div>

                <hr className="my-3 border-stone-200" />

                <p className="flex flex-wrap items-center gap-2 text-[11px] text-stone-500">
                  <span className="font-bold">配送状態: {o.shipping_status}</span>
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
                    📦 発送済みにする
                  </button>
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-3 text-sm font-bold text-stone-800">📦 全ユーザーの注文一覧</h3>
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
                  <th className="px-4 py-2.5 font-semibold">追跡番号</th>
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
                    <td className="px-4 py-2.5 text-stone-500">{o.tracking_number || '—'}</td>
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
