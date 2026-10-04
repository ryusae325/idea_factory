import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Idea, Profile } from './lib/types';
import { supabase, auth } from './lib/supabase';
import { fetchIdeas, fetchProfile, updateIdeaStatus, createCheckout, completeCheckout, GENRES, commentCount, ratingStats, fetchMyFavorites, setFavorite } from './lib/data';
import { toast } from './lib/toast';
import Header from './components/Header';
import ToastHost from './components/ToastHost';
import DetailModal from './components/DetailModal';
import ProfileModal from './components/ProfileModal';
import LegalModal from './components/LegalModal';
import IdeaGrid from './components/IdeaGrid';
import CreatorTab from './tabs/CreatorTab';
import MyPageTab from './tabs/MyPageTab';
import SalesTab from './tabs/SalesTab';
import AdminTab from './tabs/AdminTab';

type TabId = 'creator' | 'modeler' | 'shop' | 'mypage' | 'sales' | 'admin';

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'creator', label: 'アイデア募集', icon: '💡' },
  { id: 'modeler', label: 'モデリング中', icon: '🛠️' },
  { id: 'shop', label: '商品購入', icon: '🛒' },
  { id: 'mypage', label: 'マイページ', icon: '👤' },
  { id: 'sales', label: '売上・ギフト', icon: '💰' },
  { id: 'admin', label: '運営管理', icon: '⚙️' },
];

