import { ApiResponse } from '@gametuoitho/api-contracts';
import { Game, GameVersion, Category, User, UserLibraryItem, PlayHistoryItem, FavoriteGameItem } from '@gametuoitho/shared-types';

export const AUTH_CHANGED_EVENT = 'gtt:auth-changed';
export const PLAY_HISTORY_UPDATED_EVENT = 'gtt:play-history-updated';
export const FAVORITES_UPDATED_EVENT = 'gtt:favorites-updated';

export const API_BASE_URL = typeof window !== 'undefined'
  ? (window as any).__PUBLIC_API_URL__ || '/api/v1'
  : import.meta.env?.PUBLIC_API_URL || 'http://localhost:4321/api/v1';

// Token storage helpers
export function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('gametuoitho_token');
}

export function setAuthToken(token: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('gametuoitho_token', token);
  document.cookie = `token=${token}; path=/; max-age=604800`;
  window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
}

export function removeAuthToken(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('gametuoitho_token');
  document.cookie = 'token=; path=/; max-age=0';
  window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
}

// Pages that cannot work without a valid session.
const PROTECTED_PAGE = /^\/(?:admin|me)(?:\/|$)|^\/play\/custom(?:\/|$)/;
// Kept on window: each Astro island may bundle its own copy of this module, and only the first
// 401 on a page should decide where to go (otherwise a later "no token" call overrides "expired").
const UNAUTHORIZED_FLAG = '__gttUnauthorizedHandled';

/**
 * Called when the API answers 401. A stale token (expired, revoked, secret rotated) is dropped.
 * On protected pages the user is sent to /login with the reason and the page to return to;
 * on public pages a notice is shown instead so browsing/playing is not interrupted.
 */
export function handleUnauthorized(hadToken: boolean): void {
  if (typeof window === 'undefined' || (window as any)[UNAUTHORIZED_FLAG]) return;
  if (hadToken) removeAuthToken();

  const { pathname, search } = window.location;
  if (/^\/(?:login|register)(?:\/|$)/.test(pathname)) return;

  if (PROTECTED_PAGE.test(pathname)) {
    (window as any)[UNAUTHORIZED_FLAG] = true;
    const params = new URLSearchParams({ reason: hadToken ? 'expired' : 'login', next: pathname + search });
    window.location.replace(`/login?${params.toString()}`);
  } else if (hadToken) {
    (window as any)[UNAUTHORIZED_FLAG] = true;
    showSessionExpiredNotice(pathname + search);
  }
}

function showSessionExpiredNotice(next: string): void {
  if (document.getElementById('session-expired-notice')) return;

  const box = document.createElement('div');
  box.id = 'session-expired-notice';
  box.setAttribute('role', 'alert');
  box.className =
    'fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] w-[calc(100%-2rem)] max-w-md flex items-center gap-3 px-4 py-3 rounded-2xl border border-neon-pink/50 bg-arcade-900/95 backdrop-blur text-sm text-slate-200 shadow-neon-pink';

  const icon = document.createElement('span');
  icon.textContent = '🔒';
  icon.setAttribute('aria-hidden', 'true');

  const text = document.createElement('span');
  text.className = 'flex-1 min-w-0';
  text.textContent = 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';

  const login = document.createElement('a');
  login.href = `/login?${new URLSearchParams({ reason: 'expired', next }).toString()}`;
  login.className = 'flex-shrink-0 px-3 py-1.5 rounded-lg bg-neon-pink text-white text-xs font-bold hover:bg-neon-cyan hover:text-arcade-950 transition-colors';
  login.textContent = 'Đăng nhập';

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'flex-shrink-0 w-7 h-7 rounded-full text-slate-400 hover:text-white hover:bg-arcade-800';
  close.setAttribute('aria-label', 'Đóng thông báo');
  close.textContent = '✕';
  close.addEventListener('click', () => box.remove());

  box.append(icon, text, login, close);
  document.body.appendChild(box);
}

/** Only same-site paths are allowed as a post-login destination (no open redirects). */
export function safeNextPath(next: string | null): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null;
  if (/^\/(?:login|register)(?:\/|$)/.test(next)) return null;
  return next;
}

