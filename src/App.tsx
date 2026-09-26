import { useCallback, useEffect, useState } from 'react';
import type { Idea, Profile } from './lib/types';
import { supabase, auth } from './lib/supabase';
import { fetchIdeas, fetchProfile, updateIdeaStatus, createCheckout, completeCheckout } from './lib/data';
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
  const [tab, setTab] = useState<TabId>('creator');
  const [detailId, setDetailId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshProfile = useCallback(async (userId: string) => {
    try {
      const p = await fetchProfile(userId);
      setProfile(p);
      setNeedsProfile(!!p && !p.display_name);
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
  }, [refreshIdeas, loggedIn]);

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

  const handleAction = async (idea: Idea, action: 'accept' | 'complete' | 'buy-physical' | 'buy-digital') => {
    if (!loggedIn) return toast('ログインしてください', 'error');
    try {
      if (action === 'accept' || action === 'complete') {
        const msg = await updateIdeaStatus(idea.id, action === 'accept' ? '制作中' : '販売中');
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
  const inProgress = ideas.filter((i) => i.status === '制作中');
  const onSale = ideas.filter((i) => i.status === '販売中');

  const gridProps = { profile, onOpen: setDetailId, onAction: handleAction };

  return (
    <div className="min-h-screen pb-16">
      <Header profile={profile} loggedIn={loggedIn} />

      <main className="mx-auto max-w-6xl px-4 pt-5">
        {loading ? (
          <p className="py-24 text-center text-sm text-stone-500">読み込み中…</p>
        ) : (
          <>
            <nav className="wood-panel mb-5 flex gap-1.5 overflow-x-auto rounded-2xl border border-[#312217] p-1.5 shadow-md shadow-[#4a3524]/40">
              {TABS.filter((t) => t.id !== 'admin' || profile?.is_admin).map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`flex-1 whitespace-nowrap rounded-xl px-3.5 py-2.5 text-xs font-bold transition ${
                    tab === t.id
                      ? t.id === 'admin'
                        ? 'bg-gradient-to-b from-amber-500 to-amber-600 text-white shadow-md shadow-amber-900/50'
                        : 'brass-btn text-[#3a2715]'
                      : 'text-[#cbb48d] hover:bg-white/10 hover:text-[#f0e2c4]'
                  }`}
                >
                  <span className="mr-1">{t.icon}</span>
                  {t.label}
                </button>
              ))}
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
                  <h3 className="mb-3 text-sm font-bold text-stone-800">📌 モデラー募集中一覧</h3>
                  <IdeaGrid ideas={recruiting} {...gridProps} emptyMessage="募集中のアイデアはまだありません。" />
                </section>
              </div>
            )}

            {tab === 'modeler' && (
              <section>
                <h3 className="mb-3 text-sm font-bold text-stone-800">🛠️ 制作中・モデリング作業中の案件</h3>
                <IdeaGrid ideas={inProgress} {...gridProps} emptyMessage="制作中の案件はありません。" />
              </section>
            )}

            {tab === 'shop' && (
              <section>
                <h3 className="mb-3 text-sm font-bold text-stone-800">🛒 販売中の商品（プリント品・STLデータ）</h3>
                <IdeaGrid ideas={onSale} {...gridProps} emptyMessage="販売中の商品はまだありません。" />
              </section>
            )}

            {tab === 'mypage' &&
              (loggedIn && profile ? (
                <MyPageTab profile={profile} ideas={ideas} />
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

        <footer className="stitch mt-16 rounded-xl bg-[#fff9ec]/70 px-4 pt-6 pb-2 text-center text-xs text-stone-500 backdrop-blur-sm">
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

function LoginPrompt() {
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-stone-300 bg-[#fffdf8]/60 py-20 text-center">
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
