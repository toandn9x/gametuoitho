import { ApiResponse } from '@gametuoitho/api-contracts';
import { Game, GameVersion, Category, User, UserLibraryItem } from '@gametuoitho/shared-types';

export const API_BASE_URL = typeof window !== 'undefined'
  ? (window as any).__PUBLIC_API_URL__ || '/api/v1'
  : process.env.PUBLIC_API_URL || `http://localhost:${process.env.PORT || 4321}/api/v1`;

// Token storage helpers
export function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('gametuoitho_token');
}

export function setAuthToken(token: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('gametuoitho_token', token);
  document.cookie = `token=${token}; path=/; max-age=604800`;
}

export function removeAuthToken(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('gametuoitho_token');
  document.cookie = 'token=; path=/; max-age=0';
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

    const data = await res.json();
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
} = {}) {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.limit) query.set('limit', String(params.limit));
  if (params.search) query.set('search', params.search);
  if (params.categoryId) query.set('categoryId', params.categoryId);
  if (params.categorySlug) query.set('categorySlug', params.categorySlug);
  if (params.sort) query.set('sort', params.sort);

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

export async function getFavorites() {
  return apiRequest<any[]>('/me/favorites');
}

export async function toggleFavorite(gameId: string) {
  return apiRequest<{ isFavorite: boolean }>('/me/favorites', {
    method: 'POST',
    body: JSON.stringify({ game_id: gameId }),
  });
}

export async function getHistory() {
  return apiRequest<any[]>('/me/history');
}

export async function recordPlay(gameId?: string, userLibraryId?: string) {
  return apiRequest('/me/history', {
    method: 'POST',
    body: JSON.stringify({ game_id: gameId, user_library_id: userLibraryId, activity_type: 'PLAY' }),
  });
}

// Admin API
export async function getAdminStats() {
  return apiRequest<any>('/admin/stats');
}

export async function getAdminGames(page = 1, limit = 50) {
  return apiRequest<Game[]>(`/admin/games?page=${page}&limit=${limit}`);
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
