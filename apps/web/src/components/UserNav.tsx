import React, { useEffect, useState } from 'react';
import { getCurrentUser, logoutUser } from '../lib/api';
import { User } from '@gametuoitho/shared-types';

export default function UserNav() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    getCurrentUser()
      .then((res) => {
        if (res.success && res.data) {
          setUser(res.data);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="w-20 h-8 bg-arcade-800 rounded animate-pulse" />;
  }

  if (!user) {
    return (
      <div className="flex items-center gap-3">
        <a
          href="/login"
          className="text-sm px-3 py-1.5 text-slate-300 hover:text-neon-cyan transition-colors"
        >
          Đăng nhập
        </a>
        <a
          href="/register"
          className="text-sm px-4 py-1.5 bg-neon-cyan text-arcade-950 font-bold rounded hover:bg-neon-yellow transition-all shadow-neon-cyan"
        >
          Đăng ký
        </a>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 bg-arcade-800 border border-neon-cyan/40 rounded hover:border-neon-cyan text-sm transition-all"
      >
        <span className="w-2 h-2 rounded-full bg-neon-green animate-pulse" />
        <span className="font-semibold text-slate-200">{user.username}</span>
        {user.role === 'ADMIN' && (
          <span className="text-[10px] bg-neon-pink/20 text-neon-pink border border-neon-pink/40 px-1.5 py-0.5 rounded font-mono font-bold">
            ADMIN
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 mt-2 w-48 bg-arcade-800 border border-neon-cyan/30 rounded-lg shadow-xl py-2 z-50 text-sm"
          onClick={() => setOpen(false)}
        >
          <div className="px-4 py-2 border-b border-arcade-700">
            <p className="text-xs text-slate-400">Đăng nhập với tư cách</p>
            <p className="font-bold text-neon-cyan truncate">{user.username}</p>
          </div>

          <a
            href="/me/library"
            className="block px-4 py-2 text-slate-200 hover:bg-arcade-700 hover:text-neon-yellow transition-colors"
          >
            📚 Thư viện của tôi
          </a>
          <a
            href="/me/imports"
            className="block px-4 py-2 text-slate-200 hover:bg-arcade-700 hover:text-neon-yellow transition-colors"
          >
            📦 Game đã Import (JAR)
          </a>
          <a
            href="/me/favorites"
            className="block px-4 py-2 text-slate-200 hover:bg-arcade-700 hover:text-neon-yellow transition-colors"
          >
            ⭐ Game yêu thích
          </a>
          <a
            href="/me/history"
            className="block px-4 py-2 text-slate-200 hover:bg-arcade-700 hover:text-neon-yellow transition-colors"
          >
            🕒 Lịch sử chơi
          </a>

          {user.role === 'ADMIN' && (
            <>
              <div className="border-t border-arcade-700 my-1" />
              <a
                href="/admin"
                className="block px-4 py-2 text-neon-pink font-semibold hover:bg-neon-pink/10 transition-colors"
              >
                ⚙️ Trang Quản Trị (Admin)
              </a>
            </>
          )}

          <div className="border-t border-arcade-700 my-1" />
          <button
            onClick={() => logoutUser()}
            className="w-full text-left px-4 py-2 text-red-400 hover:bg-red-500/10 transition-colors"
          >
            🚪 Đăng xuất
          </button>
        </div>
      )}
    </div>
  );
}
