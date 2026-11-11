import React, { useEffect, useState } from 'react';
import type { FavoriteGameItem } from '@gametuoitho/shared-types';
import { AUTH_CHANGED_EVENT, FAVORITES_UPDATED_EVENT, getAuthToken, getFavorites, handleUnauthorized, setFavorite } from '../lib/api';
import GameIcon from './GameIcon';

type FavoritesState = {
  status: 'guest' | 'loading' | 'ready' | 'error';
  items: FavoriteGameItem[];
  error?: string;
};

/** The signed-in user's starred games (/me/favorites). */
export default function FavoriteGames() {
  const [state, setState] = useState<FavoritesState>({ status: 'loading', items: [] });
  const [retry, setRetry] = useState(0);
  const [removing, setRemoving] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let generation = 0;
    let controller: AbortController | undefined;
    let previousToken: string | null | undefined;

    const refresh = async () => {
      const request = ++generation;
      controller?.abort();
      controller = new AbortController();
      const token = getAuthToken();
      if (!token) {
        previousToken = null;
        setState({ status: 'guest', items: [] });
        handleUnauthorized(false);
        return;
      }
      const changedAccount = token !== previousToken;
      previousToken = token;
      setState(current => changedAccount ? { status: 'loading', items: [] } : { ...current, status: 'loading' });
      const result = await getFavorites(controller.signal);
      // An old request must never show the previous account's list.
      if (!active || request !== generation || getAuthToken() !== token) return;
      if (result.success && result.data) setState({ status: 'ready', items: result.data });
      else setState({ status: 'error', items: [], error: result.error?.message || 'Không thể tải game yêu thích.' });
    };
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    const storageChanged = (event: StorageEvent) => {
      if (event.key === 'gametuoitho_token' || event.key === null) void refresh();
    };

    void refresh();
    window.addEventListener(AUTH_CHANGED_EVENT, refresh);
    window.addEventListener(FAVORITES_UPDATED_EVENT, refresh);
    window.addEventListener('storage', storageChanged);
    window.addEventListener('pageshow', refresh);
    document.addEventListener('visibilitychange', visible);
    return () => {
      active = false;
      generation++;
      controller?.abort();
      window.removeEventListener(AUTH_CHANGED_EVENT, refresh);
      window.removeEventListener(FAVORITES_UPDATED_EVENT, refresh);
      window.removeEventListener('storage', storageChanged);
      window.removeEventListener('pageshow', refresh);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [retry]);

  const remove = async (item: FavoriteGameItem) => {
    setRemoving(item.game_id);
    setNotice(null);
    const result = await setFavorite(item.game_id, false);
    setRemoving(null);
    if (result.success) {
      setState(current => ({ ...current, items: current.items.filter(other => other.game_id !== item.game_id) }));
    } else {
      setNotice(result.error?.message || `Không thể bỏ "${item.game_name}" khỏi yêu thích.`);
    }
  };

  if (state.status === 'loading' && state.items.length === 0) {
    return (
      <div role="status" aria-label="Đang tải game yêu thích" className="game-list-grid animate-pulse">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="flex items-center gap-3 rounded-2xl border border-arcade-700 bg-arcade-800 p-3 sm:p-4">
            <div className="h-14 w-14 sm:h-16 sm:w-16 shrink-0 rounded-xl bg-arcade-700" />
            <div className="flex-1 space-y-3"><div className="h-4 w-3/4 rounded bg-arcade-700" /><div className="h-3 w-1/2 rounded bg-arcade-700" /></div>
          </div>
        ))}
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div role="alert" className="rounded-2xl border border-arcade-700 bg-arcade-900 p-6 text-center">
        <p className="text-sm text-slate-300">{state.error}</p>
        <button type="button" onClick={() => setRetry(value => value + 1)} className="mt-3 px-4 py-2 text-sm font-bold text-neon-cyan hover:underline">Thử lại</button>
      </div>
    );
  }

  if (state.items.length === 0) {
    const guest = state.status === 'guest';
    return (
      <div className="text-center py-16 sm:py-20 bg-arcade-900 rounded-3xl border border-arcade-800 px-5">
        <span className="text-5xl" aria-hidden="true">⭐</span>
        <h2 className="text-lg font-bold text-slate-200 mt-4">{guest ? 'Đăng nhập để xem game yêu thích' : 'Chưa có game yêu thích nào'}</h2>
        <p className="text-xs text-slate-400 mt-1">Bấm nút ☆ Yêu thích ở trang giới thiệu game để lưu vào danh sách này.</p>
        <a href={guest ? '/login?next=%2Fme%2Ffavorites' : '/games'} className="inline-block mt-4 text-xs font-bold text-neon-cyan hover:underline">
          {guest ? 'Đăng nhập' : 'Khám phá Kho Game →'}
        </a>
      </div>
    );
  }

  return (
    <section aria-label="Game yêu thích" aria-busy={state.status === 'loading'} data-favorite-games>
      {notice && <p role="alert" className="mb-4 rounded-xl border border-neon-pink/40 bg-neon-pink/10 px-4 py-3 text-sm text-slate-200">{notice}</p>}
      <div className="game-list-grid">
        {state.items.map(item => (
          <article key={item.game_id} data-favorite-game className="flex min-w-0 items-center gap-3 rounded-2xl border border-arcade-700 bg-arcade-800/80 p-3 sm:p-4">
            <a href={`/game/${encodeURIComponent(item.game_slug)}`} aria-label={`Xem ${item.game_name}`} className="shrink-0 rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-neon-cyan">
              <GameIcon src={item.cover_url} name={item.game_name} />
            </a>
            <div className="min-w-0 flex-1">
              <a href={`/game/${encodeURIComponent(item.game_slug)}`} className="block truncate font-bold text-sm text-slate-100 hover:text-neon-cyan" title={item.game_name}>{item.game_name}</a>
              <p className="mt-1 truncate text-xs text-slate-400">{item.developer || item.category_name || 'Game trong kho'}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <a href={`/play/${encodeURIComponent(item.game_slug)}`} className="rounded-lg bg-neon-cyan px-3 py-1.5 text-xs font-bold text-arcade-950 transition-colors hover:bg-neon-yellow">▶ Chơi</a>
                <button
                  type="button"
                  onClick={() => remove(item)}
                  disabled={removing === item.game_id}
                  title={`Bỏ "${item.game_name}" khỏi yêu thích`}
                  className="rounded-lg border border-neon-yellow/40 px-3 py-1.5 text-xs font-semibold text-neon-yellow transition-colors hover:bg-neon-yellow/10 disabled:cursor-wait disabled:opacity-60"
                >
                  {removing === item.game_id ? 'Đang bỏ…' : '★ Bỏ yêu thích'}
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
