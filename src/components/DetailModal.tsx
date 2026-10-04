import { useCallback, useEffect, useState } from 'react';
import type { Comment, Idea, Profile } from '../lib/types';
import { fmtDate, fmtYen } from '../lib/types';
import { deleteComment, fetchComments, fetchIdea, postComment, getStlDownloadUrl, setIdeaStl, uploadStl, SIZE_OPTIONS, fulfillmentFee, ratingStats, fetchMyRating, rateIdea, updateIdeaStatus, requestIdeaDelete, confirmIdeaDelete } from '../lib/data';
import { toast } from '../lib/toast';

interface Props {
  ideaId: number;
  profile: Profile | null;
  onClose: () => void;
  onChanged: () => void;
}

export default function DetailModal({ ideaId, profile, onClose, onChanged }: Props) {
  const [idea, setIdea] = useState<Idea | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [myStars, setMyStars] = useState<number | null>(null);

  const reload = useCallback(async () => {
    const [i, c] = await Promise.all([fetchIdea(ideaId), fetchComments(ideaId)]);
    setIdea(i);
    setComments(c);
  }, [ideaId]);

  useEffect(() => {
    reload().catch(() => toast('詳細情報の取得に失敗しました', 'error'));
  }, [reload]);

  useEffect(() => {
    if (profile) {
      fetchMyRating(ideaId, profile.id).then(setMyStars).catch(() => {});
    } else {
      setMyStars(null);
    }
  }, [ideaId, profile]);

  if (!idea) {
    return (
      <Overlay onClose={onClose}>
        <p className="py-10 text-center text-sm text-stone-400">読み込み中…</p>
      </Overlay>
    );
  }

  const name = (p?: { username: string; display_name: string } | null) =>
    p?.display_name || p?.username || '';
  const isOwner = profile?.id === idea.creator_id;
  const isModeler = profile?.id && idea.modeler_id === profile.id;
  const isAdmin = profile?.is_admin;
  const canManageStl = !!(isOwner || isModeler || isAdmin);

  const downloadStl = async () => {
    if (!idea.stl_path) return;
    try {
      const url = await getStlDownloadUrl(idea.stl_path);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${idea.title}.stl`;
      a.click();
      toast('ダウンロードを開始しました');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const handleStlUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !profile) return;
    try {
      const path = await uploadStl(profile.id, file);
      await setIdeaStl(idea.id, path);
      toast('STLファイルをアップロードしました');
      await reload();
      onChanged();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const submit = async () => {
    if (!text.trim()) return toast('コメントを入力してください', 'error');
    if (!profile) return toast('コメントを投稿するにはログインしてください', 'error');
    setBusy(true);
    try {
      await postComment(idea.id, profile.id, text.trim());
      setText('');
      await reload();
      toast('コメントを投稿しました');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const removeIdea = async () => {
    if (!confirm('このアイデアを削除しますか？')) return;
    try {
      const msg = await requestIdeaDelete(idea.id);
      toast(msg);
      onClose();
      onChanged();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const approveDelete = async () => {
    if (!confirm('削除リクエストを承認しますか？\n承認するとこのアイデアは完全に削除され、元に戻せません。')) return;
    try {
      const msg = await confirmIdeaDelete(idea.id);
      toast(msg);
      onClose();
      onChanged();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const withdrawSale = async () => {
    const comment = window.prompt(
      'モデリング中に戻す理由を入力してください（コメント欄に投稿され、モデラーに通知されます）',
    );
    if (comment === null) return;
    if (!comment.trim()) return toast('コメントを入力してください', 'error');
    try {
      const msg = await updateIdeaStatus(idea.id, '取り下げ', comment.trim());
      toast(msg);
      await reload();
      onChanged();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const removeComment = async (cid: number) => {
    if (!confirm('このコメントを削除しますか？')) return;
    try {
      await deleteComment(cid);
      await reload();
      toast('コメントを削除しました');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const rate = async (stars: number) => {
    if (!profile) return toast('評価するにはログインしてください', 'error');
    try {
      await rateIdea(idea.id, profile.id, stars);
      setMyStars(stars);
      await reload();
      onChanged();
      toast(stars === myStars ? `★${stars} で評価しました` : `評価を ★${stars} に更新しました`);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <Overlay onClose={onClose}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-lg font-bold text-stone-900">💡 {idea.title}</h3>
        <div className="flex shrink-0 gap-2">
          {idea.status === '販売中' && (isOwner || isAdmin) && (
            <button
              onClick={withdrawSale}
              className="rounded-lg bg-amber-50 px-3 py-1.5 text-[11px] font-bold text-amber-700 ring-1 ring-amber-300 transition hover:bg-amber-100"
            >
              ↩️ モデリング中に戻す
            </button>
          )}
          {isAdmin && !isOwner && !isModeler && (
            <button
              onClick={approveDelete}
              className="rounded-lg bg-rose-50 px-3 py-1.5 text-[11px] font-bold text-rose-600 ring-1 ring-rose-200 transition hover:bg-rose-100"
            >
              🗑 削除（運営）
            </button>
          )}
          {(isOwner || isModeler) &&
            (idea.delete_requested_by ? (
              idea.delete_requested_by === profile?.id ? (
                <span className="rounded-lg bg-stone-100 px-3 py-1.5 text-[11px] font-bold text-stone-400 ring-1 ring-stone-200">
                  ⏳ 相手の削除承認待ち
                </span>
              ) : (
                <button
                  onClick={approveDelete}
                  className="rounded-lg bg-rose-600 px-3 py-1.5 text-[11px] font-bold text-white shadow-sm transition hover:bg-rose-700"
                >
                  ✅ 削除を承認
                </button>
              )
            ) : (
              <button
                onClick={removeIdea}
                className="rounded-lg bg-rose-50 px-3 py-1.5 text-[11px] font-bold text-rose-600 ring-1 ring-rose-200 transition hover:bg-rose-100"
              >
                {isOwner && !idea.modeler_id ? '投稿削除' : '🗑 削除リクエスト'}
              </button>
            ))}
          <button
            onClick={onClose}
            className="rounded-lg px-2.5 py-1.5 text-sm text-stone-400 transition hover:bg-stone-100 hover:text-stone-600"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="mt-3 h-44 overflow-hidden rounded-xl bg-gradient-to-br from-stone-100 to-stone-200">
        {(idea.images?.[0] ?? idea.image_url) ? (
          <img
            src={idea.images?.[0] ?? idea.image_url}
            alt={idea.title}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-5xl text-stone-300">🧩</div>
        )}
      </div>

      {(idea.images?.length ?? 0) > 1 && (
        <div className="mt-2">
          <p className="text-[10px] font-bold text-stone-500">
            📷 参考画像 {idea.images.length}枚（正面・横・上面など）
          </p>
          <div className="mt-1.5 grid grid-cols-4 gap-2">
            {idea.images.map((url, i) => (
              <a
                key={`${url}-${i}`}
                href={url}
                target="_blank"
                rel="noreferrer"
                className="h-20 overflow-hidden rounded-lg bg-stone-100 ring-1 ring-stone-200 transition hover:ring-orange-400"
              >
                <img
                  src={url}
                  alt={`参考画像${i + 1}`}
                  loading="lazy"
                  className="h-full w-full object-cover transition hover:scale-105"
                />
              </a>
            ))}
          </div>
        </div>
      )}

      <dl className="mt-4 space-y-1.5 text-[13px]">
        <Row label="ステータス" value={idea.status} accent />
        <Row
          label="プランナー / モデラー"
          value={`${name(idea.creator) || '不明'} ／ ${name(idea.modeler) || '未定'}`}
        />
        <Row label="収益分配" value={`プランナー ${idea.creator_share}% / モデラー ${idea.modeler_share}%`} />
        <Row
          label="価格"
          value={`物理プリント ${fmtYen(idea.price_physical)}円（＋製造・配送費 ${fmtYen(fulfillmentFee(idea.size_tier ?? 'S'))}円）／ STLデータ ${fmtYen(idea.price_digital)}円`}
        />
        <Row
          label="サイズ"
          value={`${idea.size_tier}サイズ（${SIZE_OPTIONS.find((o) => o.tier === idea.size_tier)?.range ?? ''}）`}
        />
      </dl>

      <div className="mt-3 rounded-xl bg-stone-50 p-3.5 ring-1 ring-stone-200">
        <p className="text-xs font-bold text-stone-600">詳細説明・仕様</p>
        <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-stone-700">
          {idea.description || '詳細説明はありません。'}
        </p>
      </div>

      <div className="mt-3 rounded-xl bg-amber-50/60 p-3.5 ring-1 ring-amber-200">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-bold text-amber-900">⭐ このアイデアの評価</p>
          <RatingBadge stats={ratingStats(idea)} />
        </div>
        {profile ? (
          <div className="mt-2 flex items-center gap-1.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => rate(n)}
                aria-label={`★${n}で評価`}
                className={`text-xl leading-none transition hover:scale-110 ${
                  myStars && n <= myStars ? 'text-amber-500' : 'text-stone-300 hover:text-amber-300'
                }`}
              >
                ★
              </button>
            ))}
            <span className="ml-1.5 text-[10px] text-stone-400">
              {myStars ? `あなたの評価: ★${myStars}` : 'クリックで評価できます'}
            </span>
          </div>
        ) : (
          <p className="mt-1.5 text-[10px] text-stone-400">※評価するにはログインしてください。</p>
        )}
      </div>

      <hr className="my-4 border-stone-200" />

      <h4 className="text-sm font-bold text-stone-800">📦 3Dデータ（STL）</h4>
      {idea.stl_path ? (
        <div className="mt-2 flex items-center justify-between rounded-xl bg-emerald-50 px-4 py-3 ring-1 ring-emerald-200">
          <p className="text-xs font-semibold text-emerald-800">
            ✅ 3Dデータが登録されています
          </p>
          <button
            onClick={downloadStl}
            className="rounded-lg bg-emerald-600 px-3.5 py-2 text-[11px] font-bold text-white shadow-sm shadow-emerald-500/30 transition hover:bg-emerald-700"
          >
            ⬇️ ダウンロード
          </button>
        </div>
      ) : (
        <p className="mt-2 rounded-xl bg-stone-50 px-4 py-3 text-xs text-stone-500 ring-1 ring-stone-200">
          3Dデータはまだ登録されていません。
        </p>
      )}
      {canManageStl && (
        <div className="mt-2 rounded-xl bg-stone-50 p-3 ring-1 ring-stone-200">
          <label className="block text-[11px] font-bold text-stone-600">
            STLファイルをアップロード（完成3Dデータ・.stl）
          </label>
          <input
            type="file"
            accept=".stl,model/stl,application/sla"
            onChange={handleStlUpload}
            className="mt-1.5 w-full text-xs text-stone-500 file:mr-3 file:rounded-lg file:border-0 file:bg-orange-100 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-orange-700 hover:file:bg-orange-200"
          />
          <p className="mt-1 text-[10px] text-stone-400">
            ※アップロードしたSTLは、STLデータを購入したユーザーのみダウンロードできます。
          </p>
        </div>
      )}

      <hr className="my-4 border-stone-200" />

      <h4 className="text-sm font-bold text-stone-800">💬 コメント・相談</h4>
      <div className="mt-2 max-h-44 space-y-2 overflow-y-auto pr-1">
        {comments.length === 0 ? (
          <p className="py-2 text-xs text-stone-400">コメントはまだありません。</p>
        ) : (
          comments.map((c) => (
            <div key={c.id} className="rounded-lg bg-stone-50 px-3 py-2 ring-1 ring-stone-200">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-stone-600">
                  {name(c.author) || 'ユーザー'}
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-[10px] text-stone-400">{fmtDate(c.created_at)}</span>
                  {(profile?.id === c.user_id || isAdmin) && (
                    <button
                      onClick={() => removeComment(c.id)}
                      className="text-[10px] font-semibold text-rose-500 hover:underline"
                    >
                      削除
                    </button>
                  )}
                </span>
              </div>
              <p className="mt-0.5 whitespace-pre-wrap text-[13px] text-stone-800">{c.content}</p>
            </div>
          ))
        )}
      </div>

      {profile ? (
        <div className="mt-3 flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && submit()}
            placeholder="コメントを入力…"
            className="flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
          />
          <button
            onClick={submit}
            disabled={busy}
            className="rounded-lg bg-orange-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-orange-700 disabled:opacity-50"
          >
            送信
          </button>
        </div>
      ) : (
        <p className="mt-3 text-xs text-stone-400">※コメントを投稿するにはログインしてください。</p>
      )}
    </Overlay>
  );
}

function RatingBadge({ stats }: { stats: { avg: number | null; count: number } }) {
  if (!stats.count || stats.avg == null) {
    return <span className="text-[11px] font-semibold text-stone-400">評価はまだありません</span>;
  }
  return (
    <span className="flex items-center gap-1 text-[11px] font-bold text-amber-600">
      ★ {stats.avg.toFixed(1)}
      <span className="font-semibold text-stone-400">（{stats.count}件）</span>
    </span>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex gap-2">
      <dt className="w-28 shrink-0 text-stone-400">{label}</dt>
      <dd className={accent ? 'font-bold text-orange-600' : 'text-stone-700'}>{value}</dd>
    </div>
  );
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[#020609]/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-[#0f1e2d] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
