import type { ReactNode } from 'react';
import type { Idea, Profile } from '../lib/types';
import IdeaCard from '../components/IdeaCard';

type Action = 'submit' | 'approve' | 'revision' | 'withdraw' | 'buy-physical' | 'buy-digital';

interface Props {
  ideas: Idea[];
  profile: Profile | null;
  onOpen: (id: number) => void;
  onAction: (idea: Idea, action: Action) => void;
  emptyMessage: string;
  emptyAction?: ReactNode;
  demo?: ReactNode;
  showFav?: boolean;
  favSet?: Set<number>;
  onToggleFav?: (idea: Idea) => void;
}

export default function IdeaGrid({
  ideas,
  profile,
  onOpen,
  onAction,
  emptyMessage,
  emptyAction,
  demo,
  showFav,
  favSet,
  onToggleFav,
}: Props) {
  if (ideas.length === 0) {
    return (
      <div className="space-y-5">
        {demo && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {demo}
          </div>
        )}
        <div className="grid place-items-center gap-2 rounded-2xl bg-white py-14 text-center shadow-sm ring-1 ring-slate-200/70">
          <span className="text-3xl opacity-40">{demo ? '✨' : '🗂️'}</span>
          <p className="text-sm text-slate-400">{emptyMessage}</p>
          {demo && <p className="text-[11px] text-slate-400">上は実際の利用イメージ（サンプル）です</p>}
          {emptyAction && <div className="pt-1">{emptyAction}</div>}
        </div>
      </div>
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {ideas.map((i) => (
        <IdeaCard
          key={i.id}
          idea={i}
          profile={profile}
          onOpen={onOpen}
          onAction={onAction}
          showFav={showFav}
          fav={favSet?.has(i.id)}
          onToggleFav={onToggleFav}
        />
      ))}
    </div>
  );
}
