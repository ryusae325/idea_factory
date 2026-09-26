import { useEffect, useState } from 'react';
import type { ExchangeRequest, Profile } from '../lib/types';
import { fmtDate, fmtYen } from '../lib/types';
import { fetchMyExchangeRequests, requestExchange, fetchAvailableGiftAmounts } from '../lib/data';
import { toast } from '../lib/toast';

interface Props {
  profile: Profile;
  onBalanceChanged: () => void;
}

const GIFT_TYPES = ['Amazonギフトカード', 'Apple Gift Card', 'Google Play ギフトコード'];

export default function SalesTab({ profile, onBalanceChanged }: Props) {
  const [type, setType] = useState(GIFT_TYPES[0]);
  const [amount, setAmount] = useState(1000);
  const [history, setHistory] = useState<ExchangeRequest[]>([]);
  const [available, setAvailable] = useState<{ exchange_type: string; amount: number; stock: number }[]>([]);
  const [busy, setBusy] = useState(false);

  const loadAvailable = () => fetchAvailableGiftAmounts().then(setAvailable).catch(() => {});

  useEffect(() => {
    fetchMyExchangeRequests(profile.id).then(setHistory).catch(() => {});
    loadAvailable();
  }, [profile]);

  const instantStock = available.find((a) => a.exchange_type === type && a.amount === amount)?.stock ?? 0;
  const instantAmounts = available.filter((a) => a.exchange_type === type);

  const apply = async () => {
    setBusy(true);
    try {
      const msg = await requestExchange(type, amount);
      toast(msg);
      const h = await fetchMyExchangeRequests(profile.id);
      setHistory(h);
      onBalanceChanged();
      loadAvailable();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-gradient-to-br from-orange-600 to-amber-700 p-6 text-white shadow-lg shadow-orange-500/25">
        <p className="text-xs font-semibold text-orange-200">現在の売上残高</p>
        <p className="mt-1 text-3xl font-extrabold tracking-wide">{fmtYen(profile.balance)}円</p>
        <p className="mt-2 text-[11px] text-orange-200">
          ※売上分配金の有効期限は付与から180日間です。1,000円分から各種デジタルギフトへ交換できます。
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-stone-200 bg-[#fffdf8] p-5 shadow-sm">
          <h3 className="text-sm font-bold text-stone-900">🎁 デジタルギフト交換申請</h3>

          <label className="mt-4 block text-xs font-bold text-stone-600">交換先</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2.5 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
          >
            {GIFT_TYPES.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>

          <label className="mt-3 block text-xs font-bold text-stone-600">交換金額 (円分)</label>
          {instantAmounts.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-bold text-emerald-700">⚡ 即時発行:</span>
              {instantAmounts.map((a) => (
                <button
                  key={`${a.exchange_type}|${a.amount}`}
                  onClick={() => setAmount(a.amount)}
                  className={`rounded-full px-2.5 py-1 text-[10px] font-bold ring-1 transition ${
                    amount === a.amount
                      ? 'bg-emerald-600 text-white ring-emerald-600'
                      : 'bg-emerald-50 text-emerald-700 ring-emerald-200 hover:bg-emerald-100'
                  }`}
                >
                  {fmtYen(a.amount)}円（在庫{a.stock}）
                </button>
              ))}
            </div>
          )}
          <input
            type="number"
            value={amount}
            min={1000}
            step={1000}
            onChange={(e) => setAmount(Number(e.target.value))}
            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2.5 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
          />
          <p className={`mt-1.5 text-[11px] font-semibold ${instantStock > 0 ? 'text-emerald-600' : 'text-stone-400'}`}>
            {instantStock > 0
              ? '⚡ 在庫あり — 申請するとすぐにギフトコードが発行されます'
              : 'この金額は運営の確認後に発行されます（通常数日以内）'}
          </p>

          <button
            onClick={apply}
            disabled={busy}
            className="mt-4 w-full rounded-xl bg-orange-600 py-3 text-sm font-bold text-white shadow-md shadow-orange-500/30 transition hover:bg-orange-700 disabled:opacity-50"
          >
            {busy ? '申請中…' : '交換申請を行う'}
          </button>
        </div>

        <div className="rounded-2xl border border-stone-200 bg-[#fffdf8] p-5 shadow-sm">
          <h3 className="text-sm font-bold text-stone-900">📜 交換申請履歴</h3>
          {history.length === 0 ? (
            <p className="mt-4 rounded-xl bg-stone-50 px-4 py-6 text-center text-xs text-stone-400 ring-1 ring-stone-200">
              交換申請はまだありません。
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {history.map((r) => (
                <div key={r.id} className="flex items-center justify-between rounded-xl bg-stone-50 px-4 py-3 ring-1 ring-stone-200">
                  <div>
                    <p className="text-[13px] font-semibold text-stone-800">
                      {r.exchange_type}（{fmtYen(r.amount)}円分）
                    </p>
                    <p className="text-[10px] text-stone-400">{fmtDate(r.created_at)}</p>
                  </div>
                  <div className="text-right">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        r.status === '完了' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
                      }`}
                    >
                      {r.status}
                    </span>
                    {r.gift_code && <p className="mt-1 max-w-[160px] truncate text-[10px] text-stone-500">コード: {r.gift_code}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
