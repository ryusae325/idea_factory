import { useState } from 'react';
import type { Profile } from '../lib/types';
import { createIdea, uploadImage, tierMinPrice, SIZE_OPTIONS, type SizeTier } from '../lib/data';
import { authFetch } from '../lib/supabase';
import { toast } from '../lib/toast';

interface Props {
  profile: Profile;
  onCreated: () => void;
}

export default function CreatorTab({ profile, onCreated }: Props) {
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [creatorShare, setCreatorShare] = useState(50);
  const [sizeTier, setSizeTier] = useState<SizeTier>('S');
  const [priceDigital, setPriceDigital] = useState(500);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [checkBusy, setCheckBusy] = useState(false);
  const [checkResult, setCheckResult] = useState<{
    risk_level: string;
    summary: string;
    points: string[];
  } | null>(null);

  const modelerShare = 100 - creatorShare;
  /** プリント品価格はサイズ階級で自動決定 */
  const pricePhysical = tierMinPrice(sizeTier);

  const selectTier = (t: SizeTier) => {
    setSizeTier(t);
  };

  const checkInfringement = async () => {
    if (!title.trim()) return toast('アイデアのタイトルを入力してからチェックしてください', 'error');
    setCheckBusy(true);
    setCheckResult(null);
    try {
      const res = await authFetch('/api/check-infringement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, desc }),
      });
      const data = await res.json();
      if (res.ok && data.status === 'ok') {
        setCheckResult({
          risk_level: data.risk_level ?? '不明',
          summary: data.summary ?? '',
          points: Array.isArray(data.points) ? data.points : [],
        });
      } else {
        toast(data.message || 'AIチェックに失敗しました', 'error');
      }
    } catch {
      toast('通信エラーが発生しました', 'error');
    } finally {
      setCheckBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return toast('タイトルを入力してください', 'error');
    if (priceDigital > 0 && priceDigital < 300) {
      return toast('STLデータ価格は300円以上に設定してください（無料の場合は0円）', 'error');
    }
    setBusy(true);
    try {
      const images: string[] = [];
      for (const f of files) {
        images.push(await uploadImage(profile.id, f));
      }
      await createIdea({
        title: title.trim(),
        description: desc.trim(),
        image_url: images[0] ?? '',
        images,
        creator_id: profile.id,
        creator_share: creatorShare,
        modeler_share: modelerShare,
        price_physical: pricePhysical,
        price_digital: Math.max(0, priceDigital),
        mfg_cost: 0,
        size_tier: sizeTier,
      });
      toast('アイデアを投稿しました！');
      setTitle('');
      setDesc('');
      setSizeTier('S');
      setFiles([]);
      onCreated();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-3">
      <form onSubmit={submit} className="rounded-2xl border border-stone-200 bg-[#fffdf8] p-5 shadow-sm">
        <h3 className="text-base font-bold text-stone-900">➕ 新しいアイデアを投稿</h3>

        <p className="mt-3 text-[11px] font-bold tracking-wide text-orange-600">1. 基本情報</p>
        <label className="mt-1.5 block text-xs font-bold text-stone-600">タイトル *</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          placeholder="例: 卓上ミニハンディファンスタンド"
          className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2.5 text-sm outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
        />
        <label className="mt-2.5 block text-xs font-bold text-stone-600">詳細説明・仕様</label>
        <textarea
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          rows={4}
          placeholder="商品の詳細やデザインの希望、サイズ感など"
          className="mt-1 w-full resize-none rounded-lg border border-stone-300 px-3 py-2.5 text-sm outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
        />
        <button
          type="button"
          onClick={checkInfringement}
          disabled={checkBusy}
          className="mt-2.5 rounded-lg bg-rose-50 px-3 py-2 text-[11px] font-bold text-rose-600 ring-1 ring-rose-200 transition hover:bg-rose-100 disabled:opacity-50"
        >
          {checkBusy ? '🤖 AIチェック中…' : '🔍 権利侵害をAIでチェック'}
        </button>
        {checkBusy && (
          <p className="mt-2 text-[11px] font-medium text-rose-600">
            商標・著作権・類似性をチェック中です…（10秒ほどかかります）
          </p>
        )}
        {checkResult && (
          <div
            className={`mt-2 rounded-xl p-3 ring-1 ${
              checkResult.risk_level === '高'
                ? 'bg-rose-50 ring-rose-200'
                : checkResult.risk_level === '中'
                  ? 'bg-amber-50 ring-amber-200'
                  : 'bg-emerald-50 ring-emerald-200'
            }`}
          >
            <p
              className={`text-[11px] font-bold ${
                checkResult.risk_level === '高'
                  ? 'text-rose-700'
                  : checkResult.risk_level === '中'
                    ? 'text-amber-700'
                    : 'text-emerald-700'
              }`}
            >
              リスク: {checkResult.risk_level}
            </p>
            {checkResult.summary && (
              <p className="mt-1 text-[12px] leading-relaxed text-stone-700">{checkResult.summary}</p>
            )}
            {checkResult.points.length > 0 && (
              <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-stone-600">
                {checkResult.points.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            )}
            <p className="mt-1.5 text-[10px] text-stone-400">
              ※AIによる参考評価です。法的判断の代わりにはなりません。
            </p>
          </div>
        )}

        <hr className="my-4 border-stone-100" />
        <p className="text-[11px] font-bold tracking-wide text-orange-600">2. サイズと価格</p>
        <p className="mt-1 text-[11px] text-stone-400">サイズを選ぶとプリント品の価格が自動で決まります</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {SIZE_OPTIONS.map((o) => (
            <label
              key={o.tier}
              className={`cursor-pointer rounded-xl border px-3 py-2.5 transition ${
                sizeTier === o.tier
                  ? 'border-orange-500 bg-orange-50 ring-2 ring-orange-100'
                  : 'border-stone-300 bg-white hover:border-stone-400'
              }`}
            >
              <span className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="size_tier"
                  checked={sizeTier === o.tier}
                  onChange={() => selectTier(o.tier)}
                  className="accent-orange-600"
                />
                <b className="text-[13px] text-stone-800">{o.tier}</b>
                <span className="text-[10px] text-stone-400">{o.range.split(' × ')[0]}まで</span>
              </span>
              <span className="mt-1 block text-[13px] font-bold text-orange-600">
                ¥{o.min.toLocaleString()}
              </span>
              <span className="block text-[10px] text-stone-400">＋配送費 ¥{o.fee.toLocaleString()}</span>
            </label>
          ))}
        </div>

        <hr className="my-4 border-stone-100" />
        <p className="text-[11px] font-bold tracking-wide text-orange-600">3. 収益設定</p>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-bold text-stone-600">プランナー分配率 (%)</label>
            <input
              type="number"
              min={0}
              max={100}
              value={creatorShare}
              onChange={(e) => setCreatorShare(Math.min(100, Math.max(0, Number(e.target.value))))}
              className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-stone-600">モデラー (%)</label>
            <input
              type="number"
              value={modelerShare}
              readOnly
              className="mt-1 w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-500"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-bold text-stone-600">STLデータ 価格 (円)</label>
            <input
              type="number"
              min={300}
              value={priceDigital}
              onChange={(e) => setPriceDigital(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
            />
            <p className="mt-0.5 text-[11px] text-stone-400">最低 ¥300（無料なら 0）</p>
          </div>
        </div>

        <hr className="my-4 border-stone-100" />
        <p className="text-[11px] font-bold tracking-wide text-orange-600">4. 画像（任意）</p>
        <p className="mt-1 text-[11px] text-stone-400">
          📷 角度違いの画像（正面・横・上）を複数枚添えるとモデラーがイメージしやすくなります
        </p>
        <input
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          className="mt-1.5 w-full text-xs text-stone-500 file:mr-3 file:rounded-lg file:border-0 file:bg-stone-100 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-stone-600 hover:file:bg-stone-200"
        />
        {files.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {files.map((f, i) => (
              <span
                key={`${f.name}-${i}`}
                className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2.5 py-1 text-[10px] font-semibold text-orange-700 ring-1 ring-orange-200"
              >
                🖼️ {f.name.length > 14 ? `${f.name.slice(0, 14)}…` : f.name}
                <button
                  type="button"
                  onClick={() => setFiles((s) => s.filter((_, j) => j !== i))}
                  className="ml-0.5 font-bold text-orange-400 hover:text-orange-600"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="brass-btn mt-5 w-full rounded-xl py-3 text-sm font-bold text-[#3a2715] shadow-md transition hover:brightness-110 disabled:opacity-50"
        >
          {busy ? '投稿中…' : 'アイデアを投稿する'}
        </button>
      </form>

      <details className="group rounded-xl border border-stone-200 bg-[#fffdf8] open:shadow-sm">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 text-[12px] font-bold text-stone-600 transition hover:text-stone-900">
          <span>💡 アイデア投稿の流れ</span>
          <span className="text-[10px] font-medium text-stone-400 group-open:hidden">開く ▾</span>
          <span className="hidden text-[10px] font-medium text-stone-400 group-open:inline">閉じる ▴</span>
        </summary>
        <ol className="space-y-2 border-t border-stone-100 px-4 pb-3.5 pt-3 text-[12px] leading-relaxed text-stone-600">
          <li className="flex gap-2">
            <Step n={1} />
            <span>
              <b>アイデアを投稿</b> — 画像は角度違いを複数枚添えるとモデラーに伝わりやすいです。
            </span>
          </li>
          <li className="flex gap-2">
            <Step n={2} />
            <span>
              <b>モデラーが引き受け</b> — コメント欄で仕様を相談しながら制作が進みます。
            </span>
          </li>
          <li className="flex gap-2">
            <Step n={3} />
            <span>
              <b>3Dデータ完成 → 販売開始</b> — プリント品・STLデータが商品カタログに掲載されます。
            </span>
          </li>
          <li className="flex gap-2">
            <Step n={4} />
            <span>
              <b>売上を自動分配</b> — 設定した分配率で残高に加算、ギフトへ交換できます。
            </span>
          </li>
        </ol>
      </details>
    </div>
  );
}

function Step({ n }: { n: number }) {
  return (
    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-orange-600 text-[11px] font-bold text-white">
      {n}
    </span>
  );
}
