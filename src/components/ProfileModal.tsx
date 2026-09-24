import { useState } from 'react';
import type { Profile, Role } from '../lib/types';
import { updateProfile } from '../lib/data';
import { toast } from '../lib/toast';

interface Props {
  profile: Profile;
  onSaved: (p: Profile) => void;
  onClose: () => void;
}

const ROLES: { value: Role; desc: string }[] = [
  { value: '考案者', desc: 'アイデアを投稿してモデラーを募集する' },
  { value: 'モデラー', desc: 'アイデアを引き受けて3Dデータ化する' },
  { value: '購入者', desc: '完成した商品を購入する' },
];

export default function ProfileModal({ profile, onSaved, onClose }: Props) {
  const [name, setName] = useState(profile.display_name || '');
  const [role, setRole] = useState<Profile['role']>(profile.role === '運営者' ? '購入者' : profile.role);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) return toast('表示名を入力してください', 'error');
    setBusy(true);
    try {
      await updateProfile(profile.id, { display_name: name.trim(), role });
      toast('プロフィールを保存しました');
      onSaved({ ...profile, display_name: name.trim(), role });
      onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <h3 className="text-lg font-bold text-slate-900">👋 プロフィールを設定</h3>
        <p className="mt-1 text-xs text-slate-500">
          サービス内で表示する名前と、あなたの役割を選んでください。
        </p>

        <label className="mt-5 block text-xs font-bold text-slate-600">表示名</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例: あさひ製作所"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
        />

        <label className="mt-4 block text-xs font-bold text-slate-600">役割（後で変更できます）</label>
        <div className="mt-2 space-y-2">
          {ROLES.map((r) => (
            <label
              key={r.value}
              className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-3 transition ${
                role === r.value
                  ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-300'
                  : 'border-slate-200 hover:bg-slate-50'
              }`}
            >
              <input
                type="radio"
                name="role"
                checked={role === r.value}
                onChange={() => setRole(r.value)}
                className="accent-indigo-600"
              />
              <span>
                <span className="block text-sm font-bold text-slate-800">{r.value}</span>
                <span className="block text-[11px] text-slate-500">{r.desc}</span>
              </span>
            </label>
          ))}
        </div>

        <div className="mt-6 flex gap-2">
          <button
            onClick={save}
            disabled={busy}
            className="flex-1 rounded-xl bg-indigo-600 py-2.5 text-sm font-bold text-white shadow-md shadow-indigo-500/30 transition hover:bg-indigo-700 disabled:opacity-50"
          >
            保存する
          </button>
          <button
            onClick={onClose}
            className="rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-200"
          >
            後で
          </button>
        </div>
      </div>
    </div>
  );
}
