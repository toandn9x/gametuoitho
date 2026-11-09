import React, { useEffect, useState } from 'react';
import { Game, GameVersion } from '@gametuoitho/shared-types';
import { getGameDetail } from '../lib/api';

interface GameDetailClientProps {
  slug: string;
  initialData?: {
    game: Game;
    versions: GameVersion[];
    screenshots: { id: string; url: string; sort_order: number }[];
  };
}

export default function GameDetailClient({ slug, initialData }: GameDetailClientProps) {
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!initialData) {
      let isMounted = true;
      getGameDetail(slug)
        .then((res) => {
          if (isMounted) {
            if (res.success && res.data) {
              setData(res.data);
            } else {
              setError(res.error?.message || 'Không tìm thấy thông tin game');
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
  }, [slug, initialData]);

  if (loading) {
    return (
      <div className="py-20 text-center">
        <div className="inline-block w-8 h-8 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-slate-400 text-sm">Đang tải thông tin game...</p>
      </div>
    );
  }

  if (error || !data || !data.game) {
    return (
      <div className="py-20 text-center bg-arcade-900 border border-arcade-800 rounded-3xl p-8 max-w-lg mx-auto">
        <span className="text-5xl">⚠️</span>
        <h2 className="text-xl font-bold text-slate-200 mt-4">Không tìm thấy tựa game</h2>
        <p className="text-slate-400 text-xs mt-2">{error || 'Game không tồn tại hoặc đã bị ẩn.'}</p>
        <a
          href="/games"
          className="inline-block mt-6 px-6 py-2.5 bg-neon-cyan text-arcade-950 font-bold text-xs rounded-xl hover:bg-neon-yellow transition-all"
        >
          ← Quay lại kho game
        </a>
      </div>
    );
  }

  const { game, versions } = data;
  const activeVersion = versions && versions.length > 0 ? versions[0] : null;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-slate-400 mb-6 font-mono">
        <a href="/" className="hover:text-neon-cyan">
          Trang chủ
        </a>
        <span>/</span>
        <a href="/games" className="hover:text-neon-cyan">
          Kho game
        </a>
        <span>/</span>
        {game.category_slug && (
          <>
            <a href={`/categories/${game.category_slug}`} className="hover:text-neon-cyan">
              {game.category_name}
            </a>
            <span>/</span>
          </>
        )}
        <span className="text-neon-cyan font-bold">{game.name}</span>
      </div>

      {/* Main Detail Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
        {/* Left Column: Cover & Action CTAs */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-arcade-900 border border-arcade-800 rounded-3xl p-6 shadow-xl">
            {/* Cover */}
            <div className="aspect-[4/3] rounded-2xl overflow-hidden bg-arcade-950 border border-arcade-700/50 shadow-inner mb-6 relative">
              {game.cover_url ? (
                <img src={game.cover_url} alt={game.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-slate-500">
                  <span className="text-6xl mb-2">🕹️</span>
                  <span className="text-xs font-mono text-neon-cyan/70">J2ME Retro</span>
                </div>
              )}
              {game.category_name && (
                <span className="absolute top-3 left-3 bg-arcade-950/90 text-neon-yellow border border-neon-yellow/40 text-xs font-bold px-2.5 py-1 rounded-md backdrop-blur-md">
                  {game.category_name}
                </span>
              )}
            </div>

            {/* Play Button CTA */}
            <a
              href={`/play/${game.slug}`}
              className="block w-full py-4 text-center bg-gradient-to-r from-neon-cyan via-neon-yellow to-neon-pink text-arcade-950 font-black text-base rounded-xl hover:scale-[1.02] transition-transform shadow-neon-cyan tracking-wider uppercase"
            >
              ▶ CHƠI TRÊN WEB NGAY
            </a>

            {/* Download JAR */}
            {activeVersion?.jar_url && (
              <a
                href={activeVersion.jar_url}
                download={`${game.slug}.jar`}
                className="block w-full text-center py-2.5 mt-3 bg-arcade-800 hover:bg-arcade-700 border border-arcade-700 hover:border-slate-400 rounded-xl text-xs font-semibold text-slate-300 transition-colors"
              >
                📥 Tải File JAR ({((activeVersion.file_size || 0) / 1024).toFixed(0)} KB)
              </a>
            )}

            {/* Metadata table */}
            <div className="mt-6 pt-6 border-t border-arcade-800 space-y-3 text-xs">
              <div className="flex justify-between py-1 border-b border-arcade-800/50">
                <span className="text-slate-400">Nhà phát triển:</span>
                <span className="font-bold text-slate-200">{game.developer || 'Đang cập nhật'}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-arcade-800/50">
                <span className="text-slate-400">Nhà phát hành:</span>
                <span className="font-bold text-slate-200">{game.publisher || 'Đang cập nhật'}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-arcade-800/50">
                <span className="text-slate-400">Năm phát hành:</span>
                <span className="font-mono font-bold text-neon-cyan">{game.release_year || 'N/A'}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-arcade-800/50">
                <span className="text-slate-400">Nền tảng hỗ trợ:</span>
                <span className="font-mono text-neon-green">Web (CheerpJ) / Android APK</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-400">Phân giải khuyến nghị:</span>
                <span className="font-mono text-slate-200">240x320 / Tự co giãn</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Info, Versions */}
        <div className="lg:col-span-8 space-y-8">
          <div>
            <h1 className="text-3xl sm:text-4xl font-black text-slate-100">{game.name}</h1>
            <div className="flex flex-wrap items-center gap-3 mt-3">
              <span className="px-3 py-1 bg-neon-green/20 text-neon-green border border-neon-green/40 text-xs font-mono font-bold rounded-full">
                ✓ Đã Kiểm Thử Tương Thích
              </span>
              <span className="px-3 py-1 bg-arcade-800 text-slate-300 border border-arcade-700 text-xs rounded-full font-mono">
                MIDP 2.0 / CLDC 1.1
              </span>
            </div>
          </div>

          <div className="bg-arcade-900 border border-arcade-800 rounded-2xl p-6">
            <h2 className="text-sm font-bold uppercase tracking-wider text-neon-cyan mb-3">
              Giới Thiệu Game
            </h2>
            <p className="text-slate-300 text-sm leading-relaxed whitespace-pre-line">
              {game.description || 'Chưa có mô tả chi tiết cho tựa game này.'}
            </p>
          </div>

          <div className="bg-arcade-900 border border-arcade-800 rounded-2xl p-6">
            <h2 className="text-sm font-bold uppercase tracking-wider text-neon-yellow mb-3">
              Phiên Bản File JAR
            </h2>
            {versions && versions.length > 0 ? (
              <div className="space-y-2">
                {versions.map((ver) => (
                  <div
                    key={ver.id}
                    className="flex items-center justify-between p-3 bg-arcade-800/60 border border-arcade-700 rounded-xl text-xs"
                  >
                    <div>
                      <span className="font-bold text-slate-200">{ver.version_name}</span>
                      <span className="block text-[10px] text-slate-500 font-mono mt-0.5">
                        Dung lượng: {((ver.file_size || 0) / 1024).toFixed(0)} KB
                      </span>
                    </div>
                    <a
                      href={`/play/${game.slug}`}
                      className="px-3 py-1.5 bg-neon-cyan text-arcade-950 font-bold rounded hover:bg-neon-yellow transition-all"
                    >
                      Chơi bản này
                    </a>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-slate-400 text-xs">Chưa có phiên bản tải về.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