export default function App() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loggedIn, setLoggedIn] = useState(false);
  const [needsProfile, setNeedsProfile] = useState(false);
  const [showLegal, setShowLegal] = useState(false);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [favorites, setFavorites] = useState<Set<number>>(new Set());
  const [tab, setTab] = useState<TabId>('creator');
  const [detailId, setDetailId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshProfile = useCallback(async (userId: string) => {
    try {
      let p = await fetchProfile(userId);
      if (!p) {
        // プロフィール作成が間に合っていない可能性に備えて一度だけ再試行
        await new Promise((r) => setTimeout(r, 1200));
        p = await fetchProfile(userId);
      }
      if (!p) {
        // プロフィールが存在しない＝退会済みアカウント
        await supabase.auth.signOut();
        setLoggedIn(false);
        toast('このアカウントは退会済みです', 'info');
        return;
      }
      setProfile(p);
      setNeedsProfile(!p.display_name);
    } catch {
      /* profile may not be created yet */
    }
  }, []);

  const refreshIdeas = useCallback(async () => {
    try {
      setIdeas(await fetchIdeas());
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }, []);

  const refreshFavorites = useCallback(async () => {
    try {
      setFavorites(new Set(await fetchMyFavorites()));
    } catch {
      setFavorites(new Set());
    }
  }, []);

  const handleToggleFav = useCallback(
    async (idea: Idea) => {
      if (!profile) {
        toast('ログインしてください', 'error');
        return;
      }
      const isFav = favorites.has(idea.id);
      const next = new Set(favorites);
      if (isFav) next.delete(idea.id);
      else next.add(idea.id);
      setFavorites(next);
      try {
        await setFavorite(idea.id, !isFav);
        if (!isFav) toast('ほしいものリストに追加しました');
      } catch (e) {
        setFavorites(favorites);
        toast((e as Error).message, 'error');
      }
    },
    [favorites, profile],
  );

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setLoggedIn(!!data.session);
      if (data.session) refreshProfile(data.session.user.id);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      setLoggedIn(!!session);
      if (session) {
        refreshProfile(session.user.id);
        if (event === 'SIGNED_IN') toast('ログインしました');
      } else {
        setProfile(null);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [refreshProfile]);

  useEffect(() => {
    refreshIdeas();
    refreshFavorites();
  }, [refreshIdeas, refreshFavorites, loggedIn]);

  // Stripe Checkout からの戻り処理
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const payment = params.get('payment');
    const sessionId = params.get('session_id');
    if (!payment) return;
    window.history.replaceState({}, '', window.location.pathname);
    if (payment === 'success' && sessionId) {
      completeCheckout(sessionId)
        .then(async (msg) => {
          toast(msg);
          const { data } = await supabase.auth.getSession();
          if (data.session) {
            await refreshProfile(data.session.user.id);
            await refreshIdeas();
          }
        })
        .catch((e) => toast((e as Error).message, 'error'));
    } else if (payment === 'cancelled') {
      toast('決済をキャンセルしました', 'info');
    }
  }, [refreshProfile, refreshIdeas]);

  const handleAction = async (
    idea: Idea,
    action: 'accept' | 'submit' | 'approve' | 'revision' | 'withdraw' | 'buy-physical' | 'buy-digital',
  ) => {
    if (!loggedIn) return toast('ログインしてください', 'error');
    try {
      if (action === 'revision' || action === 'withdraw') {
        const comment = window.prompt(
          action === 'revision'
            ? '修正依頼の内容を入力してください（コメント欄に投稿され、モデラーに通知されます）'
            : 'モデリング中に戻す理由を入力してください（コメント欄に投稿され、モデラーに通知されます）',
        );
        if (comment === null) return;
        if (!comment.trim()) return toast('コメントを入力してください', 'error');
        const msg = await updateIdeaStatus(
          idea.id,
          action === 'revision' ? '修正依頼' : '取り下げ',
          comment.trim(),
        );
        toast(msg);
        await refreshIdeas();
        return;
      }
      if (action === 'accept' || action === 'submit' || action === 'approve') {
        const status = action === 'accept' ? '制作中' : action === 'submit' ? '提出中' : '販売中';
        const msg = await updateIdeaStatus(idea.id, status);
        toast(msg);
        await refreshIdeas();
      } else {
        const itemType = action === 'buy-physical' ? 'physical' : 'digital';
        const result = await createCheckout(idea.id, itemType);
        if (result.kind === 'direct') {
          toast(result.message);
          if (profile) await refreshProfile(profile.id);
          await refreshIdeas();
        } else {
          window.location.assign(result.url);
        }
      }
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const recruiting = ideas.filter((i) => i.status === 'アイデア募集');
  const inProgress = ideas.filter((i) => i.status === '制作中' || i.status === '提出中');
  const onSale = ideas.filter((i) => i.status === '販売中');

  type Order = 'new' | 'priceAsc' | 'priceDesc' | 'stlAsc' | 'stlDesc' | 'comments' | 'rating';
  const [genreFilter, setGenreFilter] = useState('すべて');
  const [sortOrder, setSortOrder] = useState<Order>('new');
  const [genreFilter2, setGenreFilter2] = useState('すべて');
  const [sortOrder2, setSortOrder2] = useState<Order>('new');
  const [genreFilter3, setGenreFilter3] = useState('すべて');
  const [sortOrder3, setSortOrder3] = useState<Order>('new');

  const applyFilterSort = (list: Idea[], genre: string, order: Order) => {
    const byGenre = genre === 'すべて' ? list : list.filter((i) => i.genre === genre);
    const byId = [...byGenre].sort((a, b) => b.id - a.id);
    if (order === 'priceAsc') return byId.sort((a, b) => a.price_physical - b.price_physical);
    if (order === 'priceDesc') return byId.sort((a, b) => b.price_physical - a.price_physical);
    if (order === 'stlAsc') return byId.sort((a, b) => a.price_digital - b.price_digital);
    if (order === 'stlDesc') return byId.sort((a, b) => b.price_digital - a.price_digital);
    if (order === 'comments') return byId.sort((a, b) => commentCount(b) - commentCount(a));
    if (order === 'rating')
      return byId.sort((a, b) => {
        const ra = ratingStats(a);
        const rb = ratingStats(b);
        const va = ra.count ? ra.avg! : -1;
        const vb = rb.count ? rb.avg! : -1;
        if (vb !== va) return vb - va;
        return rb.count - ra.count;
      });
    return byId;
  };

  const recruitingFiltered = useMemo(
    () => applyFilterSort(recruiting, genreFilter, sortOrder),
    [recruiting, genreFilter, sortOrder],
  );
  const inProgressFiltered = useMemo(
    () => applyFilterSort(inProgress, genreFilter2, sortOrder2),
    [inProgress, genreFilter2, sortOrder2],
  );
  const onSaleFiltered = useMemo(
    () => applyFilterSort(onSale, genreFilter3, sortOrder3),
    [onSale, genreFilter3, sortOrder3],
  );

  const usedGenres = (list: Idea[]) => GENRES.filter((g) => list.some((i) => i.genre === g));

  const gridProps = { profile, onOpen: setDetailId, onAction: handleAction };

  return (
    <div className="min-h-screen pb-20 sm:pb-16">
      <Header profile={profile} loggedIn={loggedIn} />

      <main className="mx-auto max-w-6xl px-4 pt-5">
        {loading ? (
          <p className="py-24 text-center text-sm text-stone-500">読み込み中…</p>
        ) : (
          <>
            {/* PC: 上部タブ */}
            <nav className="wood-panel mb-5 hidden gap-1.5 rounded-2xl border border-[#22384c] p-1.5 shadow-md shadow-[#010509]/40 sm:flex">
              {TABS.filter((t) => t.id !== 'admin' || profile?.is_admin).map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`flex-1 whitespace-nowrap rounded-xl px-3.5 py-2.5 text-xs font-bold transition ${
                    tab === t.id
                      ? t.id === 'admin'
                        ? 'bg-gradient-to-b from-amber-500 to-amber-600 text-white shadow-md shadow-amber-500/25'
                        : 'brass-btn text-[#05222e]'
                      : 'text-[#8fa9bd] hover:bg-white/10 hover:text-[#dcecf7]'
                  }`}
                >
                  <span className="mr-1">{t.icon}</span>
                  {t.label}
                </button>
              ))}
            </nav>

            {/* モバイル: 下部タブバー（全タブを常に一目で表示） */}
            <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-[#22384c] bg-[#050b12]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden">
              <div className="flex">
                {TABS.filter((t) => t.id !== 'admin' || profile?.is_admin).map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={`flex flex-1 flex-col items-center gap-0.5 px-0.5 py-2 transition ${
                      tab === t.id
                        ? t.id === 'admin'
                          ? 'text-amber-400'
                          : 'text-amber-300'
                        : 'text-[#6b8aa2]'
                    }`}
                  >
                    <span
                      className={`grid h-7 w-9 place-items-center rounded-lg text-base leading-none ${
                        tab === t.id
                          ? t.id === 'admin'
                            ? 'bg-gradient-to-b from-amber-500 to-amber-600 shadow-md shadow-amber-500/25'
                            : 'brass-btn'
                          : ''
                      }`}
                    >
                      {t.icon}
                    </span>
                    <span className="text-[9px] font-bold leading-tight">{t.label}</span>
                  </button>
                ))}
              </div>
            </nav>

            {tab === 'creator' && (
              <div className="grid items-start gap-6 lg:grid-cols-[400px_1fr]">
                <div className="space-y-3">
                  {loggedIn && profile ? (
                    <CreatorTab profile={profile} onCreated={refreshIdeas} />
                  ) : (
                    <div className="grid place-items-center rounded-2xl border border-dashed border-orange-200 bg-orange-50/50 py-16 text-center">
                      <p className="text-sm font-semibold text-orange-900">ログインしてアイデアを投稿しましょう</p>
                      <button
                        onClick={() => auth.openSignInModal()}
                        className="mt-4 rounded-xl bg-orange-600 px-6 py-2.5 text-sm font-bold text-white shadow-md shadow-orange-500/30 transition hover:bg-orange-700"
                      >
                        ログイン / 登録
                      </button>
                    </div>
                  )}
                </div>
                <section className="min-w-0">
                  <ListHeader
                    title="📌 モデラー募集中一覧"
                    count={recruitingFiltered.length}
                    genres={usedGenres(recruiting)}
                    genre={genreFilter}
                    onGenre={setGenreFilter}
                    order={sortOrder}
                    onOrder={setSortOrder}
                  />
                  <IdeaGrid ideas={recruitingFiltered} {...gridProps} emptyMessage="募集中のアイデアはまだありません。" />
                </section>
              </div>
            )}

            {tab === 'modeler' && (
              <section>
                <ListHeader
                  title="🛠️ 制作中・モデリング作業中の案件"
                  count={inProgressFiltered.length}
                  genres={usedGenres(inProgress)}
                  genre={genreFilter2}
                  onGenre={setGenreFilter2}
                  order={sortOrder2}
                  onOrder={setSortOrder2}
                />
                <IdeaGrid ideas={inProgressFiltered} {...gridProps} emptyMessage="制作中の案件はありません。" />
              </section>
            )}

            {tab === 'shop' && (
              <section>
                <ListHeader
                  title="🛒 販売中の商品（プリント品・STLデータ）"
                  count={onSaleFiltered.length}
                  genres={usedGenres(onSale)}
                  genre={genreFilter3}
                  onGenre={setGenreFilter3}
                  order={sortOrder3}
                  onOrder={setSortOrder3}
                />
                <IdeaGrid
                  ideas={onSaleFiltered}
                  {...gridProps}
                  showFav
                  favSet={favorites}
                  onToggleFav={handleToggleFav}
                  emptyMessage="販売中の商品はまだありません。"
                />
              </section>
            )}

            {tab === 'mypage' &&
              (loggedIn && profile ? (
                <MyPageTab
                  profile={profile}
                  ideas={ideas}
                  favorites={favorites}
                  onToggleFav={handleToggleFav}
                  onOpen={setDetailId}
                />
              ) : (
                <LoginPrompt />
              ))}

            {tab === 'sales' &&
              (loggedIn && profile ? (
                <SalesTab
                  profile={profile}
                  onBalanceChanged={() => profile && refreshProfile(profile.id)}
                />
              ) : (
                <LoginPrompt />
              ))}

            {tab === 'admin' && profile?.is_admin && <AdminTab onChanged={refreshIdeas} />}
          </>
        )}

        <footer className="stitch mt-16 rounded-xl bg-[#0d1a26]/70 px-4 pt-6 pb-2 text-center text-xs text-stone-500 backdrop-blur-sm">
          <p>🪵 © PlanMo — プランナーと3Dモデラーをつなぐ共創プラットフォーム</p>
          <button
            onClick={() => setShowLegal(true)}
            className="mt-2 font-semibold text-orange-600 transition hover:text-orange-800 hover:underline"
          >
            利用規約・プライバシーポリシー・特商法表記
          </button>
        </footer>
      </main>

      {detailId !== null && (
        <DetailModal
          ideaId={detailId}
          profile={profile}
          onClose={() => setDetailId(null)}
          onChanged={() => {
            refreshIdeas();
            if (profile) refreshProfile(profile.id);
          }}
        />
      )}

      {needsProfile && profile && (
        <ProfileModal profile={profile} onSaved={setProfile} onClose={() => setNeedsProfile(false)} />
      )}

      {showLegal && <LegalModal onClose={() => setShowLegal(false)} />}

      <ToastHost />
    </div>
  );
}

