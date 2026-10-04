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
import { AboutModal, FaqModal, ContactModal, SafetyModal } from './components/InfoModals';
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
  const [showAbout, setShowAbout] = useState(false);
  const [showFaq, setShowFaq] = useState(false);
  const [showContact, setShowContact] = useState(false);
  const [showSafety, setShowSafety] = useState(false);
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
  const [query1, setQuery1] = useState('');
  const [query2, setQuery2] = useState('');
  const [query3, setQuery3] = useState('');
  const [showTop, setShowTop] = useState(false);

  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 600);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

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

  const matchesQuery = (i: Idea, q: string) =>
    !q.trim() ||
    i.title.includes(q.trim()) ||
    (i.desc ?? '').includes(q.trim()) ||
    i.genre.includes(q.trim());

  const recruitingFiltered = useMemo(
    () => applyFilterSort(recruiting.filter((i) => matchesQuery(i, query1)), genreFilter, sortOrder),
    [recruiting, genreFilter, sortOrder, query1],
  );
  const inProgressFiltered = useMemo(
    () => applyFilterSort(inProgress.filter((i) => matchesQuery(i, query2)), genreFilter2, sortOrder2),
    [inProgress, genreFilter2, sortOrder2, query2],
  );
  const onSaleFiltered = useMemo(
    () => applyFilterSort(onSale.filter((i) => matchesQuery(i, query3)), genreFilter3, sortOrder3),
    [onSale, genreFilter3, sortOrder3, query3],
  );

  const usedGenres = (list: Idea[]) => GENRES.filter((g) => list.some((i) => i.genre === g));

  const gridProps = { profile, onOpen: setDetailId, onAction: handleAction };

  return (
    <div className="min-h-screen pb-[calc(4.5rem+env(safe-area-inset-bottom))] sm:pb-16">
      <Header profile={profile} loggedIn={loggedIn} />

      <main className="mx-auto max-w-6xl px-4 pt-5">
        <Hero
          loggedIn={loggedIn}
          onPost={() => setTab('creator')}
          onShop={() => setTab('shop')}
        />

        {loading ? (
          <SkeletonGrid />
        ) : (
          <>
            {/* PC: 上部タブ */}
            <nav className="wood-panel mb-5 hidden gap-1.5 rounded-2xl border border-[#0c2240] p-1.5 shadow-md shadow-[#1e3a5f]/40 sm:flex">
              {TABS.filter((t) => t.id !== 'admin' || profile?.is_admin).map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`flex-1 whitespace-nowrap rounded-xl px-3.5 py-2.5 text-xs font-bold transition ${
                    tab === t.id
                      ? t.id === 'admin'
                        ? 'bg-gradient-to-b from-amber-500 to-amber-600 text-white shadow-md shadow-amber-500/25'
                        : 'brass-btn text-white'
                      : 'text-[#94a3b8] hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <span className="mr-1">{t.icon}</span>
                  {t.label}
                </button>
              ))}
            </nav>

            {/* モバイル: 下部タブバー（全タブを常に一目で表示） */}
            <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-[#0c2240] bg-[#0f2a4a]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden">
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
                        : 'text-[#64748b]'
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
                    query={query1}
                    onQuery={setQuery1}
                    onRefresh={refreshIdeas}
                  />
                  <IdeaGrid
                    ideas={recruitingFiltered}
                    {...gridProps}
                    emptyMessage="募集中のアイデアはまだありません。"
                    emptyAction={
                      <button
                        onClick={() => (loggedIn ? setTab('creator') : auth.openSignInModal())}
                        className="brass-btn rounded-full px-6 py-2.5 text-sm font-bold"
                      >
                        最初のアイデアを投稿してみよう
                      </button>
                    }
                    demo={<DemoGrid items={DEMO_RECRUITING} />}
                  />
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
                  query={query2}
                  onQuery={setQuery2}
                  onRefresh={refreshIdeas}
                />
                <IdeaGrid
                  ideas={inProgressFiltered}
                  {...gridProps}
                  emptyMessage="制作中の案件はありません。"
                  emptyAction={
                    <button
                      onClick={() => setTab('shop')}
                      className="rounded-full border border-blue-200 bg-blue-50 px-6 py-2.5 text-sm font-bold text-blue-700 transition hover:bg-blue-100"
                    >
                      販売中の商品を見る
                    </button>
                  }
                />
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
                  query={query3}
                  onQuery={setQuery3}
                  onRefresh={refreshIdeas}
                />
                <IdeaGrid
                  ideas={onSaleFiltered}
                  {...gridProps}
                  showFav
                  favSet={favorites}
                  onToggleFav={handleToggleFav}
                  emptyMessage="販売中の商品はまだありません。"
                  demo={<DemoGrid items={DEMO_SHOP} />}
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

        <footer className="mt-16">
          <div className="rounded-2xl bg-[#0f2a4a] px-6 py-10 text-slate-300 shadow-md shadow-slate-900/10 sm:px-10">
            <div className="mx-auto grid max-w-5xl gap-8 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="flex items-center gap-2 text-lg font-extrabold text-white">
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-amber-400 text-base">💡</span>
                  PlanMo
                </p>
                <p className="mt-3 text-xs leading-relaxed text-slate-400">
                  アイデアと3D技術が出会う共創プラットフォーム。プランナーとモデラーをつなぎ、企画から販売までを公正な収益分配で支えます。
                </p>
              </div>
              <FooterCol
                title="運営"
                links={[
                  { label: '運営情報・理念', onClick: () => setShowAbout(true) },
                  { label: '安心・安全への取り組み', onClick: () => setShowSafety(true) },
                ]}
              />
              <FooterCol
                title="サポート"
                links={[
                  { label: 'よくある質問（FAQ）', onClick: () => setShowFaq(true) },
                  { label: 'お問い合わせ', onClick: () => setShowContact(true) },
                ]}
              />
              <FooterCol
                title="法務"
                links={[{ label: '利用規約・プライバシーポリシー・特商法表記', onClick: () => setShowLegal(true) }]}
              />
            </div>
            <p className="mt-10 border-t border-white/10 pt-6 text-center text-[11px] text-slate-500">
              © {new Date().getFullYear()} PlanMo — プランナーと3Dモデラーをつなぐ共創プラットフォーム
            </p>
          </div>
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
      {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}
      {showFaq && <FaqModal onClose={() => setShowFaq(false)} />}
      {showContact && <ContactModal onClose={() => setShowContact(false)} />}
      {showSafety && <SafetyModal onClose={() => setShowSafety(false)} />}

      {showTop && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label="ページ上部へ"
          className="scroll-fab fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-40 grid h-11 w-11 place-items-center rounded-full bg-white text-lg text-[#0f2a4a] sm:bottom-6"
        >
          ↑
        </button>
      )}

      <ToastHost />
    </div>
  );
}

function Hero({ loggedIn, onPost, onShop }: { loggedIn: boolean; onPost: () => void; onShop: () => void }) {
  const [open, setOpen] = useState(true);
  const steps = [
    { icon: '💡', title: 'アイデアを投稿', body: 'プランナーが商品のアイデアを投稿し、モデラーを募集します' },
    { icon: '🛠️', title: 'モデラーが制作', body: 'マッチしたモデラーが3Dデータを制作・提案します' },
    { icon: '🛒', title: '販売・収益分配', body: 'プリント品/STLデータとして販売し、売上を公正に分配します' },
  ];
  return (
    <section className="relative mb-5 overflow-hidden rounded-2xl bg-gradient-to-br from-[#0f2a4a] via-[#163a5f] to-[#0f2a4a] px-4 py-5 text-white shadow-md shadow-slate-900/10 sm:mb-6 sm:px-10 sm:py-10">
      <div className="mx-auto max-w-4xl">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? '案内をたたむ' : '案内を開く'}
          className="absolute right-3 top-3 z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/10 text-sm ring-1 ring-white/25 transition hover:bg-white/20 sm:right-4 sm:top-4"
        >
          {open ? '▲' : '▼'}
        </button>
        <p className="text-[10px] font-bold tracking-[0.2em] text-amber-300 sm:text-[11px]">PLANMO — CO-CREATION PLATFORM</p>
        <h2 className="mt-1.5 text-lg font-extrabold leading-snug sm:mt-2 sm:text-2xl">
          アイデアと3D技術が出会う
          <br className="sm:hidden" />
          共創プラットフォーム
        </h2>
        {open && (
          <>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-300 sm:mt-2 sm:text-sm">
              思いつきを、売れる3D商品に。PlanMo なら、モデリングの技術がなくても大丈夫。
            </p>
            <div className="no-scrollbar -mx-4 mt-3.5 flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-2.5 sm:overflow-visible sm:px-0 sm:pb-0">
              {steps.map((s, i) => (
                <div key={s.title} className="w-[15rem] shrink-0 snap-start rounded-xl bg-white/10 px-3.5 py-3 backdrop-blur-sm sm:w-auto sm:shrink sm:px-4 sm:py-3.5">
                  <p className="text-lg">{s.icon}</p>
                  <p className="mt-0.5 whitespace-nowrap text-xs font-bold">
                    <span className="mr-1.5 text-amber-300">{i + 1}</span>
                    {s.title}
                  </p>
                  <p className="mt-1 text-[10px] leading-relaxed text-slate-300 sm:whitespace-normal">{s.body}</p>
                </div>
              ))}
            </div>
            <div className="mt-3.5 flex flex-wrap gap-2.5 sm:mt-5">
              <button
                onClick={onPost}
                className="brass-btn whitespace-nowrap rounded-full px-5 py-2.5 text-sm font-bold sm:px-6"
              >
                {loggedIn ? 'アイデアを投稿する' : '始める（無料登録）'}
              </button>
              <button
                onClick={onShop}
                className="whitespace-nowrap rounded-full border border-white/25 bg-white/10 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-white/20 sm:px-6"
              >
                商品を見る
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function FooterCol({ title, links }: { title: string; links: { label: string; onClick: () => void }[] }) {
  return (
    <div>
      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">{title}</h4>
      <ul className="mt-3 space-y-2.5">
        {links.map((l) => (
          <li key={l.label}>
            <button
              onClick={l.onClick}
              className="text-xs text-slate-300 transition hover:text-white hover:underline"
            >
              {l.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DemoCard({ d }: { d: { icon: string; title: string; creator: string; status: string; badge: string; price1: string; price2: string; note: string } }) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
      <span className="absolute right-3 top-3 z-10 rounded-full bg-slate-900/70 px-2.5 py-1 text-[10px] font-bold text-white">
        サンプル
      </span>
      <div className="grid h-40 place-items-center bg-gradient-to-br from-slate-100 to-slate-200 text-5xl">{d.icon}</div>
      <div className="space-y-2.5 p-4">
        <div>
          <h3 className="line-clamp-1 text-[15px] font-bold text-slate-900">{d.title}</h3>
          <p className="mt-0.5 text-[11px] text-slate-400">{d.creator}</p>
        </div>
        <span className={`inline-block rounded-full px-2.5 py-1 text-[10px] font-bold ${d.badge}`}>{d.status}</span>
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-2.5">
          <div>
            <p className="text-[10px] font-semibold text-slate-400">プリント品</p>
            <p className="text-sm font-bold text-[#0f2a4a]">{d.price1}</p>
          </div>
          <div className="border-l border-slate-200 pl-2.5">
            <p className="text-[10px] font-semibold text-slate-400">STLデータ</p>
            <p className="text-sm font-bold text-[#0f2a4a]">{d.price2}</p>
          </div>
        </div>
        <p className="text-[10px] text-slate-400">{d.note}</p>
      </div>
    </div>
  );
}

function DemoGrid({ items }: { items: { icon: string; title: string; creator: string; status: string; badge: string; price1: string; price2: string; note: string }[] }) {
  return (
    <>
      {items.map((d, i) => (
        <DemoCard key={i} d={d} />
      ))}
    </>
  );
}

const DEMO_RECRUITING = [
  {
    icon: '🏠',
    title: 'コンパクトに畳める屋外用プランタースタンド',
    creator: 'ぽんず × モデラー募集中',
    status: 'アイデア募集',
    badge: 'bg-amber-100 text-amber-800',
    price1: '2,980円',
    price2: '980円',
    note: 'ベランダガーデニング向け。折りたたみ式で収納サイズ 20cm。',
  },
  {
    icon: '🎧',
    title: 'ケーブルを巻き取れるデスク用ヘッドホンスタンド',
    creator: 'みなと × モデラー募集中',
    status: 'アイデア募集',
    badge: 'bg-amber-100 text-amber-800',
    price1: '3,400円',
    price2: '1,200円',
    note: '底部にケーブルガイド付き。デスク回りをすっきり。',
  },
  {
    icon: '🚲',
    title: 'サドル下に取り付けられる自転車用サイドバッグフック',
    creator: 'ゆうき × モデラー募集中',
    status: 'アイデア募集',
    badge: 'bg-amber-100 text-amber-800',
    price1: '1,980円',
    price2: '680円',
    note: 'ツール缶や軽量バッグをワンタッチで脱着できます。',
  },
];

const DEMO_SHOP = [
  {
    icon: '🐈',
    title: '壁に付けられる猫用ステップ（3段セット）',
    creator: 'ねこまんま × モデル: kenji',
    status: '販売中',
    badge: 'bg-emerald-100 text-emerald-700',
    price1: '4,980円',
    price2: '1,980円',
    note: '耐荷重テスト済み。両面テープ or ネジ留め対応。',
  },
  {
    icon: '🖊️',
    title: '回転する多機能ペンスタンド「スピンオーガナイザー」',
    creator: 'しおん × モデル: モデル太郎',
    status: '販売中',
    badge: 'bg-emerald-100 text-emerald-700',
    price1: '2,480円',
    price2: '880円',
    note: 'ペン12本＋スマホスタンド付き。',
  },
];

function ListHeader({
  title,
  count,
  genres,
  genre,
  onGenre,
  order,
  onOrder,
  query,
  onQuery,
  onRefresh,
}: {
  title: string;
  count: number;
  genres: string[];
  genre: string;
  onGenre: (v: string) => void;
  order: 'new' | 'priceAsc' | 'priceDesc' | 'stlAsc' | 'stlDesc' | 'comments' | 'rating';
  onOrder: (v: 'new' | 'priceAsc' | 'priceDesc' | 'stlAsc' | 'stlDesc' | 'comments' | 'rating') => void;
  query?: string;
  onQuery?: (v: string) => void;
  onRefresh?: () => void;
}) {
  return (
    <div className="mb-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-bold text-stone-800">{title}</h3>
        <span className="text-[11px] font-semibold text-stone-400">{count}件</span>
        <div className="ml-auto flex items-center gap-1.5">
          {onRefresh && (
            <button
              onClick={onRefresh}
              aria-label="最新情報に更新"
              className="grid h-8 w-8 place-items-center rounded-full border border-stone-300 bg-white text-sm text-stone-500 transition hover:border-orange-400 hover:text-orange-600"
            >
              ⟳
            </button>
          )}
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
      {onQuery !== undefined && (
        <input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="🔍 キーワードで絞り込む（タイトル・説明）"
          className="w-full rounded-full border border-stone-300 bg-white px-4 py-2 text-xs text-stone-700 placeholder:text-stone-400 outline-none focus:border-orange-500"
        />
      )}
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="読み込み中">
      {[0, 1, 2, 3, 4, 5].map((n) => (
        <div key={n} className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
          <div className="skeleton h-40 rounded-none" />
          <div className="space-y-2.5 p-4">
            <div className="skeleton h-4 w-3/4" />
            <div className="skeleton h-3 w-1/2" />
            <div className="skeleton h-9 w-full !rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

function LoginPrompt() {
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-stone-300 bg-white/60 py-20 text-center">
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
