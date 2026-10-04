import { useState } from 'react';
import type { Profile } from '../lib/types';
import { fmtYen } from '../lib/types';
import { supabase, auth } from '../lib/supabase';
import NotificationBell from './NotificationBell';
import SettingsModal from './SettingsModal';

interface Props {
  profile: Profile | null;
  loggedIn: boolean;
}

export default function Header({ profile, loggedIn }: Props) {
  const [showSettings, setShowSettings] = useState(false);
  return (
    <header className="wood-panel sticky top-0 z-40 border-b border-[#0c2240] shadow-lg shadow-[#1e3a5f]/50">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="brass-btn grid h-10 w-10 place-items-center rounded-xl text-lg">
            💡
          </div>
          <div>
            <h1 className="text-base font-bold leading-tight text-white">PlanMo</h1>
            <p className="text-[11px] leading-tight text-[#64748b]">プランナー × 3Dモデラー 共創プラットフォーム</p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {loggedIn && profile && (
            <button
              onClick={() => setShowSettings(true)}
              aria-label="設定"
              className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-base ring-1 ring-white/25 transition hover:bg-white/20"
            >
              ⚙️
            </button>
          )}
          {loggedIn && profile && <NotificationBell profile={profile} />}
          {loggedIn && profile && (
            <>
              <span className="hidden items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white ring-1 ring-white/25 sm:inline-flex">
                💰 売上残高 {fmtYen(profile.balance)}円
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white ring-1 ring-white/25">
                <span className="brass-btn grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold text-white">
                  {(profile.display_name || profile.username).slice(0, 1).toUpperCase()}
                </span>
                <span className="hidden sm:inline">{profile.display_name || profile.username}</span>
              </span>
            </>
          )}
          {loggedIn ? (
            <button
              onClick={() => supabase.auth.signOut()}
              className="rounded-lg border border-slate-300 bg-transparent px-3.5 py-2 text-xs font-semibold text-[#e2e8f0] transition hover:bg-white/10"
            >
              ログアウト
            </button>
          ) : (
            <button
              onClick={() => auth.openSignInModal()}
              className="brass-btn rounded-lg px-4 py-2 text-xs font-bold text-white transition hover:brightness-110"
            >
              ログイン / 登録
            </button>
          )}
        </div>
      </div>

      {showSettings && profile && <SettingsModal profile={profile} onClose={() => setShowSettings(false)} />}
    </header>
  );
}
