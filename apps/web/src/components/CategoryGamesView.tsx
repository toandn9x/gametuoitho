import React, { useEffect, useState } from 'react';
import { Game } from '@gametuoitho/shared-types';
import { getGames } from '../lib/api';
import GameCard from './GameCard';

interface CategoryGamesViewProps {
  categorySlug: string;
}

export default function CategoryGamesView({ categorySlug }: CategoryGamesViewProps) {
  const [actualCategorySlug, setActualCategorySlug] = useState<string>(() => {
    if (categorySlug && categorySlug !== '_shell') return categorySlug;
    if (typeof window !== 'undefined') {
      const match = window.location.pathname.match(/\/categories\/([^/?#]+)/);
      if (match && match[1] && match[1] !== '_shell') return match[1];
    }
    return categorySlug;
  });
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (typeof window !== 'undefined' && (!categorySlug || categorySlug === '_shell')) {
      const match = window.location.pathname.match(/\/categories\/([^/?#]+)/);
      if (match && match[1] && match[1] !== '_shell') {
        setActualCategorySlug(match[1]);
      }
    } else {
      setActualCategorySlug(categorySlug);
    }
  }, [categorySlug]);

  useEffect(() => {
    if (!actualCategorySlug || actualCategorySlug === '_shell') {
      setLoading(false);
      return;
    }

    let isMounted = true;
    setLoading(true);

    getGames({ categorySlug: actualCategorySlug, limit: 24 })
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
  }, [actualCategorySlug]);

  if (loading) {
    return (
      <div className="game-list-grid">
        {[...Array(4)].map((_, i) => (
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
    <div className="game-list-grid">
      {games.map((game) => (
        <GameCard key={game.id} game={game} />
      ))}
    </div>
  );
}
