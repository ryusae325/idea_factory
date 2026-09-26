import type { Order } from '../lib/types';
import { fmtDate, fmtYen } from '../lib/types';
import { getStlDownloadUrl } from '../lib/data';
import { toast } from '../lib/toast';

export default function OrdersTable({ orders }: { orders: Order[] }) {
  const download = async (o: Order) => {
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

  if (orders.length === 0) {
    return <p className="rounded-xl bg-stone-50 px-4 py-6 text-center text-xs text-stone-400 ring-1 ring-stone-200">購入履歴はありません。</p>;
  }
  return (
    <div className="overflow-x-auto rounded-xl ring-1 ring-stone-200">
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr className="bg-stone-50 text-[11px] uppercase tracking-wide text-stone-500">
            <th className="px-4 py-2.5 font-semibold">注文日時</th>
            <th className="px-4 py-2.5 font-semibold">商品名</th>
            <th className="px-4 py-2.5 font-semibold">種別</th>
            <th className="px-4 py-2.5 font-semibold">金額</th>
            <th className="px-4 py-2.5 font-semibold">配送状態</th>
            <th className="px-4 py-2.5 font-semibold">追跡番号</th>
            <th className="px-4 py-2.5 font-semibold">データ</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id} className="border-t border-stone-100 bg-[#fffdf8]">
              <td className="px-4 py-2.5 text-stone-500">{fmtDate(o.created_at)}</td>
              <td className="px-4 py-2.5 font-medium text-stone-800">{o.idea?.title ?? `#${o.idea_id}`}</td>
              <td className="px-4 py-2.5">
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    o.item_type === 'physical' ? 'bg-orange-50 text-orange-600' : 'bg-emerald-50 text-emerald-600'
                  }`}
                >
                  {o.item_type === 'physical' ? '物理プリント' : 'STLデータ'}
                </span>
              </td>
              <td className="px-4 py-2.5 text-stone-700">{fmtYen(o.price)}円</td>
              <td className="px-4 py-2.5 font-bold text-stone-700">{o.shipping_status}</td>
              <td className="px-4 py-2.5 text-stone-500">{o.tracking_number || '—'}</td>
              <td className="px-4 py-2.5">
                {o.item_type === 'digital' && (
                  <button
                    onClick={() => download(o)}
                    className="rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-200 transition hover:bg-emerald-100"
                  >
                    ⬇️ STL
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
