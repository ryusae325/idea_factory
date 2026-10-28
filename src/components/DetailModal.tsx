import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { ArrangementChoice, ArrangementDraft, ArrangementOption, Comment, Idea, IdeaApplication, IdeaMessage, Profile } from '../lib/types';
import { fmtDate, fmtYen } from '../lib/types';
import { supabase } from '../lib/supabase';
import { deleteComment, fetchComments, fetchIdea, postComment, getStlDownloadUrl, setIdeaStl, uploadStl, SIZE_OPTIONS, fulfillmentFee, ratingStats, fetchMyRating, rateIdea, updateIdeaStatus, requestIdeaDelete, confirmIdeaDelete, reportIdea, fetchApplications, applyForIdea, withdrawApplication, assignModeler, fetchIdeaMessages, sendIdeaMessage, fetchArrangementOptions, buildArrangementDescription } from '../lib/data';
import { toast } from '../lib/toast';

const ModelStudio = lazy(() => import('./ModelStudio'));

interface Props {
  ideaId: number;
  profile: Profile | null;
  onClose: () => void;
  onChanged: () => void;
  onArrangeRequest?: (draft: ArrangementDraft) => void;
}

export default function DetailModal({ ideaId, profile, onClose, onChanged, onArrangeRequest }: Props) {
  const [idea, setIdea] = useState<Idea | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [myStars, setMyStars] = useState<number | null>(null);
  const [applications, setApplications] = useState<IdeaApplication[]>([]);
  const [applyMsg, setApplyMsg] = useState('');
  const [applyBusy, setApplyBusy] = useState(false);
  const [chatMessages, setChatMessages] = useState<IdeaMessage[]>([]);
  const [chatText, setChatText] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);
  const [arrangementOptions, setArrangementOptions] = useState<ArrangementOption[]>([]);
  const [showArrangeModal, setShowArrangeModal] = useState(false);
  const [selectedChoices, setSelectedChoices] = useState<Map<number, ArrangementChoice>>(new Map());
  const [arrangeBusy, setArrangeBusy] = useState(false);
  const [showStudio, setShowStudio] = useState(false);

  const reload = useCallback(async () => {
    const [i, c] = await Promise.all([fetchIdea(ideaId), fetchComments(ideaId)]);
    setIdea(i);
    setComments(c);
  }, [ideaId]);

  const reloadApplications = useCallback(async () => {
    try {
      setApplications(await fetchApplications(ideaId));
    } catch {
      setApplications([]);
    }
  }, [ideaId]);

  const reloadChat = useCallback(async () => {
    try {
      setChatMessages(await fetchIdeaMessages(ideaId));
    } catch {
      /* チャットは関係者のみ取得可能。権限がなければ何も表示しない */
      setChatMessages([]);
    }
  }, [ideaId]);

  useEffect(() => {
    reload().catch(() => toast('詳細情報の取得に失敗しました', 'error'));
  }, [reload]);

  useEffect(() => {
    reloadApplications();
  }, [reloadApplications]);

  useEffect(() => {
    fetchArrangementOptions(ideaId)
      .then((opts) => {
        setArrangementOptions(opts);
        const defaults = new Map<number, ArrangementChoice>();
        for (const o of opts) {
          if (o.choices[0]) defaults.set(o.id, o.choices[0]);
        }
        setSelectedChoices(defaults);
      })
      .catch(() => setArrangementOptions([]));
  }, [ideaId]);

  const canChat = !!(idea?.modeler_id && profile && (profile.id === idea.creator_id || profile.id === idea.modeler_id || profile.is_admin));

  useEffect(() => {
    if (!canChat) {
      setChatMessages([]);
      return;
    }
    reloadChat();
    // Realtime で即時反映（出版が有効な環境）。失敗時は下記ポーリングで代替。
    const channel = supabase
      .channel(`idea_messages_${ideaId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'idea_messages', filter: `idea_id=eq.${ideaId}` },
        () => reloadChat(),
      )
      .subscribe();
    const timer = window.setInterval(reloadChat, 5000);
    return () => {
      supabase.removeChannel(channel);
      window.clearInterval(timer);
    };
  }, [canChat, ideaId, reloadChat]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ block: 'end' });
  }, [chatMessages.length, canChat]);

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

  const myApplication = profile ? applications.find((a) => a.modeler_id === profile.id) ?? null : null;

  const handleApply = async () => {
    if (!profile) return toast('立候補するにはログインしてください', 'error');
    if (applyMsg.length > 1000) return toast('応募メッセージは1000文字以内で入力してください', 'error');
    setApplyBusy(true);
    try {
      const msg = await applyForIdea(idea.id, applyMsg);
      toast(msg);
      setApplyMsg('');
      await reloadApplications();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setApplyBusy(false);
    }
  };

  const handleWithdraw = async () => {
    if (!confirm('立候補を取り下げますか？')) return;
    setApplyBusy(true);
    try {
      const msg = await withdrawApplication(idea.id);
      toast(msg);
      await reloadApplications();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setApplyBusy(false);
    }
  };

  const handleAssign = async (a: IdeaApplication) => {
    const n = a.modeler?.display_name || a.modeler?.username || 'このモデラー';
    if (!confirm(`${n} さんを指名してモデリングを開始しますか？\n指名後は他の応募者への連絡（不選出通知）が送られます。`)) return;
    try {
      const msg = await assignModeler(idea.id, a.modeler_id);
      toast(msg);
      await Promise.all([reload(), reloadApplications()]);
      onChanged();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const handleSendChat = async () => {
    if (!chatText.trim()) return toast('メッセージを入力してください', 'error');
    if (chatText.trim().length > 2000) return toast('メッセージは2000文字以内で入力してください', 'error');
    setChatBusy(true);
    try {
      await sendIdeaMessage(idea.id, chatText);
      setChatText('');
      await reloadChat();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setChatBusy(false);
    }
  };

  const totalArrangementExtra = arrangementOptions.reduce((sum, o) => sum + (selectedChoices.get(o.id)?.price ?? 0), 0);

  const openArrangeModal = () => {
    if (!profile) return toast('アレンジ依頼するにはログインしてください', 'error');
    if (idea?.status !== '販売中') return toast('販売中の商品のみアレンジ依頼できます', 'error');
    setShowArrangeModal(true);
  };

  const submitArrangeRequest = async () => {
    if (!idea || !profile) return;
    const selected = arrangementOptions
      .map((o) => {
        const choice = selectedChoices.get(o.id);
        return choice ? { optionId: o.id, optionName: o.name, choice } : null;
      })
      .filter((x): x is { optionId: number; optionName: string; choice: ArrangementChoice } => !!x);

    setArrangeBusy(true);
    try {
      const description = buildArrangementDescription(
        idea.title,
        selected.map((s) => ({ optionName: s.optionName, choice: s.choice })),
      );
      const draft: ArrangementDraft = {
        baseIdeaId: idea.id,
        baseTitle: idea.title,
        title: `【アレンジ】${idea.title}`,
        description,
        genre: idea.genre,
        sizeTier: idea.size_tier,
        priceDigital: idea.price_digital + totalArrangementExtra,
        selectedOptions: selected,
        totalExtra: totalArrangementExtra,
      };
      onArrangeRequest?.(draft);
      setShowArrangeModal(false);
      onClose();
    } finally {
      setArrangeBusy(false);
    }
  };

  return (
    <>
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

      {idea.status === '販売中' && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <button
            onClick={openArrangeModal}
            className="w-full rounded-lg bg-violet-600 px-3 py-2.5 text-xs font-bold text-white shadow-sm shadow-violet-500/30 transition hover:bg-violet-700"
          >
            🎨 アレンジ依頼する
          </button>
          <p className="flex items-center rounded-lg bg-violet-50 px-3 py-2 text-[11px] text-violet-800 ring-1 ring-violet-200">
            基本価格＋オプションでカスタム版を依頼できます
          </p>
        </div>
      )}

      {idea.status === 'アイデア募集' && (
        <div className="mt-3 rounded-xl bg-sky-50/70 p-3.5 ring-1 ring-sky-200">
          <p className="text-xs font-bold text-sky-900">🙋 モデラー立候補（指名制）</p>
          {isOwner || isAdmin ? (
            <div className="mt-2">
              <p className="text-[11px] font-semibold text-sky-800">
                応募者 {applications.filter((a) => a.status === '応募中').length}件
              </p>
              {applications.length === 0 ? (
                <p className="mt-1.5 rounded-lg bg-white px-3 py-2 text-[11px] text-stone-500 ring-1 ring-stone-200">
                  まだ立候補はありません。応募が届くと🔔でお知らせします。
                </p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {applications.map((a) => (
                    <li key={a.id} className="rounded-lg bg-white p-3 ring-1 ring-stone-200">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-bold text-stone-800">
                          {a.modeler?.display_name || a.modeler?.username || 'ユーザー'}
                        </span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          a.status === '応募中' ? 'bg-amber-100 text-amber-800' : a.status === '選定済' ? 'bg-emerald-100 text-emerald-700' : 'bg-stone-100 text-stone-500'
                        }`}>
                          {a.status}
                        </span>
                      </div>
                      {a.message && (
                        <p className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-stone-700">{a.message}</p>
                      )}
                      <p className="mt-1 text-[10px] text-stone-400">応募日時: {fmtDate(a.created_at)}</p>
                      {a.status === '応募中' && (
                        <button
                          onClick={() => handleAssign(a)}
                          className="mt-2 w-full rounded-lg bg-orange-600 px-3 py-2 text-[11px] font-bold text-white shadow-sm transition hover:bg-orange-700"
                        >
                          🔨 この人に指名する
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : profile ? (
            myApplication ? (
              <div className="mt-2">
                <p className="text-[11px] font-bold text-sky-800">🙋 立候補済み（{myApplication.status}）</p>
                {myApplication.message && (
                  <p className="mt-1 whitespace-pre-wrap rounded-lg bg-white p-2.5 text-[11px] text-stone-700 ring-1 ring-stone-200">
                    {myApplication.message}
                  </p>
                )}
                {myApplication.status === '応募中' && (
                  <button
                    onClick={handleWithdraw}
                    disabled={applyBusy}
                    className="mt-2 rounded-lg bg-white px-3 py-1.5 text-[10px] font-semibold text-stone-600 ring-1 ring-stone-300 transition hover:bg-stone-100 disabled:opacity-50"
                  >
                    立候補を取り下げる
                  </button>
                )}
              </div>
            ) : (
              <div className="mt-2">
                <textarea
                  value={applyMsg}
                  onChange={(e) => setApplyMsg(e.target.value)}
                  rows={2}
                  maxLength={1000}
                  placeholder="応募メッセージ（任意）— 担当経験やアピールを書けば選ばれやすくなります"
                  className="w-full rounded-lg border border-sky-200 bg-white px-3 py-2 text-xs outline-none focus:border-sky-400"
                />
                <button
                  onClick={handleApply}
                  disabled={applyBusy}
                  className="mt-1.5 w-full rounded-lg bg-orange-600 px-3 py-2 text-xs font-bold text-white shadow-sm shadow-orange-500/30 transition hover:bg-orange-700 disabled:opacity-50"
                >
                  {applyBusy ? '送信中…' : '🙋 このアイデアに立候補する'}
                </button>
              </div>
            )
          ) : (
            <p className="mt-1.5 text-[11px] text-stone-500">※立候補するにはログインしてください。</p>
          )}
        </div>
      )}

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
          <button
            onClick={() => setShowStudio(true)}
            className="w-full rounded-lg bg-teal-600 px-3 py-2.5 text-xs font-bold text-white shadow-sm shadow-teal-500/30 transition hover:bg-teal-700"
          >
            🧊 3Dスタジオで開く（ブラウザ内でモデリング）
          </button>
          <p className="mt-1 text-[10px] text-stone-400">
            ブラウザ上で3Dモデルを制作し、STLで書き出してそのまま提出・出品できます。
          </p>
          <label className="mt-2 block text-[11px] font-bold text-stone-600">
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

      {canChat && (
        <div className="mt-4">
          <h4 className="text-sm font-bold text-stone-800">🛠️ 案件チャット（プランナー・モデラー専用）</h4>
          <p className="mt-0.5 text-[10px] text-stone-400">
            進捗報告や修正依頼を1対1でやり取りできます。内容は他のユーザーには表示されません。
          </p>
          <div className="mt-2 max-h-56 space-y-2 overflow-y-auto rounded-xl bg-stone-50 p-3 ring-1 ring-stone-200">
            {chatMessages.length === 0 ? (
              <p className="py-2 text-center text-xs text-stone-400">
                まだメッセージはありません。最初のメッセージを送りましょう。
              </p>
            ) : (
              chatMessages.map((m) => {
                const mine = m.sender_id === profile?.id;
                return (
                  <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-[12px] leading-relaxed ${
                      mine ? 'bg-orange-600 text-white' : 'bg-white text-stone-800 ring-1 ring-stone-200'
                    }`}>
                      {!mine && (
                        <p className="text-[10px] font-bold text-stone-500">
                          {m.sender?.display_name || m.sender?.username || 'ユーザー'}
                        </p>
                      )}
                      <p className="whitespace-pre-wrap break-words">{m.body}</p>
                      <p className={`mt-0.5 text-right text-[9px] ${mine ? 'text-orange-100' : 'text-stone-400'}`}>
                        {fmtDate(m.created_at)}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={chatBottomRef} />
          </div>
          <div className="mt-2 flex gap-2">
            <input
              value={chatText}
              onChange={(e) => setChatText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendChat()}
              placeholder="メッセージを入力…（進捗報告・修正依頼など）"
              className="flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
            />
            <button
              onClick={handleSendChat}
              disabled={chatBusy}
              className="rounded-lg bg-orange-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-orange-700 disabled:opacity-50"
            >
              送信
            </button>
          </div>
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

      <div className="mt-5 border-t border-stone-200 pt-3 text-right">
        <button
          onClick={() => idea && reportIdea(idea.id, idea.title).catch((err: Error) => toast(err.message, 'error'))}
          className="rounded-full border border-rose-200 bg-rose-50/60 px-4 py-1.5 text-[11px] font-semibold text-rose-600 transition hover:bg-rose-100"
        >
          📢 これ観たことある（通報）
        </button>
      </div>

      {showArrangeModal && idea && (
        <div
          className="fixed inset-0 z-[60] grid place-items-center bg-slate-900/50 p-4 backdrop-blur-sm"
          onClick={() => setShowArrangeModal(false)}
        >
          <div
            className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h4 className="text-base font-bold text-stone-900">🎨 アレンジ依頼</h4>
            <p className="mt-1 text-[11px] text-stone-500">「{idea.title}」をベースにカスタム版を依頼します。</p>

            {arrangementOptions.length === 0 ? (
              <p className="mt-3 rounded-lg bg-stone-50 px-3 py-2 text-[11px] text-stone-500 ring-1 ring-stone-200">
                この商品にはアレンジオプションが設定されていません。
              </p>
            ) : (
              <div className="mt-3 space-y-3">
                {arrangementOptions.map((opt) => (
                  <div key={opt.id} className="rounded-xl border border-stone-200 bg-stone-50 p-3">
                    <p className="text-xs font-bold text-stone-800">{opt.name}</p>
                    <div className="mt-2 grid gap-2">
                      {opt.choices.map((choice) => (
                        <label
                          key={choice.label}
                          className={`flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2 transition ${
                            selectedChoices.get(opt.id)?.label === choice.label
                              ? 'border-violet-500 bg-violet-50 ring-1 ring-violet-200'
                              : 'border-stone-300 bg-white hover:border-stone-400'
                          }`}
                        >
                          <span className="flex items-center gap-2">
                            <input
                              type="radio"
                              name={`arrange-${opt.id}`}
                              checked={selectedChoices.get(opt.id)?.label === choice.label}
                              onChange={() =>
                                setSelectedChoices((prev) => {
                                  const next = new Map(prev);
                                  next.set(opt.id, choice);
                                  return next;
                                })
                              }
                              className="accent-violet-600"
                            />
                            <span className="text-[13px] text-stone-800">{choice.label}</span>
                          </span>
                          <span className="text-xs font-bold text-violet-700">+¥{fmtYen(choice.price)}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4 rounded-xl bg-violet-50 p-3 ring-1 ring-violet-200">
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-stone-600">STLデータ基本価格</span>
                <span className="font-bold text-stone-800">¥{fmtYen(idea.price_digital)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-[13px]">
                <span className="text-stone-600">オプション追加料金</span>
                <span className="font-bold text-violet-700">+¥{fmtYen(totalArrangementExtra)}</span>
              </div>
              <div className="mt-2 border-t border-violet-200 pt-2 flex items-center justify-between text-base">
                <span className="font-bold text-stone-900">見積もり合計</span>
                <span className="font-extrabold text-violet-700">¥{fmtYen(idea.price_digital + totalArrangementExtra)}</span>
              </div>
              <p className="mt-1 text-[10px] text-stone-500">
                ※プリント品の価格はサイズにより変動します。最終価格はモデラー指名後に確定します。
              </p>
            </div>

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setShowArrangeModal(false)}
                className="flex-1 rounded-lg border border-stone-300 bg-white py-2.5 text-xs font-bold text-stone-600 transition hover:bg-stone-50"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={submitArrangeRequest}
                disabled={arrangeBusy}
                className="flex-1 rounded-lg bg-violet-600 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-violet-700 disabled:opacity-50"
              >
                {arrangeBusy ? '準備中…' : 'この内容で依頼する'}
              </button>
            </div>
          </div>
        </div>
      )}
      </Overlay>
      {showStudio && idea && profile && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-[100] grid place-items-center bg-stone-100">
              <p className="text-sm font-bold text-stone-500">🧊 3Dスタジオを読み込み中…</p>
            </div>
          }
        >
          <ModelStudio
            idea={idea}
            profile={profile}
            onClose={() => setShowStudio(false)}
            onChanged={onChanged}
          />
        </Suspense>
      )}
    </>
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
      className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4 backdrop-blur-sm"
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