export async function apiRequest<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  const token = getAuthToken();
  const headers = new Headers(options.headers || {});

  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const url = `${API_BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

  try {
    const res = await fetch(url, {
      ...options,
      headers,
    });

    if (res.status === 401 && getAuthToken() === token) {
      handleUnauthorized(!!token);
    }

    const text = await res.text();
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch {
      return {
        success: false,
        error: {
          code: res.ok ? 'INVALID_RESPONSE' : res.status === 404 ? 'NOT_FOUND' : 'SERVER_ERROR',
          message: res.ok
            ? 'Phản hồi từ máy chủ không hợp lệ'
            : `Lỗi máy chủ (HTTP ${res.status})`,
        },
      };
    }
    return data;
  } catch (err: any) {
    return {
      success: false,
      error: {
        code: 'NETWORK_ERROR',
        message: err.message || 'Không thể kết nối đến máy chủ API',
      },
    };
  }
}

// Public API
export async function getGames(params: {
  page?: number;
  limit?: number;
  search?: string;
  categoryId?: string;
  categorySlug?: string;
  sort?: string;
  featured?: boolean;
} = {}) {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.limit) query.set('limit', String(params.limit));
  if (params.search) query.set('search', params.search);
  if (params.categoryId) query.set('categoryId', params.categoryId);
  if (params.categorySlug) query.set('categorySlug', params.categorySlug);
  if (params.sort) query.set('sort', params.sort);
  if (params.featured !== undefined) query.set('featured', String(params.featured));

  return apiRequest<Game[]>(`/games?${query.toString()}`);
}

export async function getGameDetail(slug: string) {
  return apiRequest<{
    game: Game;
    versions: GameVersion[];
    screenshots: { id: string; url: string; sort_order: number }[];
  }>(`/games/${slug}`);
}

export async function getCategories() {
  return apiRequest<Category[]>('/categories');
}

export async function searchGames(query: string) {
  return apiRequest<Game[]>(`/search?q=${encodeURIComponent(query)}`);
}

// Auth API
export async function loginUser(credentials: { usernameOrEmail: string; password: string }) {
  const res = await apiRequest<{ user: User; token: string }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(credentials),
  });

  if (res.success && res.data?.token) {
    setAuthToken(res.data.token);
  }
  return res;
}

export async function registerUser(data: { username: string; email: string; password: string }) {
  const res = await apiRequest<{ user: User; token: string }>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(data),
  });

  if (res.success && res.data?.token) {
    setAuthToken(res.data.token);
  }
  return res;
}

/** Public sign-in options (e.g. whether "Sign in with Google" is enabled on this server). */
export async function getAuthConfig() {
  return apiRequest<{ googleClientId: string | null }>('/auth/config');
}

/** Exchange a Google ID token (from Google Identity Services) for a session on this site. */
export async function loginWithGoogle(credential: string) {
  const res = await apiRequest<{ user: User; token: string }>('/auth/google', {
    method: 'POST',
    body: JSON.stringify({ credential }),
  });

  if (res.success && res.data?.token) {
    setAuthToken(res.data.token);
  }
  return res;
}

export async function getCurrentUser() {
  return apiRequest<User>('/auth/me');
}

export function logoutUser(): void {
  removeAuthToken();
  if (typeof window !== 'undefined') {
    window.location.href = '/login';
  }
}

// User Library API
export async function getUserLibrary() {
  return apiRequest<UserLibraryItem[]>('/me/library');
}

export async function addGameToLibrary(gameId: string, gameVersionId?: string) {
  return apiRequest('/me/library', {
    method: 'POST',
    body: JSON.stringify({ game_id: gameId, game_version_id: gameVersionId }),
  });
}

export async function removeGameFromLibrary(id: string) {
  return apiRequest(`/me/library/${id}`, {
    method: 'DELETE',
  });
}

export async function getUserImports() {
  return apiRequest<UserLibraryItem[]>('/me/imports');
}

export async function uploadJarFile(file: File, customName: string) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('assetType', 'JAR');

  // Step 1: Upload raw file to storage
  const uploadRes = await apiRequest<{ id: string; storage_key: string }>('/upload', {
    method: 'POST',
    body: formData,
  });

  if (!uploadRes.success || !uploadRes.data?.id) {
    throw new Error(uploadRes.error?.message || 'Tải file lên thất bại');
  }

  // Step 2: Add to user personal library
  const importRes = await apiRequest('/me/imports', {
    method: 'POST',
    body: JSON.stringify({
      custom_name: customName,
      jar_asset_id: uploadRes.data.id,
    }),
  });

  return importRes;
}

export async function getFavorites(signal?: AbortSignal) {
  return apiRequest<FavoriteGameItem[]>('/me/favorites', { signal, cache: 'no-store' });
}

/** Sets (not flips) the star, so a stale page cannot undo what the user sees. */
export async function setFavorite(gameId: string, favorite: boolean) {
  const result = await apiRequest<{ isFavorite: boolean }>('/me/favorites', {
    method: 'POST',
    body: JSON.stringify({ game_id: gameId, favorite }),
  });
  if (result.success) window.dispatchEvent(new Event(FAVORITES_UPDATED_EVENT));
  return result;
}

export async function getHistory(limit = 20, signal?: AbortSignal) {
  return apiRequest<PlayHistoryItem[]>(`/me/history?limit=${limit}`, { signal, cache: 'no-store' });
}

export async function recordPlay(gameId?: string, userLibraryId?: string) {
  // Guests can play catalog games without creating an authenticated history request.
  const token = getAuthToken();
  if (!token) return { success: false };
  const result = await apiRequest('/me/history', {
    method: 'POST',
    body: JSON.stringify({ game_id: gameId, user_library_id: userLibraryId, activity_type: 'PLAY' }),
  });
  if (result.success && getAuthToken() === token) {
    window.dispatchEvent(new Event(PLAY_HISTORY_UPDATED_EVENT));
  }
  return result;
}

// Admin API
export async function getAdminStats() {
  return apiRequest<any>('/admin/stats');
}

export async function getAdminGames(page = 1, limit = 100, status?: string, search?: string, featuredOnly = false): Promise<ApiResponse<Game[]> & { total?: number }> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (status && status !== 'ALL') params.set('status', status);
  if (search) params.set('search', search);
  if (featuredOnly) params.set('featured', 'true');
  return apiRequest<Game[]>(`/admin/games?${params.toString()}`);
}

export async function createAdminGame(gameData: any) {
  return apiRequest('/admin/games', {
    method: 'POST',
    body: JSON.stringify(gameData),
  });
}

export async function updateAdminGame(id: string, gameData: any) {
  return apiRequest(`/admin/games/${id}`, {
    method: 'PUT',
    body: JSON.stringify(gameData),
  });
}

export async function publishAdminGame(id: string) {
  return apiRequest(`/admin/games/${id}/publish`, { method: 'POST' });
}

export async function hideAdminGame(id: string) {
  return apiRequest(`/admin/games/${id}/hide`, { method: 'POST' });
}

export async function deleteAdminGame(id: string) {
  return apiRequest(`/admin/games/${id}`, { method: 'DELETE' });
}

export async function addAdminGameVersion(gameId: string, versionData: any) {
  return apiRequest(`/admin/games/${gameId}/versions`, {
    method: 'POST',
    body: JSON.stringify(versionData),
  });
}

export async function getAdminImports(page = 1, limit = 50) {
  return apiRequest<any[]>(`/admin/imports?page=${page}&limit=${limit}`);
}

export async function getAdminAssets(page = 1, limit = 50) {
  return apiRequest<any[]>(`/admin/assets?page=${page}&limit=${limit}`);
}

// Crawler API (gametuoitho.cc)
export async function getCrawlerGames(params: {
  search?: string;
  category?: string;
  page?: number;
  limit?: number;
} = {}) {
  const query = new URLSearchParams();
  if (params.search) query.set('search', params.search);
  if (params.category) query.set('category', params.category);
  if (params.page) query.set('page', String(params.page));
  if (params.limit) query.set('limit', String(params.limit));

  return apiRequest<any[]>(`/admin/crawler/games?${query.toString()}`);
}

export async function importCrawlerGame(gameId: string, options: { allowSameName?: boolean } = {}) {
  return apiRequest<{ game: Game; version: GameVersion; warnings?: string[] }>(`/admin/crawler/import`, {
    method: 'POST',
    body: JSON.stringify({ gameId, allowSameName: options.allowSameName === true }),
  });
}

export async function batchImportCrawlerGames(gameIds: string[]) {
  return apiRequest<{
    total: number;
    importedCount: number;
    skippedCount?: number;
    errorCount: number;
    results: { gameId: string; ok: boolean; slug?: string; error?: string; reason?: string; warnings?: string[] }[];
  }>(`/admin/crawler/batch-import`, {
    method: 'POST',
    body: JSON.stringify({ gameIds }),
  });
}

// Crash & Error Reports API
export async function reportGameCrash(reportData: {
  game_id?: string;
  game_version_id?: string;
  game_slug?: string;
  game_name: string;
  error_type: string;
  error_message: string;
  stack_trace?: string;
}) {
  return apiRequest<{ id: string }>('/reports/crash', {
    method: 'POST',
    body: JSON.stringify(reportData),
  });
}

export async function getAdminCrashReports(params: {
  page?: number;
  limit?: number;
  status?: string;
  errorType?: string;
  search?: string;
} = {}) {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.limit) query.set('limit', String(params.limit));
  if (params.status && params.status !== 'ALL') query.set('status', params.status);
  if (params.errorType && params.errorType !== 'ALL') query.set('errorType', params.errorType);
  if (params.search) query.set('search', params.search);

  return apiRequest<any>(`/admin/reports?${query.toString()}`);
}

export async function updateAdminCrashReport(id: string, data: { status: string; admin_notes?: string }) {
  return apiRequest(`/admin/reports/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteAdminCrashReport(id: string) {
  return apiRequest(`/admin/reports/${id}`, {
    method: 'DELETE',
  });
}

// Storage Management & Cleanup API
export async function getStorageAnalysis() {
  return apiRequest<any>('/admin/storage/analysis');
}

export async function cleanupStorage(options: { cleanOrphans?: boolean; purgeDeleted?: boolean } = {}) {
  return apiRequest<any>('/admin/storage/cleanup', {
    method: 'POST',
    body: JSON.stringify(options),
  });
}

export async function deleteAdminAsset(id: string) {
  return apiRequest(`/admin/assets/${id}`, {
    method: 'DELETE',
  });
}

export async function bulkDeleteAdminAssets(ids: string[]) {
  return apiRequest<{ results: { id: string; ok: boolean; status: number; reason?: string }[] }>(
    '/admin/assets/bulk-delete',
    {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }
  );
}
