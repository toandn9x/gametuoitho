import React, { useEffect, useState } from 'react';
import { Game } from '@gametuoitho/shared-types';
import { getGames } from '../lib/api';
import GameCard from './GameCard';

interface CategoryGamesViewProps {
  categorySlug: string;
}

export default function CategoryGamesView({ categorySlug }: CategoryGamesViewProps) {
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    getGames({ categorySlug, limit: 24 })
      .then((res) => {
        if (isMounted && res.success && res.data) {
          setGames(res.data);
        }
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [categorySlug]);

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
      <div className="text-center py-20 bg-arcade-900/60 rounded-3xl border border-arcade-800">
        <span className="text-5xl">📁</span>
        <h3 className="text-lg font-bold text-slate-300 mt-4">Chưa có game thuộc thể loại này</h3>
        <p className="text-xs text-slate-500 mt-1">Các tựa game mới đang được kiểm duyệt và bổ sung</p>
        <a href="/games" className="inline-block mt-4 text-xs font-bold text-neon-cyan hover:underline">
          Xem tất cả game khác →
        </a>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
      {games.map((game) => (
        <GameCard key={game.id} game={game} />
      ))}
    </div>
  );
}
