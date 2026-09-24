import { useEffect, useState } from 'react';
import type { ExchangeRequest, Profile } from '../lib/types';
import { fmtDate, fmtYen } from '../lib/types';
import { fetchMyExchangeRequests, requestExchange } from '../lib/data';
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
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchMyExchangeRequests(profile.id).then(setHistory).catch(() => {});
  }, [profile]);

  const apply = async () => {
    setBusy(true);
    try {
      const msg = await requestExchange(type, amount);
      toast(msg);
      const h = await fetchMyExchangeRequests(profile.id);
      setHistory(h);
      onBalanceChanged();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-700 p-6 text-white shadow-lg shadow-indigo-500/25">
        <p className="text-xs font-semibold text-indigo-200">現在の売上残高</p>
        <p className="mt-1 text-3xl font-extrabold tracking-wide">{fmtYen(profile.balance)}円</p>
        <p className="mt-2 text-[11px] text-indigo-200">
          ※売上分配金の有効期限は付与から180日間です。1,000円分から各種デジタルギフトへ交換できます。
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-bold text-slate-900">🎁 デジタルギフト交換申請</h3>

          <label className="mt-4 block text-xs font-bold text-slate-600">交換先</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          >
            {GIFT_TYPES.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>

          <label className="mt-3 block text-xs font-bold text-slate-600">交換金額 (円分)</label>
          <input
            type="number"
            value={amount}
            min={1000}
            step={1000}
            onChange={(e) => setAmount(Number(e.target.value))}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          />

          <button
            onClick={apply}
            disabled={busy}
            className="mt-4 w-full rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white shadow-md shadow-indigo-500/30 transition hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? '申請中…' : '交換申請を行う'}
          </button>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-bold text-slate-900">📜 交換申請履歴</h3>
          {history.length === 0 ? (
            <p className="mt-4 rounded-xl bg-slate-50 px-4 py-6 text-center text-xs text-slate-400 ring-1 ring-slate-200">
              交換申請はまだありません。
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {history.map((r) => (
                <div key={r.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-slate-200">
                  <div>
                    <p className="text-[13px] font-semibold text-slate-800">
                      {r.exchange_type}（{fmtYen(r.amount)}円分）
                    </p>
                    <p className="text-[10px] text-slate-400">{fmtDate(r.created_at)}</p>
                  </div>
                  <div className="text-right">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        r.status === '完了' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
                      }`}
                    >
                      {r.status}
                    </span>
                    {r.gift_code && <p className="mt-1 max-w-[160px] truncate text-[10px] text-slate-500">コード: {r.gift_code}</p>}
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
