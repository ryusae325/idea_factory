import type { Idea, Profile } from '../lib/types';
import { fmtYen } from '../lib/types';
import { reportIdea } from '../lib/data';
import { toast } from '../lib/toast';

interface Props {
  idea: Idea;
  profile: Profile | null;
  onOpen: (id: number) => void;
  onOpenStudio?: (id: number) => void;
  onAction: (
    idea: Idea,
    action: 'submit' | 'approve' | 'revision' | 'withdraw' | 'buy-physical' | 'buy-digital',
  ) => void;
  showFav?: boolean;
  fav?: boolean;
  onToggleFav?: (idea: Idea) => void;
}

const statusBadge: Record<Idea['status'], string> = {
  アイデア募集: 'bg-amber-100/80 text-amber-800',
  制作中: 'bg-sky-100 text-sky-700',
  提出中: 'bg-violet-100 text-violet-700',
  販売中: 'bg-emerald-100 text-emerald-700',
};

export default function IdeaCard({ idea, profile, onOpen, onOpenStudio, onAction, showFav, fav, onToggleFav }: Props) {
  const name = (p?: { username: string; display_name: string } | null) =>
    p?.display_name || p?.username || '';

  const isCreator = profile?.id === idea.creator_id;
  const isModeler = profile?.id && idea.modeler_id === profile.id;
  const isAdmin = profile?.is_admin;

  let action: React.ReactNode = null;
  if (idea.status === 'アイデア募集') {
    if (profile) {
      action = isCreator ? (
        <p className="rounded-lg bg-sky-50 px-3 py-2 text-center text-[11px] font-medium text-sky-700 ring-1 ring-sky-200">
          🙋 立候補を待っています — 詳細画面で応募者を確認して指名
        </p>
      ) : (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onOpen(idea.id);
          }}
          className="w-full rounded-lg bg-orange-600 px-3 py-2.5 text-xs font-bold text-white shadow-sm shadow-orange-500/30 transition hover:bg-orange-700"
        >
          🙋 立候補する（詳細から応募）
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
          className="w-full rounded-lg bg-violet-600 px-3 py-2.5 text-xs font-bold text-white shadow-sm shadow-violet-500/30 transition hover:bg-violet-700"
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
          className="flex-1 rounded-lg bg-emerald-600 px-2 py-2.5 text-[11px] font-bold text-white shadow-sm shadow-emerald-500/30 transition hover:bg-emerald-700"
        >
          ✅ 承認して販売開始
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAction(idea, 'revision');
          }}
          className="flex-1 rounded-lg bg-amber-500 px-2 py-2.5 text-[11px] font-bold text-white shadow-sm shadow-amber-500/30 transition hover:bg-amber-600"
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
          className="flex-1 rounded-lg bg-orange-600 px-2 py-2.5 text-[11px] font-bold text-white shadow-sm shadow-orange-500/30 transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          プリント品を購入
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAction(idea, 'buy-digital');
          }}
          disabled={!profile}
          className="flex-1 rounded-lg bg-emerald-600 px-2 py-2.5 text-[11px] font-bold text-white shadow-sm shadow-emerald-500/30 transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          STLデータを購入
        </button>
      </div>
    );
  }

  return (
    <div
      onClick={() => onOpen(idea.id)}
      className="tap-card group flex flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-stone-200/70 transition hover:shadow-md hover:shadow-slate-900/10"
    >
      <div className="relative h-40 overflow-hidden bg-stone-100">
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
          className={`absolute left-3 top-3 rounded-full px-2.5 py-1 text-[10px] font-bold backdrop-blur ${statusBadge[idea.status]}`}
        >
          {idea.status}
        </span>
        {idea.genre && (
          <span
            className={`absolute top-3 rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-semibold text-stone-600 backdrop-blur ${
              showFav ? 'right-12' : 'right-3'
            }`}
          >
            {idea.genre}
          </span>
        )}
        {showFav && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleFav?.(idea);
            }}
            title={fav ? 'ほしいものリストから削除' : 'ほしいものリストに追加'}
            className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-full bg-white/90 text-sm shadow-sm ring-1 ring-stone-200 transition hover:scale-110"
          >
            {fav ? '❤️' : '🤍'}
          </button>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2.5 p-4">
        <div>
          <h3 className="line-clamp-1 text-[15px] font-bold leading-snug text-stone-900">{idea.title}</h3>
          <p className="mt-1 line-clamp-1 text-[11px] text-stone-400">
            {name(idea.creator) || '不明'}
            {idea.modeler ? ` × ${name(idea.modeler)}` : idea.status === 'アイデア募集' ? ' × モデラー募集中' : ''}
          </p>
        </div>

        <div className="mt-auto grid grid-cols-2 gap-2 rounded-xl bg-stone-50 p-2.5">
          <div>
            <p className="text-[10px] font-semibold text-stone-400">プリント品</p>
            <p className="text-sm font-bold text-[#0f2a4a]">{fmtYen(idea.price_physical)}円</p>
            <p className="text-[9px] text-stone-400">＋製造・配送費</p>
          </div>
          <div className="border-l border-stone-200 pl-2.5">
            <p className="text-[10px] font-semibold text-stone-400">STLデータ</p>
            <p className="text-sm font-bold text-[#0f2a4a]">{fmtYen(idea.price_digital)}円</p>
            <p className="text-[9px] text-stone-400">分配 {idea.creator_share}%／{idea.modeler_share}%</p>
          </div>
        </div>
        {action && <div className="pt-0.5">{action}</div>}
        {idea.status === '制作中' && (isModeler || isAdmin) && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenStudio?.(idea.id);
            }}
            className="w-full rounded-lg border border-teal-300 bg-teal-50 px-3 py-2 text-[11px] font-bold text-teal-800 transition hover:bg-teal-100"
          >
            🧊 3Dスタジオで開く
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            reportIdea(idea.id, idea.title).catch((err: Error) => toast(err.message, 'error'));
          }}
          className="mt-0.5 w-full rounded-lg border border-rose-200 bg-rose-50/60 px-3 py-1.5 text-[10px] font-semibold text-rose-600 transition hover:bg-rose-100"
        >
          📢 これ観たことある（通報）
        </button>
      </div>
    </div>
  );
}
