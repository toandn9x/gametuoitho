import React, { useState, useEffect } from 'react';
import { getUserLibrary, removeGameFromLibrary } from '../lib/api';
import { UserLibraryItem } from '@gametuoitho/shared-types';

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
        setItems(items.filter((item) => item.id !== id));
      } else {
        alert(res.error?.message || 'Xóa thất bại');
      }
    } catch {
      alert('Đã xảy ra lỗi khi xóa');
    }
  };

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 animate-pulse">
        {[1, 2, 3].map((n) => (
          <div key={n} className="h-64 bg-arcade-850 rounded-2xl border border-arcade-800" />
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
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
      {items.map((item: any) => {
        const playUrl =
          item.source_type === 'CATALOG' && item.catalog_game_slug
            ? `/play/${item.catalog_game_slug}`
            : `/play/custom?id=${encodeURIComponent(item.id)}`;

        return (
          <div
            key={item.id}
            className="bg-arcade-800/90 border border-arcade-700/80 rounded-2xl overflow-hidden hover:border-neon-cyan/60 transition-all flex flex-col justify-between"
          >
            <div className="p-4">
              <div className="flex items-center justify-between mb-3">
                <span
                  className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${
                    item.source_type === 'CATALOG'
                      ? 'bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/30'
                      : 'bg-neon-yellow/20 text-neon-yellow border border-neon-yellow/30'
                  }`}
                >
                  {item.source_type === 'CATALOG' ? 'CATALOG' : 'USER IMPORT'}
                </span>
                <span className="text-[10px] text-slate-500 font-mono">
                  {new Date(item.created_at).toLocaleDateString('vi-VN')}
                </span>
              </div>

              <h3 className="font-bold text-slate-100 text-base line-clamp-1 mb-1">
                {item.custom_name}
              </h3>
              <p className="text-xs text-slate-400">
                {item.source_type === 'CATALOG'
                  ? 'Game từ hệ thống'
                  : `File: ${item.custom_original_filename || 'Custom JAR'}`}
              </p>
            </div>

            <div className="p-4 pt-0 border-t border-arcade-700/40 flex items-center gap-2 mt-4">
              <a
                href={playUrl}
                className="flex-1 py-2 text-center bg-neon-cyan text-arcade-950 font-bold text-xs rounded hover:bg-neon-yellow transition-all"
              >
                ▶ Chơi
              </a>
              <button
                onClick={() => handleRemove(item.id, item.custom_name)}
                className="px-3 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded text-xs transition-colors"
                title="Xóa khỏi thư viện"
              >
                Xóa
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
