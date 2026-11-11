import React, { useState, useEffect } from 'react';
import { getUserLibrary, removeGameFromLibrary } from '../lib/api';
import { UserLibraryItem } from '@gametuoitho/shared-types';
import { GameCardView } from './GameCard';

export default function UserLibraryView() {
  const [items, setItems] = useState<UserLibraryItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = () => {
    getUserLibrary()
      .then((res) => {
        if (res.success && res.data) {
          setItems(res.data);
        }
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleRemove = async (id: string, name: string) => {
    if (!confirm(`Bạn có chắc chắn muốn xóa "${name}" khỏi thư viện?`)) return;
    try {
      const res = await removeGameFromLibrary(id);
      if (res.success) {
        setItems(current => current.filter((item) => item.id !== id));
      } else {
        alert(res.error?.message || 'Xóa thất bại');
      }
    } catch {
      alert('Đã xảy ra lỗi khi xóa');
    }
  };

  if (loading) {
    return (
      <div className="game-list-grid animate-pulse">
        {[1, 2, 3].map((n) => (
          <div key={n} className="h-40 bg-arcade-850 rounded-2xl border border-arcade-800" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-20 bg-arcade-900 rounded-3xl border border-arcade-800">
        <span className="text-5xl">📚</span>
        <h3 className="text-lg font-bold text-slate-200 mt-4">Thư viện của bạn đang trống</h3>
        <p className="text-xs text-slate-400 mt-1">
          Hãy khám phá Kho Game và thêm các tựa game bạn yêu thích vào đây, hoặc tự tải lên file JAR của bạn!
        </p>
        <div className="flex justify-center gap-3 mt-6">
          <a
            href="/games"
            className="px-4 py-2 bg-neon-cyan text-arcade-950 font-bold rounded-lg text-xs hover:bg-neon-yellow transition-all"
          >
            Khám phá Kho Game →
          </a>
          <a
            href="/me/imports"
            className="px-4 py-2 bg-arcade-800 text-slate-200 border border-arcade-700 font-bold rounded-lg text-xs hover:border-neon-cyan transition-all"
          >
            Tải lên file JAR
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="game-list-grid">
      {items.map(item => {
        const isCatalog = item.source_type === 'CATALOG';
        const name = item.catalog_game_name || item.custom_name;
        const available = item.is_available !== false && item.is_available !== 0;
        const catalogSlug = isCatalog && available ? item.catalog_game_slug : null;
        const playUrl = !available ? undefined : isCatalog
          ? catalogSlug ? `/play/${encodeURIComponent(catalogSlug)}` : undefined
          : `/play/custom?id=${encodeURIComponent(item.id)}`;

        return (
          <GameCardView
            key={item.id}
            game={{ name, cover_url: item.cover_url, developer: isCatalog ? 'Game từ hệ thống' : `File: ${item.custom_original_filename || 'Custom JAR'}` }}
            detailHref={catalogSlug ? `/game/${encodeURIComponent(catalogSlug)}` : playUrl}
            playHref={playUrl}
            metadata={<>
                <span
                  className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${
                    isCatalog
                      ? 'bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/30'
                      : 'bg-neon-yellow/20 text-neon-yellow border border-neon-yellow/30'
                  }`}
                >
                  {isCatalog ? 'CATALOG' : 'USER IMPORT'}
                </span>
                <span className="text-[10px] text-slate-500 font-mono">
                  {new Date(item.created_at).toLocaleDateString('vi-VN')}
                </span>
            </>}
            action={
              <button
                type="button"
                onClick={() => handleRemove(item.id, name)}
                className="px-3 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded text-xs transition-colors"
                title="Xóa khỏi thư viện"
                aria-label={`Xóa ${name} khỏi thư viện`}
              >
                Xóa
              </button>
            }
          />
        );
      })}
    </div>
  );
}
