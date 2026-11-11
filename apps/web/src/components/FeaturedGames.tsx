import React, { useEffect, useState } from 'react';
import { Game } from '@gametuoitho/shared-types';
import { getGames } from '../lib/api';
import GameCard from './GameCard';

const HOME_GAME_LIMIT = 9;

interface FeaturedGamesProps {
  initialGames?: Game[];
  featuredOnly?: boolean;
}

export default function FeaturedGames({ initialGames = [], featuredOnly = false }: FeaturedGamesProps) {
  const [games, setGames] = useState<Game[]>(initialGames);
  const [loading, setLoading] = useState(initialGames.length === 0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    setError(null);
    getGames({ limit: HOME_GAME_LIMIT, sort: 'newest', featured: featuredOnly ? true : undefined })
      .then((res) => {
        if (!isMounted) return;
        if (res.success && Array.isArray(res.data)) {
          setGames(featuredOnly ? res.data.filter(game => game.is_featured === true) : res.data);
        } else {
          setError(res.error?.message || 'Không thể tải danh sách game. Vui lòng tải lại trang.');
        }
      })
      .catch(() => {
        if (isMounted) setError('Không thể tải danh sách game. Vui lòng tải lại trang.');
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [featuredOnly]);

  if (loading) {
    return (
      <div className="game-list-grid">
        {[...Array(HOME_GAME_LIMIT)].map((_, i) => (
          <div
            key={i}
            className="bg-arcade-850/60 border border-arcade-800 rounded-2xl p-4 animate-pulse"
          >
            <div className="flex items-start gap-3"><div className="h-14 w-14 shrink-0 rounded-xl bg-arcade-800/80 sm:h-16 sm:w-16" /><div className="h-4 w-1/2 rounded bg-arcade-700/60" /></div>
            <div className="mt-4 space-y-3">
              <div className="h-4 bg-arcade-700/60 rounded w-3/4" />
              <div className="h-3 bg-arcade-700/40 rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return <p role="alert" className="p-6 bg-arcade-900 border border-red-500/30 rounded-2xl text-sm text-red-300">{error}</p>;
  }

  if (games.length === 0) {
    return (
      <div className="text-center py-16 bg-arcade-900 rounded-2xl border border-arcade-800">
        <p className="text-slate-400 text-sm">{featuredOnly ? 'Chưa có game ưa thích nào được chọn.' : 'Chưa có game nào trong kho lưu trữ.'}</p>
      </div>
    );
  }

  return (
    <div className="game-list-grid">
      {games.slice(0, HOME_GAME_LIMIT).map((game) => (
        <GameCard key={game.id} game={game} />
      ))}
    </div>
  );
}
