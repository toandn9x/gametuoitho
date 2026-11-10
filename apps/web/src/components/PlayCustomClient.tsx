import React, { useEffect, useState } from 'react';
import { getAuthToken, handleUnauthorized } from '../lib/api';
import EmulatorPlayer from './EmulatorPlayer';

export default function PlayCustomClient() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [gameTitle, setGameTitle] = useState('Game Đã Import');
  const [jarBuffer, setJarBuffer] = useState<ArrayBuffer | null>(null);

  useEffect(() => {
    let isMounted = true;
    const token = getAuthToken();

    if (!token) {
      setError('Vui lòng đăng nhập tài khoản để chơi game riêng tư đã import của bạn.');
      setLoading(false);
      handleUnauthorized(false);
      return;
    }

    const searchParams = new URLSearchParams(window.location.search);
    const importId = searchParams.get('importId');
    const libraryId = searchParams.get('id');

    if (!importId && !libraryId) {
      setError('Không tìm thấy thông tin mục game cần chơi (thiếu id hoặc importId).');
      setLoading(false);
      return;
    }

    async function loadPrivateGame() {
      try {
        let title = 'Game Đã Import';
        let jarUrl = '';

        if (importId) {
          const res = await fetch('/api/v1/me/imports', {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.status === 401) handleUnauthorized(true);
          if (!res.ok) throw new Error(`Không thể lấy danh sách import (HTTP ${res.status})`);
          const json = await res.json();
          const item = (json.data || []).find((it: any) => it.id === importId);
          if (!item) {
            throw new Error('Không tìm thấy game trong danh mục import của bạn hoặc bạn không có quyền truy cập.');
          }
          title = item.custom_name || title;
          jarUrl = item.jar_url;
        } else if (libraryId) {
          const res = await fetch('/api/v1/me/library', {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.status === 401) handleUnauthorized(true);
          if (!res.ok) throw new Error(`Không thể lấy danh sách thư viện (HTTP ${res.status})`);
          const json = await res.json();
          const item = (json.data || []).find((it: any) => it.id === libraryId);
          if (!item) {
            throw new Error('Không tìm thấy game trong thư viện của bạn hoặc bạn không có quyền truy cập.');
          }
          title = item.custom_name || item.name || title;
          jarUrl = item.custom_jar_url || item.jar_url;
        }

        if (!jarUrl) {
          throw new Error('Mục game này chưa có liên kết file JAR hợp lệ.');
        }

        // Fetch JAR binary bytes using auth token
        const jarRes = await fetch(jarUrl, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!jarRes.ok) {
          if (jarRes.status === 401) handleUnauthorized(true);
          if (jarRes.status === 401 || jarRes.status === 403) {
            throw new Error('Bạn không có quyền truy cập tải file game riêng tư này.');
          }
          throw new Error(`Tải file JAR thất bại (HTTP ${jarRes.status})`);
        }

        const buf = await jarRes.arrayBuffer();
        if (isMounted) {
          setGameTitle(title);
          setJarBuffer(buf);
          if (typeof document !== 'undefined' && title) {
            document.title = `Đang Chơi: ${title} --- Game Tuổi Thơ Web Player`;
          }
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err.message || 'Lỗi khi chuẩn bị dữ liệu game');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    loadPrivateGame();

    return () => {
      isMounted = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="py-24 text-center">
        <div className="inline-block w-8 h-8 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-slate-400 text-sm font-mono">Đang tải và xác thực game riêng tư...</p>
      </div>
    );
  }

  if (error || !jarBuffer) {
    return (
      <div className="py-20 text-center bg-arcade-900 border border-arcade-800 rounded-3xl p-8 max-w-lg mx-auto">
        <span className="text-5xl">🔒</span>
        <h2 className="text-xl font-bold text-slate-200 mt-4">Truy Cập Bị Từ Chối</h2>
        <p className="text-slate-400 text-xs mt-2">{error || 'Không thể mở game riêng tư.'}</p>
        <div className="flex justify-center gap-3 mt-6">
          <a
            href="/me/imports"
            className="px-4 py-2 bg-neon-cyan text-arcade-950 font-bold text-xs rounded-xl hover:bg-neon-yellow transition-all"
          >
            ← Danh sách import
          </a>
          <a
            href="/login"
            className="px-4 py-2 bg-arcade-800 text-slate-200 border border-arcade-700 font-bold text-xs rounded-xl hover:border-neon-cyan transition-all"
          >
            Đăng nhập tài khoản
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex items-center justify-between pb-4 border-b border-arcade-800 mb-6">
        <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
          <a href="/" className="hover:text-neon-cyan">Trang chủ</a>
          <span>/</span>
          <a href="/me/imports" className="hover:text-neon-cyan">Game Import</a>
          <span>/</span>
          <span className="text-neon-yellow font-bold">{gameTitle}</span>
        </div>

        <a
          href="/me/imports"
          className="text-xs text-slate-400 hover:text-neon-cyan flex items-center gap-1 font-semibold"
        >
          <span>← Về danh sách import</span>
        </a>
      </div>

      <EmulatorPlayer
        gameName={gameTitle}
        directBytes={jarBuffer}
      />
    </div>
  );
}
