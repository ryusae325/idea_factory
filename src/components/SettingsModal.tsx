import { useEffect, useState } from 'react';
import type { Profile } from '../lib/types';
import { supabase } from '../lib/supabase';
import { updateProfile, fetchMyOrders, fetchMyBalanceHistory, fetchMyExchangeRequests, deleteMyAccount } from '../lib/data';
import { toast } from '../lib/toast';

export default function SettingsModal({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const [section, setSection] = useState<'profile' | 'account' | 'privacy'>('profile');
  const [displayName, setDisplayName] = useState(profile.display_name || '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [email, setEmail] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ''));
  }, []);

  const saveProfile = async () => {
    if (!displayName.trim()) return toast('表示名を入力してください', 'error');
    setSavingProfile(true);
    try {
      await updateProfile(profile.id, { display_name: displayName.trim() });
      toast('プロフィールを保存しました');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setSavingProfile(false);
    }
  };

  const changeEmail = async () => {
    if (!newEmail.trim() || !newEmail.includes('@')) return toast('有効なメールアドレスを入力してください', 'error');
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ email: newEmail.trim() });
      if (error) throw new Error(error.message);
      toast('確認メールを送信しました。新しいメールアドレスの受信箱を確認してください');
      setNewEmail('');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async () => {
    if (password.length < 6) return toast('パスワードは6文字以上にしてください', 'error');
    if (password !== password2) return toast('パスワードが一致しません', 'error');
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw new Error(error.message);
      toast('パスワードを変更しました');
      setPassword('');
      setPassword2('');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const signOutAll = async () => {
    setBusy(true);
    try {
      await supabase.auth.signOut({ scope: 'global' });
      window.location.reload();
    } catch (e) {
      toast((e as Error).message, 'error');
      setBusy(false);
    }
  };

  const exportData = async () => {
    setBusy(true);
    try {
      const [orders, balance, exchanges] = await Promise.all([
        fetchMyOrders(profile.id),
        fetchMyBalanceHistory(profile.id),
        fetchMyExchangeRequests(profile.id),
      ]);
      const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), profile: { display_name: profile.display_name }, orders, balance_history: balance, exchange_requests: exchanges }, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `planmo-data-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast('データを書き出しました');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const deleteAccount = async () => {
    if (!window.confirm('本当に退会しますか？\n投稿したアイデア・購入履歴・残高・交換申請など、アカウントのすべてのデータが削除され、元に戻せません。')) return;
    if (!window.confirm('最終確認です。この操作は取り消せません。本当に退会しますか？')) return;
    setBusy(true);
    try {
      await deleteMyAccount();
      await supabase.auth.signOut({ scope: 'global' });
      window.location.reload();
    } catch (e) {
      toast((e as Error).message, 'error');
      setBusy(false);
    }
  };

  const TABS = [
    { id: 'profile', label: '👤 プロフィール' },
    { id: 'account', label: '🔐 アカウント' },
    { id: 'privacy', label: '🛡️ データ・退会' },
  ] as const;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4 backdrop-blur-sm">
      <div className="max-h-[88vh] w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-stone-200 px-5 py-4">
          <h3 className="text-base font-bold text-stone-900">⚙️ 設定</h3>
          <button
            onClick={onClose}
            className="rounded-lg px-2.5 py-1.5 text-sm text-stone-400 transition hover:bg-stone-100 hover:text-stone-600"
          >
            ✕
          </button>
        </div>

        <div className="flex gap-1 border-b border-stone-200 bg-stone-50 px-4 py-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setSection(t.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                section === t.id ? 'bg-orange-600 text-white' : 'text-stone-500 hover:bg-stone-100'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto px-6 py-5 text-[13px] leading-relaxed text-stone-700">
          {section === 'profile' && (
            <>
              <p className="text-xs text-stone-500">
                ユーザー名: <b className="text-stone-700">{profile.username}</b>
              </p>
              <div>
                <label className="block text-xs font-bold text-stone-600">表示名</label>
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-orange-500"
                />
                <p className="mt-1 text-[11px] text-stone-400">
                  PlanMo では、どなたでもアイデアの投稿・モデリング・購入を自由に行えます（役割の登録は不要です）。
                </p>
              </div>
              <button
                onClick={saveProfile}
                disabled={savingProfile}
                className="rounded-lg bg-orange-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-orange-700 disabled:opacity-50"
              >
                {savingProfile ? '保存中…' : '保存する'}
              </button>
            </>
          )}

          {section === 'account' && (
            <>
              <p className="text-xs text-stone-500">
                現在のメールアドレス: <b className="break-all text-stone-700">{email || '—'}</b>
              </p>
              <div className="rounded-lg bg-stone-50 p-4 ring-1 ring-stone-200">
                <p className="text-xs font-bold text-stone-700">📧 メールアドレスの変更</p>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="新しいメールアドレス"
                  className="mt-2 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-orange-500"
                />
                <button
                  onClick={changeEmail}
                  disabled={busy}
                  className="mt-2 rounded-lg bg-orange-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-orange-700 disabled:opacity-50"
                >
                  確認メールを送信
                </button>
                <p className="mt-1.5 text-[11px] text-stone-400">新しいアドレス宛の確認メール内のリンクを開くと変更が完了します。</p>
              </div>
              <div className="rounded-lg bg-stone-50 p-4 ring-1 ring-stone-200">
                <p className="text-xs font-bold text-stone-700">🔑 パスワードの変更</p>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="新しいパスワード（6文字以上）"
                  className="mt-2 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-orange-500"
                />
                <input
                  type="password"
                  value={password2}
                  onChange={(e) => setPassword2(e.target.value)}
                  placeholder="新しいパスワード（確認用）"
                  className="mt-2 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-orange-500"
                />
                <button
                  onClick={changePassword}
                  disabled={busy}
                  className="mt-2 rounded-lg bg-orange-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-orange-700 disabled:opacity-50"
                >
                  パスワードを変更
                </button>
                <p className="mt-1.5 text-[11px] text-stone-400">Google でログインしている場合は、パスワード設定後にメール＋パスワードでもログインできるようになります。</p>
              </div>
              <div className="rounded-lg bg-stone-50 p-4 ring-1 ring-stone-200">
                <p className="text-xs font-bold text-stone-700">🚪 セキュリティ</p>
                <p className="mt-1 text-[11px] text-stone-500">すべてのデバイスでログアウトします（パスワードを忘れた・共用PCで使った場合など）。</p>
                <button
                  onClick={signOutAll}
                  disabled={busy}
                  className="mt-2 rounded-lg bg-[#0f2a4a] px-4 py-2 text-xs font-bold text-white ring-1 ring-[#1e3a5f] transition hover:bg-[#163a5f] disabled:opacity-50"
                >
                  全デバイスからログアウト
                </button>
              </div>
            </>
          )}

          {section === 'privacy' && (
            <>
              <div className="rounded-lg bg-stone-50 p-4 ring-1 ring-stone-200">
                <p className="text-xs font-bold text-stone-700">📥 自分のデータの書き出し</p>
                <p className="mt-1 text-[11px] text-stone-500">
                  購入履歴・残高履歴・交換申請履歴をJSONファイルでダウンロードできます。
                </p>
                <button
                  onClick={exportData}
                  disabled={busy}
                  className="mt-2 rounded-lg bg-[#0f2a4a] px-4 py-2 text-xs font-bold text-white ring-1 ring-[#1e3a5f] transition hover:bg-[#163a5f] disabled:opacity-50"
                >
                  データを書き出す
                </button>
              </div>
              <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                <p className="text-xs font-bold text-red-700">⚠️ 退会（アカウント削除）</p>
                <p className="mt-1 text-[11px] leading-relaxed text-red-600">
                  投稿したアイデア・購入履歴・残高・交換申請がすべて削除され、元に戻せません。未交換の残高がある場合は、退会前に「売上・ギフト」から交換申請を行ってください。
                </p>
                <button
                  onClick={deleteAccount}
                  disabled={busy}
                  className="mt-2 rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-red-700 disabled:opacity-50"
                >
                  アカウントを削除する
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
