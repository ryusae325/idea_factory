import { useCallback, useEffect, useState } from 'react';
import type { Comment, Idea, Profile } from '../lib/types';
import { fmtDate, fmtYen } from '../lib/types';
import { deleteComment, deleteIdea, fetchComments, fetchIdea, postComment } from '../lib/data';
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

  const reload = useCallback(async () => {
    const [i, c] = await Promise.all([fetchIdea(ideaId), fetchComments(ideaId)]);
    setIdea(i);
    setComments(c);
  }, [ideaId]);

  useEffect(() => {
    reload().catch(() => toast('詳細情報の取得に失敗しました', 'error'));
  }, [reload]);

  if (!idea) {
    return (
      <Overlay onClose={onClose}>
        <p className="py-10 text-center text-sm text-slate-400">読み込み中…</p>
      </Overlay>
    );
  }

  const name = (p?: { username: string; display_name: string } | null) =>
    p?.display_name || p?.username || '';
  const isOwner = profile?.id === idea.creator_id;
  const isAdmin = profile?.is_admin;

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
      await deleteIdea(idea.id);
      toast('削除しました');
      onClose();
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

  return (
    <Overlay onClose={onClose}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-lg font-bold text-slate-900">💡 {idea.title}</h3>
        <div className="flex shrink-0 gap-2">
          {(isOwner || isAdmin) && (
            <button
              onClick={removeIdea}
              className="rounded-lg bg-rose-50 px-3 py-1.5 text-[11px] font-bold text-rose-600 ring-1 ring-rose-200 transition hover:bg-rose-100"
            >
              投稿削除
            </button>
          )}
          <button
            onClick={onClose}
            className="rounded-lg px-2.5 py-1.5 text-sm text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="mt-3 h-44 overflow-hidden rounded-xl bg-gradient-to-br from-slate-100 to-slate-200">
        {idea.image_url ? (
          <img src={idea.image_url} alt={idea.title} className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full w-full place-items-center text-5xl text-slate-300">🧩</div>
        )}
      </div>

      <dl className="mt-4 space-y-1.5 text-[13px]">
        <Row label="ステータス" value={idea.status} accent />
        <Row
          label="考案者 / モデラー"
          value={`${name(idea.creator) || '不明'} ／ ${name(idea.modeler) || '未定'}`}
        />
        <Row label="収益分配" value={`考案者 ${idea.creator_share}% / モデラー ${idea.modeler_share}%`} />
        <Row
          label="価格"
          value={`物理プリント ${fmtYen(idea.price_physical)}円 ／ STLデータ ${fmtYen(idea.price_digital)}円`}
        />
      </dl>

      <div className="mt-3 rounded-xl bg-slate-50 p-3.5 ring-1 ring-slate-200">
        <p className="text-xs font-bold text-slate-600">詳細説明・仕様</p>
        <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-slate-700">
          {idea.description || '詳細説明はありません。'}
        </p>
      </div>

      <hr className="my-4 border-slate-200" />

      <h4 className="text-sm font-bold text-slate-800">💬 コメント・相談</h4>
      <div className="mt-2 max-h-44 space-y-2 overflow-y-auto pr-1">
        {comments.length === 0 ? (
          <p className="py-2 text-xs text-slate-400">コメントはまだありません。</p>
        ) : (
          comments.map((c) => (
            <div key={c.id} className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-600">
                  {name(c.author) || 'ユーザー'}
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-400">{fmtDate(c.created_at)}</span>
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
              <p className="mt-0.5 whitespace-pre-wrap text-[13px] text-slate-800">{c.content}</p>
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
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          />
          <button
            onClick={submit}
            disabled={busy}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-indigo-700 disabled:opacity-50"
          >
            送信
          </button>
        </div>
      ) : (
        <p className="mt-3 text-xs text-slate-400">※コメントを投稿するにはログインしてください。</p>
      )}
    </Overlay>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex gap-2">
      <dt className="w-28 shrink-0 text-slate-400">{label}</dt>
      <dd className={accent ? 'font-bold text-indigo-600' : 'text-slate-700'}>{value}</dd>
    </div>
  );
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
