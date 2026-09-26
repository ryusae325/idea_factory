import type { Profile } from '../lib/types';
import { fmtYen } from '../lib/types';
import { supabase, auth } from '../lib/supabase';

interface Props {
  profile: Profile | null;
  loggedIn: boolean;
}

export default function Header({ profile, loggedIn }: Props) {
  return (
    <header className="wood-panel sticky top-0 z-40 border-b border-[#312217] shadow-lg shadow-[#4a3524]/50">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="brass-btn grid h-10 w-10 place-items-center rounded-xl text-lg">
            💡
          </div>
          <div>
            <h1 className="text-base font-bold leading-tight text-[#f5ead3]">ヒラメキ工房</h1>
            <p className="text-[11px] leading-tight text-[#c9b28c]">考案者 × 3Dモデラー 共創プラットフォーム</p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {loggedIn && profile && (
            <>
              <span className="hidden items-center gap-1.5 rounded-full bg-[#5f4530]/70 px-3 py-1.5 text-xs font-semibold text-[#f0e2c4] ring-1 ring-[#8a6a4a] sm:inline-flex">
                💰 売上残高 {fmtYen(profile.balance)}円
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#5f4530]/70 px-3 py-1.5 text-xs font-semibold text-[#f0e2c4] ring-1 ring-[#8a6a4a]">
                <span className="brass-btn grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold text-[#3a2715]">
                  {(profile.display_name || profile.username).slice(0, 1).toUpperCase()}
                </span>
                <span className="hidden sm:inline">{profile.display_name || profile.username}</span>
                <span className="text-[#b3976d]">({profile.role})</span>
              </span>
            </>
          )}
          {loggedIn ? (
            <button
              onClick={() => supabase.auth.signOut()}
              className="rounded-lg border border-[#8a6a4a] bg-transparent px-3.5 py-2 text-xs font-semibold text-[#e8d7b6] transition hover:bg-white/10"
            >
              ログアウト
            </button>
          ) : (
            <button
              onClick={() => auth.openSignInModal()}
              className="brass-btn rounded-lg px-4 py-2 text-xs font-bold text-[#3a2715] transition hover:brightness-110"
            >
              ログイン / 登録
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
