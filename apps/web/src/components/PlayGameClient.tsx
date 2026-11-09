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
  const [game, setGame] = useState<Game | undefined>(initialGame);
  const [versions, setVersions] = useState<GameVersion[]>(initialVersions || []);
  const [activeVersion, setActiveVersion] = useState<GameVersion | undefined>(
    initialVersions && initialVersions.length > 0 ? initialVersions[0] : undefined
  );
  const [loading, setLoading] = useState(!initialGame);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!initialGame) {
      let isMounted = true;
      getGameDetail(slug)
        .then((res) => {
          if (isMounted) {
            if (res.success && res.data) {
              setGame(res.data.game);
              setVersions(res.data.versions);
              if (res.data.versions.length > 0) {
                setActiveVersion(res.data.versions[0]);
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
    }
  }, [slug, initialGame]);

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
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Breadcrumb & Back */}
      <div className="flex items-center justify-between pb-4 border-b border-arcade-800 mb-6">
        <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
          <a href="/" className="hover:text-neon-cyan">
            Trang chủ
          </a>
          <span>/</span>
          <a href={`/game/${game.slug}`} className="hover:text-neon-cyan">
            {game.name}
          </a>
          <span>/</span>
          <span className="text-neon-cyan font-bold">Chơi game</span>
        </div>

        <a
          href={`/game/${game.slug}`}
          className="text-xs text-slate-400 hover:text-neon-cyan flex items-center gap-1 transition-colors"
        >
          <span>← Quay lại chi tiết game</span>
        </a>
      </div>

      {/* Emulator Player Component */}
      <EmulatorPlayer
        game={game}
        activeVersion={activeVersion}
        versions={versions}
        jarUrl={jarUrl}
      />
    </div>
  );
}
