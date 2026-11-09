import React, { useState } from 'react';
import { Game } from '@gametuoitho/shared-types';
import { addGameToLibrary } from '../lib/api';

interface GameCardProps {
  game: Game;
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
    <div className="group relative bg-arcade-800/80 border border-arcade-700/80 rounded-xl overflow-hidden hover:border-neon-cyan/70 transition-all duration-300 hover:shadow-neon-cyan flex flex-col h-full">
      {/* Cover image */}
      <a href={`/game/${game.slug}`} className="block relative aspect-[4/3] bg-arcade-950 overflow-hidden">
        {game.cover_url ? (
          <img
            src={game.cover_url}
            alt={game.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-arcade-850 to-arcade-950 text-slate-500">
            <span className="text-4xl mb-2">🎮</span>
            <span className="text-[10px] font-mono uppercase text-neon-cyan/60 tracking-wider">J2ME Classic</span>
          </div>
        )}

        {/* Category tag */}
        {game.category_name && (
          <span className="absolute top-2 left-2 bg-arcade-900/90 text-neon-yellow border border-neon-yellow/30 text-[10px] font-semibold px-2 py-0.5 rounded backdrop-blur-sm">
            {game.category_name}
          </span>
        )}

        {/* Release year */}
        {game.release_year && (
          <span className="absolute top-2 right-2 bg-arcade-900/90 text-slate-300 border border-slate-700 text-[10px] font-mono px-1.5 py-0.5 rounded">
            {game.release_year}
          </span>
        )}
      </a>

      {/* Content */}
      <div className="p-4 flex-1 flex flex-col justify-between">
        <div>
          <a href={`/game/${game.slug}`} className="block">
            <h3 className="font-bold text-slate-100 group-hover:text-neon-cyan transition-colors line-clamp-1 text-base">
              {game.name}
            </h3>
          </a>
          <p className="text-xs text-slate-400 mt-1">
            {game.developer || 'Nokia / J2ME'}
          </p>
          {game.description && (
            <p className="text-xs text-slate-400/80 mt-2 line-clamp-2 leading-relaxed">
              {game.description}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="mt-4 pt-3 border-t border-arcade-700/50 flex items-center gap-2">
          <a
            href={`/play/${game.slug}`}
            className="flex-1 text-center py-2 px-3 bg-neon-cyan text-arcade-950 font-bold text-xs rounded hover:bg-neon-yellow transition-all shadow-sm"
          >
            ▶ Chơi ngay
          </a>
          <button
            onClick={handleAddToLibrary}
            disabled={added || loading}
            title={added ? 'Đã có trong thư viện' : 'Lưu vào thư viện cá nhân'}
            className={`px-3 py-2 border rounded text-xs transition-colors ${
              added
                ? 'bg-neon-green/20 border-neon-green text-neon-green'
                : 'border-arcade-600 hover:border-neon-cyan text-slate-300 hover:text-neon-cyan bg-arcade-700/50'
            }`}
          >
            {added ? '✓ Đã lưu' : '+ Thư viện'}
          </button>
        </div>
      </div>
    </div>
  );
}
