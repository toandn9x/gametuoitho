import React, { useEffect, useState } from 'react';
import { Game } from '@gametuoitho/shared-types';
import { getGames } from '../lib/api';
import GameCard from './GameCard';

interface FeaturedGamesProps {
  initialGames?: Game[];
}

export default function FeaturedGames({ initialGames = [] }: FeaturedGamesProps) {
  const [games, setGames] = useState<Game[]>(initialGames);
  const [loading, setLoading] = useState(initialGames.length === 0);

  useEffect(() => {
    let isMounted = true;
    getGames({ limit: 8, sort: 'newest' })
      .then((res) => {
        if (isMounted && res.success && res.data) {
          setGames(res.data);
        }
      })
      .catch((err) => {
        console.error('Failed to load featured games:', err);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className="bg-arcade-850/60 border border-arcade-800 rounded-xl overflow-hidden animate-pulse h-72"
          >
            <div className="aspect-[4/3] bg-arcade-800/80" />
            <div className="p-4 space-y-3">
              <div className="h-4 bg-arcade-700/60 rounded w-3/4" />
              <div className="h-3 bg-arcade-700/40 rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (games.length === 0) {
    return (
      <div className="text-center py-16 bg-arcade-900 rounded-2xl border border-arcade-800">
        <p className="text-slate-400 text-sm">Chưa có game nào trong kho lưu trữ.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
      {games.slice(0, 8).map((game) => (
        <GameCard key={game.id} game={game} />
      ))}
    </div>
  );
}
