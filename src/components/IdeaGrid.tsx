import type { Idea, Profile } from '../lib/types';
import IdeaCard from '../components/IdeaCard';

type Action = 'accept' | 'submit' | 'approve' | 'revision' | 'buy-physical' | 'buy-digital';

interface Props {
  ideas: Idea[];
  profile: Profile | null;
  onOpen: (id: number) => void;
  onAction: (idea: Idea, action: Action) => void;
  emptyMessage: string;
}

export default function IdeaGrid({ ideas, profile, onOpen, onAction, emptyMessage }: Props) {
  if (ideas.length === 0) {
    return (
      <div className="grid place-items-center rounded-2xl border border-dashed border-stone-300 bg-[#fffdf8]/60 py-16 text-sm text-stone-400">
        {emptyMessage}
      </div>
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {ideas.map((i) => (
        <IdeaCard key={i.id} idea={i} profile={profile} onOpen={onOpen} onAction={onAction} />
      ))}
    </div>
  );
}
