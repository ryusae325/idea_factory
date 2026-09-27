import type { Idea, Profile } from '../lib/types';
import { fmtYen } from '../lib/types';

interface Props {
  idea: Idea;
  profile: Profile | null;
  onOpen: (id: number) => void;
  onAction: (
    idea: Idea,
    action: 'accept' | 'submit' | 'approve' | 'revision' | 'buy-physical' | 'buy-digital',
  ) => void;
}

const statusBadge: Record<Idea['status'], string> = {
  アイデア募集: 'bg-amber-50 text-amber-700 ring-amber-200',
  制作中: 'bg-teal-50 text-teal-700 ring-teal-200',
  提出中: 'bg-violet-50 text-violet-700 ring-violet-200',
  販売中: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
};

export default function IdeaCard({ idea, profile, onOpen, onAction }: Props) {
  const name = (p?: { username: string; display_name: string } | null) =>
    p?.display_name || p?.username || '';

  const isCreator = profile?.id === idea.creator_id;
  const isModeler = profile?.id && idea.modeler_id === profile.id;
  const isAdmin = profile?.is_admin;

  let action: React.ReactNode = null;
  if (idea.status === 'アイデア募集') {
    if (profile) {
      action = (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAction(idea, 'accept');
          }}
          className="w-full rounded-lg bg-orange-600 px-3 py-2 text-xs font-bold text-white shadow-sm shadow-orange-500/30 transition hover:bg-orange-700"
        >
          {isCreator ? '🛠️ 自分でモデリングを引き受ける' : '🛠️ モデリングを引き受ける'}
        </button>
      );
    }
  } else if (idea.status === '制作中') {
    action = isModeler || isAdmin ? (
      idea.stl_path ? (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAction(idea, 'submit');
          }}
          className="w-full rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold text-white shadow-sm shadow-violet-500/30 transition hover:bg-violet-700"
        >
          📤 3Dデータをプランナーへ提出
        </button>
      ) : (
        <p className="rounded-lg bg-stone-50 px-3 py-2 text-center text-[11px] font-medium text-teal-700 ring-1 ring-stone-200">
          ✏️ モデリング中 — 詳細画面から完成STLをアップロードすると提出できます
        </p>
      )
    ) : (
      <p className="rounded-lg bg-stone-50 px-3 py-2 text-center text-[11px] font-medium text-teal-600 ring-1 ring-stone-200">
        ✏️ {name(idea.modeler) || 'モデラー'} さんがモデリング中
      </p>
    );
  } else if (idea.status === '提出中') {
    action = isCreator || isAdmin ? (
      <div className="flex gap-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAction(idea, 'approve');
          }}
          className="flex-1 rounded-lg bg-emerald-600 px-2 py-2 text-[11px] font-bold text-white shadow-sm shadow-emerald-500/30 transition hover:bg-emerald-700"
        >
          ✅ 承認して販売開始
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAction(idea, 'revision');
          }}
          className="flex-1 rounded-lg bg-amber-500 px-2 py-2 text-[11px] font-bold text-white shadow-sm shadow-amber-500/30 transition hover:bg-amber-600"
        >
          ✏️ 修正を依頼
        </button>
      </div>
    ) : (
      <p className="rounded-lg bg-stone-50 px-3 py-2 text-center text-[11px] font-medium text-violet-600 ring-1 ring-stone-200">
        🕐 プランナーが3Dデータを確認中です
      </p>
    );
  } else if (idea.status === '販売中') {
    action = (
      <div className="flex gap-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAction(idea, 'buy-physical');
          }}
          disabled={!profile}
          className="flex-1 rounded-lg bg-orange-600 px-2 py-2 text-[11px] font-bold text-white shadow-sm shadow-orange-500/30 transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          プリント品を購入
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAction(idea, 'buy-digital');
          }}
          disabled={!profile}
          className="flex-1 rounded-lg bg-emerald-600 px-2 py-2 text-[11px] font-bold text-white shadow-sm shadow-emerald-500/30 transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          STLデータを購入
        </button>
      </div>
    );
  }

  return (
    <div
      onClick={() => onOpen(idea.id)}
      className="group flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-stone-200 bg-[#fffdf8] shadow-sm transition hover:-transtone-y-0.5 hover:shadow-lg hover:shadow-stone-900/5"
    >
      <div className="relative h-40 overflow-hidden bg-gradient-to-br from-stone-100 to-stone-200">
        {idea.images?.[0] ?? idea.image_url ? (
          <img
            src={idea.images?.[0] ?? idea.image_url}
            alt={idea.title}
            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-4xl text-stone-300">🧩</div>
        )}
        <span
          className={`absolute left-3 top-3 rounded-full px-2.5 py-1 text-[10px] font-bold ring-1 ${statusBadge[idea.status]}`}
        >
          {idea.status}
        </span>
        {idea.genre && (
          <span className="absolute right-3 top-3 rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-bold text-stone-600 ring-1 ring-stone-200">
            {idea.genre}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="line-clamp-1 text-sm font-bold text-stone-900">{idea.title}</h3>
        <p className="text-[11px] leading-relaxed text-stone-500">
          プランナー: {name(idea.creator) || '不明'} ／ モデラー:{' '}
          {name(idea.modeler) || (idea.status === 'アイデア募集' ? '募集中' : '—')}
        </p>
        <p className="text-[11px] text-stone-400">
          分配 プランナー {idea.creator_share}% / モデラー {idea.modeler_share}%
        </p>
        <div className="mt-auto flex items-baseline gap-2 pt-1">
          <span className="text-sm font-bold text-orange-600">{fmtYen(idea.price_physical)}円</span>
          <span className="text-[11px] text-stone-400">
            プリント品<span className="block">＋製造・配送費</span>
          </span>
          <span className="ml-auto text-xs font-bold text-stone-700">
            STL {fmtYen(idea.price_digital)}円
          </span>
        </div>
        {action && <div className="pt-1">{action}</div>}
      </div>
    </div>
  );
}
