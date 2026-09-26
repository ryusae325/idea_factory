import type { Profile } from '../lib/types';
import { fmtYen } from '../lib/types';
import { supabase, auth } from '../lib/supabase';

interface Props {
  profile: Profile | null;
  loggedIn: boolean;
}

export default function Header({ profile, loggedIn }: Props) {
  return (
    <header className="sticky top-0 z-40 border-b border-stone-200/70 bg-[#fffdf8]/80 backdrop-blur-lg">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-orange-500 to-amber-600 text-lg shadow-md shadow-orange-500/30">
            💡
          </div>
          <div>
            <h1 className="text-base font-bold leading-tight text-stone-900">ヒラメキ工房</h1>
            <p className="text-[11px] leading-tight text-stone-500">考案者 × 3Dモデラー 共創プラットフォーム</p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {loggedIn && profile && (
            <>
              <span className="hidden items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200 sm:inline-flex">
                💰 売上残高 {fmtYen(profile.balance)}円
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-50 px-3 py-1.5 text-xs font-semibold text-orange-700 ring-1 ring-orange-200">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-orange-500 text-[10px] font-bold text-white">
                  {(profile.display_name || profile.username).slice(0, 1).toUpperCase()}
                </span>
                <span className="hidden sm:inline">{profile.display_name || profile.username}</span>
                <span className="text-orange-400">({profile.role})</span>
              </span>
            </>
          )}
          {loggedIn ? (
            <button
              onClick={() => supabase.auth.signOut()}
              className="rounded-lg border border-stone-200 bg-[#fffdf8] px-3.5 py-2 text-xs font-semibold text-stone-600 transition hover:bg-stone-50"
            >
              ログアウト
            </button>
          ) : (
            <button
              onClick={() => auth.openSignInModal()}
              className="rounded-lg bg-orange-600 px-4 py-2 text-xs font-bold text-white shadow-md shadow-orange-500/30 transition hover:bg-orange-700"
            >
              ログイン / 登録
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
