import React, { useEffect, useState } from 'react';
import { Game, Category } from '@gametuoitho/shared-types';
import { getGames, getCategories } from '../lib/api';
import GameCard from './GameCard';

export default function GameCatalogView() {
  const [games, setGames] = useState<Game[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [featuredOnly, setFeaturedOnly] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, limit: 16, total: 0, totalPages: 1 });

  // Read URL params on initial client load
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('search')) setSearch(params.get('search')!.trim());
      setFeaturedOnly(params.get('featured') === 'true');
      if (params.get('category')) setSelectedCategory(params.get('category')!);
      if (params.get('sort')) setSort(params.get('sort')!);
      if (params.get('page')) setPage(Number(params.get('page')) || 1);
    }
  }, []);

  // Fetch categories once
  useEffect(() => {
    getCategories().then((res) => {
      if (res.success && res.data) {
        setCategories(res.data);
      }
    });
  }, []);

  // Fetch games when filters change
  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    getGames({
      search: search.trim() || undefined,
      featured: featuredOnly ? true : undefined,
      categorySlug: selectedCategory || undefined,
      sort,
      page,
      limit: 16,
    })
      .then((res) => {
        if (isMounted && res.success && res.data) {
          setGames(featuredOnly ? res.data.filter(game => game.is_featured === true) : res.data);
          if (res.pagination) {
            setPagination(res.pagination);
          }
        }
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [search, featuredOnly, selectedCategory, sort, page]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
  };

  const handleCategorySelect = (slug: string) => {
    setSelectedCategory(slug);
    setPage(1);
  };

  const handleSortChange = (newSort: string) => {
    setSort(newSort);
    setPage(1);
  };

  return (
    <div>
      {/* Search & Filters Bar */}
      <div className="mt-6 flex flex-col md:flex-row gap-4 justify-between items-center bg-arcade-900 p-4 rounded-2xl border border-arcade-800">
        {/* Search form */}
        <form onSubmit={handleSearchSubmit} className="w-full md:w-96 relative">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm theo tên game, nhà phát hành..."
            className="w-full bg-arcade-800 border border-arcade-700 focus:border-neon-cyan rounded-xl px-4 py-2 text-sm text-slate-100 placeholder-slate-400 focus:outline-none"
          />
          <button type="submit" className="absolute right-3 top-2.5 text-slate-400 hover:text-neon-cyan">
            🔍
          </button>
        </form>

        {/* Sorting */}
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto justify-end text-xs">
          <span className="text-slate-400">Sắp xếp:</span>
          {(['newest', 'popular', 'name'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => handleSortChange(s)}
              className={`px-3 py-2 sm:py-1.5 rounded-lg border transition-all ${
                sort === s
                  ? 'bg-neon-cyan/20 border-neon-cyan text-neon-cyan font-bold'
                  : 'border-arcade-700 text-slate-400 hover:text-slate-200'
              }`}
            >
              {s === 'newest' ? 'Mới nhất' : s === 'popular' ? 'Phổ biến' : 'A-Z'}
            </button>
          ))}
        </div>
      </div>

      {/* Categories row */}
      <div className="flex flex-wrap items-center gap-2 mt-4 pt-2 pb-2">
        <button
          type="button"
          aria-pressed={featuredOnly}
          onClick={() => { setFeaturedOnly(value => !value); setPage(1); }}
          className={`px-3 py-2.5 sm:py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-all border ${
            featuredOnly ? 'bg-neon-yellow text-arcade-950 border-neon-yellow' : 'bg-arcade-800 text-slate-400 border-arcade-700 hover:text-neon-yellow'
          }`}
        >
          ★ Game ưa thích
        </button>
        <button
          type="button"
          onClick={() => handleCategorySelect('')}
          className={`px-3 py-2.5 sm:py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
            !selectedCategory
              ? 'bg-neon-yellow text-arcade-950 font-bold'
              : 'bg-arcade-800 text-slate-400 hover:text-slate-200 border border-arcade-700'
          }`}
        >
          Tất cả thể loại
        </button>
        {categories.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => handleCategorySelect(cat.slug)}
            className={`px-3 py-2.5 sm:py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
              selectedCategory === cat.slug
                ? 'bg-neon-yellow text-arcade-950 font-bold'
                : 'bg-arcade-800 text-slate-400 hover:text-slate-200 border border-arcade-700'
            }`}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* Content Area */}
      <div className="mt-5 sm:mt-8">
        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-6">
            {[...Array(8)].map((_, i) => (
              <div
                key={i}
                className="bg-arcade-850/60 border border-arcade-800 rounded-xl overflow-hidden animate-pulse h-72"
              >
                <div className="aspect-[4/3] bg-arcade-800/80" />
                <div className="p-4 space-y-3">
                  <div className="h-4 bg-arcade-700/60 rounded w-3/4" />
                  <div className="h-3 bg-arcade-700/40 rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : games.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-6">
            {games.map((game) => (
              <GameCard key={game.id} game={game} />
            ))}
          </div>
        ) : (
          <div className="text-center py-20 bg-arcade-900/60 rounded-3xl border border-arcade-800">
            <span className="text-5xl">🔍</span>
            <h3 className="text-lg font-bold text-slate-300 mt-4">Không tìm thấy game phù hợp</h3>
            <p className="text-xs text-slate-500 mt-1">
              Hãy thử tìm kiếm với từ khóa khác hoặc xóa bộ lọc thể loại
            </p>
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setFeaturedOnly(false);
                setSelectedCategory('');
                setPage(1);
              }}
              className="inline-block mt-4 text-xs font-bold text-neon-cyan hover:underline"
            >
              Xóa bộ lọc
            </button>
          </div>
        )}
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="mt-12 flex justify-center items-center gap-2">
          {pagination.page > 1 && (
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-4 py-2 bg-arcade-800 border border-arcade-700 rounded-lg text-xs font-bold text-slate-300 hover:border-neon-cyan hover:text-neon-cyan transition-all"
            >
              ← Trang trước
            </button>
          )}

          <span className="px-4 py-2 bg-arcade-900 border border-arcade-800 rounded-lg text-xs font-mono text-slate-400">
            Trang {pagination.page} / {pagination.totalPages}
          </span>

          {pagination.page < pagination.totalPages && (
            <button
              type="button"
              onClick={() => setPage((p) => p + 1)}
              className="px-4 py-2 bg-arcade-800 border border-arcade-700 rounded-lg text-xs font-bold text-slate-300 hover:border-neon-cyan hover:text-neon-cyan transition-all"
            >
              Trang sau →
            </button>
          )}
        </div>
      )}
    </div>
  );
}
