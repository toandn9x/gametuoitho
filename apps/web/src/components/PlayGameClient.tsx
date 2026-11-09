import React, { useEffect, useState } from 'react';
import { Game, GameVersion } from '@gametuoitho/shared-types';
import { getGameDetail, recordPlay } from '../lib/api';
import EmulatorPlayer from './EmulatorPlayer';

interface PlayGameClientProps {
  slug: string;
  initialGame?: Game;
  initialVersions?: GameVersion[];
}

export default function PlayGameClient({ slug, initialGame, initialVersions }: PlayGameClientProps) {
  const effectiveSlug =
    slug && slug !== '_shell'
      ? slug
      : typeof window !== 'undefined'
        ? window.location.pathname.replace(/^\/play\/?/, '').replace(/\/$/, '')
        : slug;

  const [game, setGame] = useState<Game | undefined>(initialGame);
  const [versions, setVersions] = useState<GameVersion[]>(initialVersions || []);
  const [activeVersion, setActiveVersion] = useState<GameVersion | undefined>(
    initialVersions && initialVersions.length > 0 ? initialVersions[0] : undefined
  );
  const [loading, setLoading] = useState(!initialGame);
  const [error, setError] = useState<string | null>(null);

  // Always fetch fresh game data at runtime to ensure up-to-date version & asset URLs
  useEffect(() => {
    let isMounted = true;
    if (!game) setLoading(true);

    getGameDetail(effectiveSlug)
      .then((res) => {
        if (isMounted) {
          if (res.success && res.data) {
            setGame(res.data.game);
            setVersions(res.data.versions);
            if (res.data.versions.length > 0) {
              setActiveVersion(res.data.versions[0]);
            }
            if (typeof document !== 'undefined' && res.data.game?.name) {
              document.title = `Đang Chơi: ${res.data.game.name} --- Game Tuổi Thơ Web Player`;
            }
          } else {
            setError(res.error?.message || 'Không tìm thấy game');
          }
        }
      })
      .catch((err) => {
        if (isMounted) setError(err.message || 'Lỗi khi tải dữ liệu game');
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [effectiveSlug]);

  useEffect(() => {
    if (typeof document !== 'undefined' && game?.name) {
      document.title = `Đang Chơi: ${game.name} --- Game Tuổi Thơ Web Player`;
    }
  }, [game?.name]);

  // Record play event
  useEffect(() => {
    if (game?.id) {
      recordPlay(game.id).catch(() => {});
    }
  }, [game?.id]);

  if (loading) {
    return (
      <div className="py-24 text-center">
        <div className="inline-block w-8 h-8 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-slate-400 text-sm">Đang chuẩn bị môi trường giả lập...</p>
      </div>
    );
  }

  if (error || !game) {
    return (
      <div className="py-20 text-center bg-arcade-900 border border-arcade-800 rounded-3xl p-8 max-w-lg mx-auto">
        <span className="text-5xl">⚠️</span>
        <h2 className="text-xl font-bold text-slate-200 mt-4">Không tìm thấy tựa game để chơi</h2>
        <p className="text-slate-400 text-xs mt-2">{error || 'Game không tồn tại.'}</p>
        <a
          href="/games"
          className="inline-block mt-6 px-6 py-2.5 bg-neon-cyan text-arcade-950 font-bold text-xs rounded-xl hover:bg-neon-yellow transition-all"
        >
          ← Quay lại kho game
        </a>
      </div>
    );
  }

  const jarUrl = activeVersion?.jar_url || '';

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-4">
      {/* Breadcrumb & Back */}
      <div className="flex items-center justify-between gap-3 pb-2 sm:pb-3 border-b border-arcade-800 mb-3 sm:mb-4">
        <div className="hidden sm:flex items-center gap-2 text-xs font-mono text-slate-400 min-w-0 whitespace-nowrap">
          <a href="/" className="hover:text-neon-cyan">
            Trang chủ
          </a>
          <span>/</span>
          <a href={`/game/${game.slug}`} className="hover:text-neon-cyan truncate max-w-[16rem]" title={game.name}>
            {game.name}
          </a>
          <span>/</span>
          <span className="text-neon-cyan font-bold">Chơi game</span>
        </div>

        <a
          href={`/game/${game.slug}`}
          className="py-1 text-xs text-slate-400 hover:text-neon-cyan flex items-center gap-1 transition-colors whitespace-nowrap flex-shrink-0"
        >
          <span>← Quay lại chi tiết game</span>
        </a>
      </div>

      {/* Emulator Player Component */}
      <EmulatorPlayer
        game={game}
        gameId={game.id}
        gameName={game.name}
        activeVersion={activeVersion}
        versions={versions}
        jarUrl={jarUrl}
      />
    </div>
  );
}