function ListHeader({
  title,
  count,
  genres,
  genre,
  onGenre,
  order,
  onOrder,
}: {
  title: string;
  count: number;
  genres: string[];
  genre: string;
  onGenre: (v: string) => void;
  order: 'new' | 'priceAsc' | 'priceDesc' | 'stlAsc' | 'stlDesc' | 'comments' | 'rating';
  onOrder: (v: 'new' | 'priceAsc' | 'priceDesc' | 'stlAsc' | 'stlDesc' | 'comments' | 'rating') => void;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <h3 className="text-sm font-bold text-stone-800">{title}</h3>
      <span className="text-[11px] font-semibold text-stone-400">{count}件</span>
      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        <select
          value={genre}
          onChange={(e) => onGenre(e.target.value)}
          className="rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-stone-700 outline-none focus:border-orange-500"
        >
          <option value="すべて">📂 すべてのジャンル</option>
          {genres.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        <select
          value={order}
          onChange={(e) => onOrder(e.target.value as 'new' | 'priceAsc' | 'priceDesc' | 'stlAsc' | 'stlDesc' | 'comments' | 'rating')}
          className="rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-stone-700 outline-none focus:border-orange-500"
        >
          <option value="new">↕️ 新着順</option>
          <option value="priceAsc">💰 プリント品が安い順</option>
          <option value="priceDesc">💎 プリント品が高い順</option>
          <option value="stlAsc">🧩 STLデータが安い順</option>
          <option value="stlDesc">📈 STLデータが高い順</option>
          <option value="comments">💬 コメント数順</option>
          <option value="rating">⭐ 評価が高い順</option>
        </select>
      </div>
    </div>
  );
}

function LoginPrompt() {
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-stone-300 bg-[#0f1e2d]/60 py-20 text-center">
      <p className="text-sm font-semibold text-stone-600">このページを利用するにはログインしてください</p>
      <button
        onClick={() => auth.openSignInModal()}
        className="mt-4 rounded-xl bg-orange-600 px-6 py-2.5 text-sm font-bold text-white shadow-md shadow-orange-500/30 transition hover:bg-orange-700"
      >
        ログイン / 登録
      </button>
    </div>
  );
}
