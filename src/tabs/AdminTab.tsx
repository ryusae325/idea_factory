import { useCallback, useEffect, useState } from 'react';
import type { Announcement, ExchangeRequest, GiftStock, Order } from '../lib/types';
import { fmtDate, fmtYen } from '../lib/types';
import { fetchAllExchangeRequests, fetchAllOrders, processExchange, updateShipping, recordPartnerOrder, getStlDownloadUrl, fetchAnnouncements, createAnnouncement, deactivateAnnouncement, fetchGiftStock, addGiftCodes, deleteGiftCode } from '../lib/data';
import { toast } from '../lib/toast';

type Section = 'exchange' | 'fulfillment' | 'orders' | 'giftstock' | 'announcements';

export default function AdminTab({ onChanged }: { onChanged: () => void }) {
  const [requests, setRequests] = useState<ExchangeRequest[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [tracking, setTracking] = useState<Record<number, string>>({});
  const [codes, setCodes] = useState<Record<number, string>>({});
  const [partners, setPartners] = useState<Record<number, string>>({});
  const [showAll, setShowAll] = useState(false);
  const [section, setSection] = useState<Section>('exchange');
  const [annList, setAnnList] = useState<Announcement[]>([]);
  const [annTitle, setAnnTitle] = useState('');
  const [annBody, setAnnBody] = useState('');
  const [annBusy, setAnnBusy] = useState(false);
  const [stock, setStock] = useState<GiftStock[]>([]);
  const [stockType, setStockType] = useState('Amazonギフトカード');
  const [stockAmount, setStockAmount] = useState(1000);
  const [stockCodes, setStockCodes] = useState('');
  const [stockBusy, setStockBusy] = useState(false);

  const reload = useCallback(async () => {
    const [r, o, a, s] = await Promise.all([fetchAllExchangeRequests(), fetchAllOrders(), fetchAnnouncements(), fetchGiftStock()]);
    setRequests(r);
    setOrders(o);
    setAnnList(a);
    setStock(s);
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

  const postAnnouncement = async () => {
    if (!annTitle.trim() || !annBody.trim()) return toast('タイトルと本文を入力してください', 'error');
    setAnnBusy(true);
    try {
      await createAnnouncement(annTitle.trim(), annBody.trim());
      toast('お知らせを投稿しました');
      setAnnTitle('');
      setAnnBody('');
      await reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setAnnBusy(false);
    }
  };

  const removeAnnouncement = async (id: number) => {
    try {
      await deactivateAnnouncement(id);
      toast('お知らせを削除しました');
      await reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const registerStock = async () => {
    const list = stockCodes.split('\n').map((c) => c.trim()).filter(Boolean);
    if (!list.length) return toast('ギフトコードを入力してください（1行に1コード）', 'error');
    if (!Number.isFinite(stockAmount) || stockAmount <= 0) return toast('金額を正しく入力してください', 'error');
    setStockBusy(true);
    try {
      await addGiftCodes(stockType, stockAmount, list);
      toast(`${list.length}件のコードを在庫に登録しました`);
      setStockCodes('');
      await reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setStockBusy(false);
    }
  };

  const removeStockCode = async (id: number) => {
    try {
      await deleteGiftCode(id);
      toast('コードを削除しました');
      await reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const physicalOrders = orders.filter((o) => o.item_type === 'physical');
  const pendingPhysical = physicalOrders.filter((o) => o.partner_status !== '発注済');
  const toShip = physicalOrders.filter((o) => o.shipping_status !== '発送済み');
  const pendingRequests = requests.filter((r) => r.status === '未処理');
  const visiblePhysical = showAll ? physicalOrders : pendingPhysical;

  const kpis: { key: Section; label: string; value: string; icon: string; accent: string }[] = [
    { key: 'exchange', label: '未処理の交換申請', value: `${pendingRequests.length}件`, icon: '🎁', accent: 'text-amber-600' },
    { key: 'fulfillment', label: '未発注の物理注文', value: `${pendingPhysical.length}件`, icon: '🏭', accent: 'text-orange-600' },
    { key: 'fulfillment', label: '発送待ち', value: `${toShip.length}件`, icon: '📦', accent: 'text-stone-700' },
    { key: 'orders', label: '総注文数', value: `${orders.length}件`, icon: '🧾', accent: 'text-emerald-600' },
  ];

  const tabs: { key: Section; label: string; badge: number }[] = [
    { key: 'exchange', label: '🎁 交換申請', badge: pendingRequests.length },
    { key: 'fulfillment', label: '🏭 製造・発送', badge: pendingPhysical.length },
    { key: 'orders', label: '📦 注文一覧', badge: 0 },
    { key: 'giftstock', label: '🎫 ギフト在庫', badge: 0 },
    { key: 'announcements', label: '📢 お知らせ', badge: 0 },
  ];

  // 在庫を種類×金額ごとに集計
  const stockGroups = Object.entries(
    stock.reduce<Record<string, { type: string; amount: number; unused: GiftStock[]; used: number }>>((acc, s) => {
      const key = `${s.exchange_type}|${s.amount}`;
      acc[key] ??= { type: s.exchange_type, amount: s.amount, unused: [], used: 0 };
      if (s.used_by) acc[key].used += 1;
      else acc[key].unused.push(s);
      return acc;
    }, {}),
  ).sort((a, b) => (a[1].type === b[1].type ? a[1].amount - b[1].amount : a[1].type.localeCompare(b[1].type)));

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-amber-900">⚙️ 運営管理ダッシュボード</h3>
          <button
            onClick={() => reload().catch((e) => toast((e as Error).message, 'error'))}
            className="rounded-lg bg-white px-3 py-1.5 text-[11px] font-bold text-amber-800 ring-1 ring-amber-300 transition hover:bg-amber-100"
          >
            🔄 更新
          </button>
        </div>
        <p className="mt-1 text-xs text-amber-700">
          物理プリント注文は、3Dデータをダウンロードして製造パートナーに発注し、配送先（購入者）へ直接発送を依頼してください。
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k, i) => (
          <button
            key={i}
            onClick={() => setSection(k.key)}
            className={`rounded-xl bg-[#fffdf8] p-4 text-left ring-1 ring-stone-200 transition hover:shadow-md ${
              section === k.key ? 'ring-2 ring-orange-400' : ''
            }`}
          >
            <p className="text-[11px] font-bold text-stone-500">
              {k.icon} {k.label}
            </p>
            <p className={`mt-1 text-xl font-extrabold ${k.accent}`}>{k.value}</p>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setSection(t.key)}
            className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold transition ${
              section === t.key
                ? 'bg-stone-800 text-white shadow-md'
                : 'bg-[#fffdf8] text-stone-600 ring-1 ring-stone-200 hover:bg-stone-100'
            }`}
          >
            {t.label}
            {t.badge > 0 && (
              <span
                className={`grid h-5 min-w-5 place-items-center rounded-full px-1 text-[10px] font-extrabold ${
                  section === t.key ? 'bg-orange-500 text-white' : 'bg-orange-100 text-orange-700'
                }`}
              >
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {section === 'exchange' && (
        <section>
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
      )}

      {section === 'fulfillment' && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-semibold text-stone-500">
              {showAll ? `すべての物理プリント注文（${physicalOrders.length}件）` : '未発注のみ表示中'}
            </p>
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
      )}

      {section === 'orders' && (
        <section>
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
      )}
      {section === 'giftstock' && (
        <section className="space-y-4">
          <div className="rounded-xl bg-[#fffdf8] p-5 ring-1 ring-stone-200">
            <p className="text-sm font-bold text-stone-800">🎫 ギフトコードの在庫登録</p>
            <p className="mt-1 text-[11px] leading-relaxed text-stone-500">
              事前に購入したギフトコードをここに登録しておくと、ユーザーが<b>同じ種類・同じ金額</b>で交換申請した際に自動発行されます（在庫がない場合は手動処理の「未処理」になります）。
            </p>
            <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-bold text-stone-600">ギフト種類</label>
                <select
                  value={stockType}
                  onChange={(e) => setStockType(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-orange-500"
                >
                  <option>Amazonギフトカード</option>
                  <option>Apple Gift Card</option>
                  <option>Google Play ギフトコード</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-stone-600">金額 (円分)</label>
                <input
                  type="number"
                  min={1}
                  step={500}
                  value={stockAmount}
                  onChange={(e) => setStockAmount(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-orange-500"
                />
              </div>
            </div>
            <textarea
              value={stockCodes}
              onChange={(e) => setStockCodes(e.target.value)}
              placeholder={'ギフトコードを1行に1つずつ貼り付け\n例:\nABCD-EFGH-IJKL\nMNOP-QRST-UVWX'}
              rows={5}
              className="mt-2.5 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-orange-500"
            />
            <button
              onClick={registerStock}
              disabled={stockBusy}
              className="mt-2.5 rounded-lg bg-orange-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-orange-700 disabled:opacity-50"
            >
              {stockBusy ? '登録中…' : '在庫に登録する'}
            </button>
          </div>

          {stockGroups.length === 0 ? (
            <Empty text="登録済みのギフトコード在庫はありません。" />
          ) : (
            <div className="space-y-2">
              {stockGroups.map(([key, g]) => (
                <details key={key} className="group rounded-xl bg-[#fffdf8] ring-1 ring-stone-200">
                  <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3">
                    <span className="text-xs font-bold text-stone-800">
                      {g.type}（{fmtYen(g.amount)}円分）
                    </span>
                    <span className="flex items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${g.unused.length > 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-stone-100 text-stone-400'}`}>
                        在庫 {g.unused.length}件
                      </span>
                      <span className="text-[10px] text-stone-400">使用済 {g.used}件</span>
                      <span className="text-[10px] font-medium text-stone-400 group-open:hidden">開く ▾</span>
                      <span className="hidden text-[10px] font-medium text-stone-400 group-open:inline">閉じる ▴</span>
                    </span>
                  </summary>
                  <div className="space-y-1 border-t border-stone-100 px-4 pb-3 pt-2">
                    {g.unused.map((s) => (
                      <div key={s.id} className="flex items-center justify-between gap-2 text-[11px]">
                        <code className="truncate text-stone-600">{s.code}</code>
                        <button
                          onClick={() => removeStockCode(s.id)}
                          className="shrink-0 rounded-lg bg-stone-100 px-2 py-1 text-[10px] font-semibold text-stone-500 ring-1 ring-stone-200 transition hover:bg-red-50 hover:text-red-600"
                        >
                          削除
                        </button>
                      </div>
                    ))}
                    {g.used > 0 && <p className="text-[10px] text-stone-400">使用済みコード {g.used}件は履歴保持のため表示しません。</p>}
                  </div>
                </details>
              ))}
            </div>
          )}
        </section>
      )}

      {section === 'announcements' && (
        <section className="space-y-4">
          <div className="rounded-xl bg-[#fffdf8] p-5 ring-1 ring-stone-200">
            <p className="text-sm font-bold text-stone-800">📢 運営からのお知らせを投稿</p>
            <p className="mt-1 text-[11px] text-stone-500">
              投稿した内容は全ユーザーの 🔔 通知パネルに表示されます（更新情報・メンテナンス告知などにご利用ください）。
            </p>
            <div className="mt-3 space-y-2.5">
              <input
                value={annTitle}
                onChange={(e) => setAnnTitle(e.target.value)}
                placeholder="タイトル（例: サービス修正のお知らせ）"
                className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-orange-500"
              />
              <textarea
                value={annBody}
                onChange={(e) => setAnnBody(e.target.value)}
                placeholder="本文・詳細"
                rows={4}
                className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-orange-500"
              />
              <button
                onClick={postAnnouncement}
                disabled={annBusy}
                className="rounded-lg bg-orange-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-orange-700 disabled:opacity-50"
              >
                {annBusy ? '投稿中…' : '投稿する'}
              </button>
            </div>
          </div>

          {annList.length === 0 ? (
            <Empty text="投稿済みのお知らせはありません。" />
          ) : (
            <div className="space-y-2">
              {annList.map((a) => (
                <div key={a.id} className="flex items-start justify-between gap-3 rounded-xl bg-[#fffdf8] p-4 ring-1 ring-stone-200">
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold text-stone-400">{fmtDate(a.created_at)}</p>
                    <p className="text-xs font-bold text-stone-800">{a.title}</p>
                    <p className="mt-0.5 whitespace-pre-line text-[11px] leading-relaxed text-stone-600">{a.body}</p>
                  </div>
                  <button
                    onClick={() => removeAnnouncement(a.id)}
                    className="shrink-0 rounded-lg bg-stone-100 px-2.5 py-1.5 text-[10px] font-semibold text-stone-500 ring-1 ring-stone-200 transition hover:bg-red-50 hover:text-red-600"
                  >
                    🗑 削除
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
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
