import React, { useEffect, useState } from 'react';
import { AUTH_CHANGED_EVENT, getAuthToken, getFavorites, setFavorite } from '../lib/api';

type Status = 'loading' | 'guest' | 'ready' | 'saving';

/** Personal ☆/★ on a game page. Guests are sent to /login and come back here. */
export default function FavoriteButton({ gameId }: { gameId: string }) {
  const [status, setStatus] = useState<Status>('loading');
  const [isFavorite, setIsFavorite] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let controller: AbortController | undefined;

    const refresh = async () => {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      const token = getAuthToken();
      if (!token) {
        setIsFavorite(false);
        setStatus('guest');
        return;
      }
      setStatus(value => (value === 'saving' ? value : 'loading'));
      const result = await getFavorites(current.signal);
      if (!active || current.signal.aborted || getAuthToken() !== token) return;
      // If the list cannot be read the button still works: it sets the state, it never flips it.
      setIsFavorite(!!(result.success && result.data?.some(item => item.game_id === gameId)));
      setStatus('ready');
    };
    const storageChanged = (event: StorageEvent) => {
      if (event.key === 'gametuoitho_token' || event.key === null) void refresh();
    };
    const pageShown = (event: PageTransitionEvent) => { if (event.persisted) void refresh(); };

    void refresh();
    window.addEventListener(AUTH_CHANGED_EVENT, refresh);
    window.addEventListener('storage', storageChanged);
    window.addEventListener('pageshow', pageShown);
    return () => {
      active = false;
      controller?.abort();
      window.removeEventListener(AUTH_CHANGED_EVENT, refresh);
      window.removeEventListener('storage', storageChanged);
      window.removeEventListener('pageshow', pageShown);
    };
  }, [gameId]);

  const onClick = async () => {
    if (status === 'guest') {
      const next = window.location.pathname + window.location.search;
      window.location.href = `/login?${new URLSearchParams({ next }).toString()}`;
      return;
    }
    if (status !== 'ready') return;
    setStatus('saving');
    setError(null);
    const result = await setFavorite(gameId, !isFavorite);
    if (result.success && result.data) {
      setIsFavorite(result.data.isFavorite);
      setStatus('ready');
    } else {
      // A 401 already logged the user out (AUTH_CHANGED_EVENT), which turns the button into "guest".
      setStatus(getAuthToken() ? 'ready' : 'guest');
      setError(result.error?.message || 'Không thể cập nhật game yêu thích.');
    }
  };

  const label = status === 'saving' ? 'Đang lưu…' : isFavorite ? '★ Đã yêu thích' : '☆ Yêu thích';
  const title = status === 'guest'
    ? 'Đăng nhập để lưu game vào danh sách yêu thích'
    : isFavorite ? 'Bỏ khỏi game yêu thích của bạn' : 'Thêm vào game yêu thích của bạn';

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={status === 'loading' || status === 'saving'}
        aria-pressed={status === 'guest' ? undefined : isFavorite}
        title={title}
        data-favorite-button
        className={`rounded-xl border px-4 py-3 text-center text-xs font-semibold transition-colors disabled:cursor-wait disabled:opacity-70 ${isFavorite
          ? 'border-neon-yellow/50 bg-neon-yellow/10 text-neon-yellow hover:bg-neon-yellow/20'
          : 'border-arcade-600 bg-arcade-900 text-slate-200 hover:border-neon-yellow hover:text-neon-yellow'}`}
      >
        {label}
      </button>
      {error && <p role="alert" className="w-full text-xs text-neon-pink">{error}</p>}
    </>
  );
}
