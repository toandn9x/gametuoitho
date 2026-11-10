import React, { useEffect, useState } from 'react';
import { Game, GameVersion } from '@gametuoitho/shared-types';
import { getGameDetail } from '../lib/api';
import GameIcon from './GameIcon';

interface GameDetailClientProps {
  slug: string;
  initialData?: {
    game: Game;
    versions: GameVersion[];
    screenshots: { id: string; url: string; sort_order: number }[];
  };
}

export default function GameDetailClient({ slug, initialData }: GameDetailClientProps) {
  const effectiveSlug =
    slug && slug !== '_shell'
      ? slug
      : typeof window !== 'undefined'
        ? window.location.pathname.replace(/^\/game\/?/, '').replace(/\/$/, '')
        : slug;

  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    if (!data) setLoading(true);

    getGameDetail(effectiveSlug)
      .then((res) => {
        if (isMounted) {
          if (res.success && res.data) {
            setData(res.data);
            if (typeof document !== 'undefined' && res.data.game?.name) {
              document.title = `${res.data.game.name} --- Chơi Game Java ME Online | Game Tuổi Thơ`;
            }
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
  }, [effectiveSlug]);

  useEffect(() => {
    if (typeof document !== 'undefined' && data?.game?.name) {
      document.title = `${data.game.name} --- Chơi Game Java ME Online | Game Tuổi Thơ`;
    }
  }, [data?.game?.name]);

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
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <nav aria-label="Đường dẫn" className="mb-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
        <a href="/" className="hover:text-neon-cyan">Trang chủ</a>
        <span aria-hidden="true">/</span>
        <a href="/games" className="hover:text-neon-cyan">Kho game</a>
        {game.category_slug && (
          <>
            <span aria-hidden="true">/</span>
            <a href={`/categories/${game.category_slug}`} className="hover:text-neon-cyan">{game.category_name}</a>
          </>
        )}
        <span aria-hidden="true">/</span>
        <span aria-current="page" className="min-w-0 break-words text-slate-200">{game.name}</span>
      </nav>

      <header className="rounded-2xl border border-arcade-700/70 bg-arcade-800/40 p-4 sm:p-6">
        <div className="flex min-w-0 items-start gap-4 sm:items-center sm:gap-5">
          <GameIcon src={game.cover_url} name={game.name} size="detail" loading="eager" />
          <div className="min-w-0 flex-1">
            <h1 className="break-words text-xl font-black leading-tight text-slate-100 sm:text-3xl">{game.name}</h1>
            {(game.developer || game.publisher) && (
              <p className="mt-2 break-words text-sm text-slate-400">{game.developer || game.publisher}</p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              {game.category_name && (
                <span className="rounded-full border border-neon-cyan/20 bg-neon-cyan/10 px-2.5 py-1 text-neon-cyan">
                  {game.category_name}
                </span>
              )}
              {game.release_year && <span className="font-mono text-slate-400">{game.release_year}</span>}
            </div>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-arcade-700/60 pt-4">
          <a
            href={`/play/${game.slug}`}
            className="rounded-xl bg-neon-cyan px-5 py-3 text-center text-sm font-bold text-arcade-950 transition-colors hover:bg-neon-yellow"
          >
            ▶ Chơi ngay
          </a>
          {activeVersion?.jar_url && (
            <a
              href={activeVersion.jar_url}
              download={`${game.slug}.jar`}
              className="rounded-xl border border-arcade-600 bg-arcade-900 px-4 py-3 text-center text-xs font-semibold text-slate-200 transition-colors hover:border-neon-cyan hover:text-neon-cyan"
            >
              ↓ Tải JAR · {((activeVersion.file_size || 0) / 1024).toFixed(0)} KB
            </a>
          )}
        </div>
      </header>

      <div className="mt-6 grid min-w-0 grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-6">
          <section className="rounded-2xl border border-arcade-800 bg-arcade-900/60 p-5 sm:p-6">
            <h2 className="mb-3 text-base font-bold text-slate-100">Giới thiệu game</h2>
            <p className="whitespace-pre-line break-words text-sm leading-7 text-slate-300">
              {game.description || 'Chưa có mô tả chi tiết cho tựa game này.'}
            </p>
          </section>

          {data.screenshots?.length > 0 && (
            <section className="rounded-2xl border border-arcade-800 bg-arcade-900/60 p-5 sm:p-6">
              <h2 className="mb-4 text-base font-bold text-slate-100">Hình ảnh trong game</h2>
              <div className="flex gap-3 overflow-x-auto pb-2">
                {data.screenshots.map((screenshot, index) => (
                  <a key={screenshot.id} href={screenshot.url} target="_blank" rel="noopener noreferrer" className="flex shrink-0 items-center justify-center rounded-xl border border-arcade-700 bg-arcade-950 p-2">
                    <img src={screenshot.url} alt={`${game.name} — ảnh ${index + 1}`} loading="lazy" className="h-auto max-h-64 w-auto max-w-[16rem] object-contain" />
                  </a>
                ))}
              </div>
            </section>
          )}

          <section className="rounded-2xl border border-arcade-800 bg-arcade-900/60 p-5 sm:p-6">
            <h2 className="mb-4 text-base font-bold text-slate-100">Phiên bản game</h2>
            {versions?.length > 0 ? (
              <div className="space-y-3">
                {versions.map((version) => (
                  <div key={version.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-arcade-700/60 bg-arcade-800/50 p-3 sm:p-4">
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm font-semibold text-slate-200">{version.version_name}</p>
                      <p className="mt-1 text-xs text-slate-400">{((version.file_size || 0) / 1024).toFixed(0)} KB · JAR</p>
                    </div>
                    <a href={`/play/${game.slug}`} className="shrink-0 rounded-lg border border-neon-cyan/30 bg-neon-cyan/10 px-3 py-2 text-xs font-bold text-neon-cyan transition-colors hover:bg-neon-cyan hover:text-arcade-950">
                      Chơi bản này →
                    </a>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400">Chưa có phiên bản tải về.</p>
            )}
          </section>
        </div>

        <aside className="min-w-0 rounded-2xl border border-arcade-800 bg-arcade-900/60 p-5">
          <h2 className="mb-4 text-sm font-bold text-slate-100">Thông tin game</h2>
          <dl className="space-y-3 text-xs">
            {[
              ['Thể loại', game.category_name],
              ['Nhà phát triển', game.developer],
              ['Nhà phát hành', game.publisher],
              ['Năm phát hành', game.release_year],
            ].map(([label, value]) => value ? (
              <div key={label} className="grid grid-cols-[6rem_minmax(0,1fr)] gap-3 border-b border-arcade-800 pb-3">
                <dt className="text-slate-400">{label}</dt>
                <dd className="min-w-0 break-words text-right font-medium text-slate-200">{value}</dd>
              </div>
            ) : null)}
            <div className="flex justify-between gap-3">
              <dt className="text-slate-400">Số phiên bản</dt>
              <dd className="font-mono text-neon-cyan">{versions?.length || 0}</dd>
            </div>
          </dl>
        </aside>
      </div>
    </div>
  );
}
