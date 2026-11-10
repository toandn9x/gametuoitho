import React, { useEffect, useState } from 'react';
import type { PlayHistoryItem } from '@gametuoitho/shared-types';
import { AUTH_CHANGED_EVENT, PLAY_HISTORY_UPDATED_EVENT, getAuthToken, getHistory, handleUnauthorized } from '../lib/api';
import GameIcon from './GameIcon';

type HistoryState = {
  status: 'guest' | 'loading' | 'ready' | 'error';
  items: PlayHistoryItem[];
  error?: string;
};

function playedAt(value: string) {
  // Earlier SQLite records use UTC without a timezone suffix.
  const date = new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z');
  if (Number.isNaN(date.getTime())) return null;
  return { iso: date.toISOString(), label: new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(date) };
}

export default function RecentGames({ fullPage = false }: { fullPage?: boolean }) {
  const [state, setState] = useState<HistoryState>({ status: fullPage ? 'loading' : 'guest', items: [] });
  const [retry, setRetry] = useState(0);

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
        if (fullPage) handleUnauthorized(false);
        return;
      }
      const changedAccount = token !== previousToken;
      previousToken = token;
      setState(current => changedAccount ? { status: 'loading', items: [] } : { ...current, status: 'loading' });
      const result = await getHistory(fullPage ? 50 : 6, controller.signal);
      // An old request must never display the previous account's private games.
      if (!active || request !== generation || getAuthToken() !== token) return;
      if (result.success && result.data) setState({ status: 'ready', items: result.data });
      else setState({ status: 'error', items: [], error: result.error?.message || 'Không thể tải game chơi gần đây.' });
    };
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    const storageChanged = (event: StorageEvent) => {
      if (event.key === 'gametuoitho_token' || event.key === null) void refresh();
    };

    void refresh();
    window.addEventListener(AUTH_CHANGED_EVENT, refresh);
    window.addEventListener(PLAY_HISTORY_UPDATED_EVENT, refresh);
    window.addEventListener('storage', storageChanged);
    window.addEventListener('pageshow', refresh);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', visible);
    return () => {
      active = false;
      generation++;
      controller?.abort();
      window.removeEventListener(AUTH_CHANGED_EVENT, refresh);
      window.removeEventListener(PLAY_HISTORY_UPDATED_EVENT, refresh);
      window.removeEventListener('storage', storageChanged);
      window.removeEventListener('pageshow', refresh);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [fullPage, retry]);

  if (state.status === 'guest' && !fullPage) return null;

  return (
    <section aria-label="Game chơi gần đây" data-recent-games>
      {!fullPage && (
        <div className="flex items-end justify-between gap-3 mb-5 sm:mb-8">
          <div className="min-w-0">
            <h2 className="text-lg sm:text-2xl font-black text-slate-100 flex items-center gap-2">
              <span className="text-neon-cyan" aria-hidden="true">🕒</span> Chơi gần đây
            </h2>
            <p className="text-xs text-slate-400 mt-1">Tiếp tục game bạn vừa chơi trong tài khoản này</p>
          </div>
          <a href="/me/history" className="shrink-0 whitespace-nowrap px-3 sm:px-4 py-2 bg-arcade-800 border border-arcade-600 rounded-lg text-xs font-bold text-neon-cyan hover:border-neon-cyan transition-colors">Xem tất cả →</a>
        </div>
      )}

      {state.status === 'loading' && state.items.length === 0 ? (
        <div role="status" aria-label="Đang tải game chơi gần đây" className="game-list-grid animate-pulse">
          {Array.from({ length: fullPage ? 6 : 3 }, (_, index) => (
            <div key={index} className="flex items-center gap-3 rounded-2xl border border-arcade-700 bg-arcade-800 p-3 sm:p-4">
              <div className="h-14 w-14 sm:h-16 sm:w-16 shrink-0 rounded-xl bg-arcade-700" />
              <div className="flex-1 space-y-3"><div className="h-4 w-3/4 rounded bg-arcade-700" /><div className="h-3 w-1/2 rounded bg-arcade-700" /></div>
            </div>
          ))}
        </div>
      ) : state.status === 'error' ? (
        <div role="alert" className="rounded-2xl border border-arcade-700 bg-arcade-900 p-6 text-center">
          <p className="text-sm text-slate-300">{state.error}</p>
          <button type="button" onClick={() => setRetry(value => value + 1)} className="mt-3 px-4 py-2 text-sm font-bold text-neon-cyan hover:underline">Thử lại</button>
        </div>
      ) : state.items.length > 0 ? (
        <div className="game-list-grid" aria-busy={state.status === 'loading'}>
          {state.items.map(item => {
            const name = item.game_name || item.custom_name || 'Game đã import';
            const time = playedAt(item.last_played_at);
            const href = item.game_slug ? `/play/${encodeURIComponent(item.game_slug)}` : `/play/custom?importId=${encodeURIComponent(item.user_library_id || '')}`;
            return (
              <a key={item.game_id ? `game:${item.game_id}` : `import:${item.user_library_id}`} href={href} data-recent-game className="group flex min-w-0 items-center gap-3 rounded-2xl border border-arcade-700 bg-arcade-800/80 p-3 sm:p-4 hover:border-neon-cyan/60 hover:bg-arcade-800 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-neon-cyan">
                <GameIcon src={item.cover_url} name={name} />
                <div className="flex-1 min-w-0">
                  <h3 className="truncate font-bold text-sm text-slate-100 group-hover:text-neon-cyan" title={name}>{name}</h3>
                  <p className="text-xs text-slate-400 truncate mt-1">{item.user_library_id ? '🔒 Game import riêng tư' : item.developer || item.category_name || 'Game trong kho'}</p>
                  {time && <p className="text-[11px] text-slate-400 mt-1">Đã chơi <time dateTime={time.iso}>{time.label}</time></p>}
                </div>
                <span className="shrink-0 text-neon-cyan" aria-hidden="true">▶</span>
              </a>
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl border border-arcade-700 bg-arcade-900 px-5 py-8 text-center">
          <p className="font-bold text-slate-200">{state.status === 'guest' ? 'Đăng nhập để xem game chơi gần đây' : 'Bạn chưa chơi game nào'}</p>
          <p className="text-xs text-slate-400 mt-2">Mở chơi một game để lưu vào lịch sử tài khoản.</p>
          <a href={state.status === 'guest' ? '/login?next=%2Fme%2Fhistory' : '/games'} className="inline-block mt-4 text-xs font-bold text-neon-cyan hover:underline">{state.status === 'guest' ? 'Đăng nhập' : 'Khám phá kho game →'}</a>
        </div>
      )}
    </section>
  );
}
