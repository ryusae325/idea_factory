import { useState } from 'react';
import type { Profile } from '../lib/types';
import { createIdea, uploadImage } from '../lib/data';
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
  const [pricePhysical, setPricePhysical] = useState(2500);
  const [priceDigital, setPriceDigital] = useState(500);
  const [file, setFile] = useState<File | null>(null);
  const [aiUrl, setAiUrl] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checkBusy, setCheckBusy] = useState(false);
  const [checkResult, setCheckResult] = useState<{
    risk_level: string;
    summary: string;
    points: string[];
  } | null>(null);

  const modelerShare = 100 - creatorShare;

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

  const generateAIImage = async () => {
    if (!title.trim()) return toast('AI生成にはまず「タイトル」を入力してください', 'error');
    setAiBusy(true);
    setAiUrl(null);
    try {
      const res = await authFetch('/api/generate-ai-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, desc }),
      });
      const data = await res.json();
      if (res.ok && data.status === 'ok') {
        if (data.url) {
          setAiUrl(data.url);
          toast('AIイメージを生成しました！');
        } else {
          toast('AI画像生成は現在準備中です。画像をアップロードするか、テキストのみで投稿できます。', 'info');
        }
      } else {
        toast(data.message || '生成に失敗しました', 'error');
      }
    } catch {
      toast('通信エラーが発生しました', 'error');
    } finally {
      setAiBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return toast('タイトルを入力してください', 'error');
    setBusy(true);
    try {
      let imageUrl = aiUrl ?? '';
      if (file) {
        imageUrl = await uploadImage(profile.id, file);
      }
      await createIdea({
        title: title.trim(),
        description: desc.trim(),
        image_url: imageUrl,
        creator_id: profile.id,
        creator_share: creatorShare,
        modeler_share: modelerShare,
        price_physical: Math.max(0, pricePhysical),
        price_digital: Math.max(0, priceDigital),
      });
      toast('アイデアを投稿しました！');
      setTitle('');
      setDesc('');
      setFile(null);
      setAiUrl(null);
      onCreated();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
      <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-base font-bold text-slate-900">➕ 新しいアイデアを投稿</h3>

        <label className="mt-4 block text-xs font-bold text-slate-600">タイトル *</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          placeholder="例: 卓上ミニハンディファンスタンド"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
        />

        <label className="mt-3 block text-xs font-bold text-slate-600">詳細説明・仕様</label>
        <textarea
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          rows={4}
          placeholder="商品の詳細やデザインの希望、サイズ感など"
          className="mt-1 w-full resize-none rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
        />

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={checkInfringement}
            disabled={checkBusy}
            className="flex-1 rounded-lg bg-rose-50 px-3 py-2 text-[11px] font-bold text-rose-600 ring-1 ring-rose-200 transition hover:bg-rose-100 disabled:opacity-50"
          >
            {checkBusy ? '🤖 チェック中…' : '🔍 権利侵害をAIでチェック'}
          </button>
          <button
            type="button"
            onClick={generateAIImage}
            disabled={aiBusy}
            className="flex-1 rounded-lg bg-violet-50 px-3 py-2 text-[11px] font-bold text-violet-700 ring-1 ring-violet-200 transition hover:bg-violet-100 disabled:opacity-50"
          >
            {aiBusy ? '🤖 生成中…' : '✨ AIでイメージ画像を作成'}
          </button>
        </div>

        {checkBusy && (
          <p className="mt-2 text-[11px] font-medium text-rose-600">
            AIが商標・著作権・類似性をチェック中です…（10秒ほどかかります）
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
            <p className="text-[11px] font-bold">
              <span
                className={
                  checkResult.risk_level === '高'
                    ? 'text-rose-700'
                    : checkResult.risk_level === '中'
                      ? 'text-amber-700'
                      : 'text-emerald-700'
                }
              >
                リスク: {checkResult.risk_level}
              </span>
            </p>
            {checkResult.summary && (
              <p className="mt-1 text-[12px] leading-relaxed text-slate-700">{checkResult.summary}</p>
            )}
            {checkResult.points.length > 0 && (
              <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-slate-600">
                {checkResult.points.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            )}
            <p className="mt-1.5 text-[10px] text-slate-400">
              ※AIによる参考評価です。法的判断の代わりにはなりません。
            </p>
          </div>
        )}

        {aiBusy && (
          <p className="mt-2 text-[11px] font-medium text-violet-600">
            AIがモデラー向けイメージ画像を生成中です…（10秒ほどかかります）
          </p>
        )}
        {aiUrl && (
          <div className="mt-2 rounded-xl border border-violet-200 bg-violet-50 p-3">
            <p className="text-[10px] font-bold text-violet-700">✨ AI生成イメージ（投稿時に保存されます）</p>
            <img src={aiUrl} alt="AI生成イメージ" className="mt-1.5 h-32 w-32 rounded-lg object-cover" />
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-bold text-slate-600">考案者 分配率 (%)</label>
            <input
              type="number"
              min={0}
              max={100}
              value={creatorShare}
              onChange={(e) => setCreatorShare(Math.min(100, Math.max(0, Number(e.target.value))))}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600">モデラー 分配率 (%)</label>
            <input
              type="number"
              value={modelerShare}
              readOnly
              className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600">プリント品 価格 (円)</label>
            <input
              type="number"
              min={0}
              value={pricePhysical}
              onChange={(e) => setPricePhysical(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600">STLデータ 価格 (円)</label>
            <input
              type="number"
              min={0}
              value={priceDigital}
              onChange={(e) => setPriceDigital(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
        </div>

        <label className="mt-3 block text-xs font-bold text-slate-600">
          画像をアップロード（任意・AI画像より優先）
        </label>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="mt-1 w-full text-xs text-slate-500 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-slate-600 hover:file:bg-slate-200"
        />

        <button
          type="submit"
          disabled={busy}
          className="mt-5 w-full rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white shadow-md shadow-indigo-500/30 transition hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy ? '投稿中…' : 'アイデアを投稿する'}
        </button>
      </form>

      <div className="rounded-2xl border border-dashed border-indigo-200 bg-indigo-50/50 p-6">
        <h3 className="text-sm font-bold text-indigo-900">💡 アイデア投稿の流れ</h3>
        <ol className="mt-3 space-y-3 text-[13px] leading-relaxed text-indigo-900/80">
          <li className="flex gap-2.5">
            <Step n={1} />
            <span>
              <b>アイデアを投稿</b> — タイトル・仕様・希望価格・収益分配率を設定。
              AI画像があればモデラーに完成イメージが伝わりやすくなります。
            </span>
          </li>
          <li className="flex gap-2.5">
            <Step n={2} />
            <span>
              <b>モデラーが引き受け</b> — 3Dモデラーが案件を引き受け、制作が始まります。
              コメント欄で仕様の相談ができます。
            </span>
          </li>
          <li className="flex gap-2.5">
            <Step n={3} />
            <span>
              <b>3Dデータ完成 → 販売開始</b> — 商品カタログに掲載され、物理プリント品とSTLデータが購入可能に。
            </span>
          </li>
          <li className="flex gap-2.5">
            <Step n={4} />
            <span>
              <b>売上を自動分配</b> — 購入ごとに設定した分配率で売上残高に加算され、デジタルギフトへ交換できます。
            </span>
          </li>
        </ol>
      </div>
    </div>
  );
}

function Step({ n }: { n: number }) {
  return (
    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-indigo-600 text-[11px] font-bold text-white">
      {n}
    </span>
  );
}
