import React, { useState } from 'react';
import { Game } from '@gametuoitho/shared-types';
import { addGameToLibrary } from '../lib/api';
import GameIcon from './GameIcon';

interface GameCardProps {
  game: Game;
}

type GameCardDisplay = Pick<Game, 'name'> & Partial<Pick<Game,
  'cover_url' | 'developer' | 'publisher' | 'category_name' | 'release_year' | 'description'>>;

interface GameCardViewProps {
  game: GameCardDisplay;
  detailHref?: string;
  playHref?: string;
  metadata?: React.ReactNode;
  action: React.ReactNode;
}

export function GameCardView({ game, detailHref, playHref, metadata, action }: GameCardViewProps) {
  const icon = <GameIcon src={game.cover_url} name={game.name} />;
  const title = <h3 className="line-clamp-2 break-words text-sm font-bold leading-snug text-slate-100 transition-colors group-hover:text-neon-cyan sm:text-base">{game.name}</h3>;

  return (
    <article className="game-card group flex h-full min-w-0 flex-col rounded-2xl border border-arcade-700/70 bg-arcade-800/50 p-4 transition-colors hover:border-neon-cyan/50 hover:bg-arcade-800">
      {metadata && <div className="mb-3 flex flex-wrap items-center justify-between gap-1">{metadata}</div>}
      <div className="flex min-w-0 items-start gap-3">
        {detailHref ? <a href={detailHref} aria-label={`Xem ${game.name}`} className="shrink-0 rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-neon-cyan">{icon}</a> : icon}
        <div className="min-w-0 flex-1">
          {detailHref ? <a href={detailHref} className="block">{title}</a> : title}
          {(game.developer || game.publisher) && (
            <p className="mt-1 truncate text-xs text-slate-400">{game.developer || game.publisher}</p>
          )}
          <div className="mt-1.5 flex min-w-0 items-center gap-2 text-[11px]">
            {game.category_name && <span className="truncate text-neon-cyan/80">{game.category_name}</span>}
            {game.release_year && <span className="shrink-0 font-mono text-slate-500">{game.release_year}</span>}
          </div>
        </div>
      </div>
      {game.description && <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-slate-400">{game.description}</p>}
      <div className="mt-auto flex items-center gap-2 pt-4">
        {playHref ? <a href={playHref} className="flex-1 rounded-lg bg-neon-cyan px-3 py-2 text-center text-xs font-bold text-arcade-950 transition-colors hover:bg-neon-yellow">▶ Chơi ngay</a>
          : <span className="flex-1 rounded-lg bg-arcade-900 px-3 py-2 text-center text-xs text-slate-500">Không khả dụng</span>}
        {action}
      </div>
    </article>
  );
}

export default function GameCard({ game }: GameCardProps) {
  const [added, setAdded] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleAddToLibrary = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setLoading(true);
    try {
      const res = await addGameToLibrary(game.id);
      if (res.success) {
        setAdded(true);
      } else {
        alert(res.error?.message || 'Vui lòng đăng nhập để lưu game vào thư viện');
      }
    } catch {
      alert('Vui lòng đăng nhập để lưu game');
    } finally {
      setLoading(false);
    }
  };

  return (
    <GameCardView game={game} detailHref={`/game/${game.slug}`} playHref={`/play/${game.slug}`} action={
      <button
          onClick={handleAddToLibrary}
          disabled={added || loading}
          title={added ? 'Đã có trong thư viện' : 'Lưu vào thư viện cá nhân'}
          className={`shrink-0 rounded-lg border px-3 py-2 text-xs transition-colors disabled:cursor-default ${added
            ? 'border-neon-green/40 bg-neon-green/10 text-neon-green'
            : 'border-arcade-600 text-slate-300 hover:border-neon-cyan hover:text-neon-cyan'}`}
        >
          {loading ? 'Đang lưu...' : added ? '✓ Đã lưu' : '+ Thư viện'}
      </button>
    } />
  );
}
