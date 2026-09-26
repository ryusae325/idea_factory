import { useState } from 'react';
import type { Profile } from '../lib/types';
import { updateProfile } from '../lib/data';
import { toast } from '../lib/toast';

interface Props {
  profile: Profile;
  onSaved: (p: Profile) => void;
  onClose: () => void;
}

export default function ProfileModal({ profile, onSaved, onClose }: Props) {
  const [name, setName] = useState(profile.display_name || '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) return toast('表示名を入力してください', 'error');
    setBusy(true);
    try {
      await updateProfile(profile.id, { display_name: name.trim() });
      toast('プロフィールを保存しました');
      onSaved({ ...profile, display_name: name.trim() });
      onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-stone-900/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-[#fffdf8] p-6 shadow-2xl">
        <h3 className="text-lg font-bold text-stone-900">👋 ようこそ PlanMo へ</h3>
        <p className="mt-1 text-xs text-stone-500">
          サービス内で表示する名前を設定してください。アイデアの投稿・モデリング・購入は、どなたでも自由に行えます。
        </p>

        <label className="mt-5 block text-xs font-bold text-stone-600">表示名</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例: あさひ製作所"
          className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2.5 text-sm outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
        />

        <div className="mt-6 flex gap-2">
          <button
            onClick={save}
            disabled={busy}
            className="flex-1 rounded-xl bg-orange-600 py-2.5 text-sm font-bold text-white shadow-md shadow-orange-500/30 transition hover:bg-orange-700 disabled:opacity-50"
          >
            保存する
          </button>
          <button
            onClick={onClose}
            className="rounded-xl bg-stone-100 px-4 py-2.5 text-sm font-semibold text-stone-600 transition hover:bg-stone-200"
          >
            後で
          </button>
        </div>
      </div>
    </div>
  );
}
