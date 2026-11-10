import React, { useEffect, useState } from 'react';
import { getCrawlerGames, importCrawlerGame, batchImportCrawlerGames } from '../lib/api';

interface SourceGame {
  id: string;
  source_key?: string;
  name: string;
  developer: string;
  category: string;
  categoryKey: string;
  year: number;
  icon: string;
  filename: string;
  description: string;
  phone?: string;
  width?: number;
  height?: number;
  is_imported?: boolean;
  imported_slug?: string;
  /** Slug of a catalog game with the same name (a different file of this entry is already imported). */
  same_name_slug?: string;
}

const getGameKey = (g: SourceGame): string => g.source_key || g.id;

/** 409 reasons from the server that mean "this entry is already in the catalog". */
const ALREADY_IN_CATALOG = new Set(['ALREADY_IMPORTED', 'SAME_FILE']);

export default function AdminCrawlerView() {
  const [games, setGames] = useState<SourceGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 3357, page: 1, limit: 24, totalPages: 140 });

  // Multi-select state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [importingId, setImportingId] = useState<string | null>(null);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchProgressText, setBatchProgressText] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  // Per-game outcome of the last batch import, shown until dismissed.
  const [batchReport, setBatchReport] = useState<{ name: string; status: 'imported' | 'skipped' | 'failed'; detail?: string }[] | null>(null);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  };

  const fetchGames = (p = page, q = search, cat = selectedCategory) => {
    setLoading(true);
    getCrawlerGames({
      search: q || undefined,
      category: cat !== 'all' ? cat : undefined,
      page: p,
      limit: 24,
    })
      .then((res) => {
        if (res.success && res.data) {
          setGames(res.data);
          if (res.pagination) {
            setPagination(res.pagination);
          }
        } else {
          showToast(res.error?.message || 'Không thể tải danh sách game nguồn', 'error');
        }
      })
      .catch((err) => {
        showToast(err.message || 'Lỗi kết nối máy chủ', 'error');
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchGames(page, search, selectedCategory);
  }, [page, selectedCategory]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchGames(1, search, selectedCategory);
  };

  const handleCategorySelect = (cat: string) => {
    setSelectedCategory(cat);
    setPage(1);
  };

  // Toggle selection for a single game
  const toggleSelectGame = (gameId: string, isImported = false) => {
    if (isImported) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(gameId)) {
        next.delete(gameId);
      } else {
        next.add(gameId);
      }
      return next;
    });
  };

  // Select / Deselect all unimported games on the current page
  const unimportedOnPage = games.filter((g) => !g.is_imported);
  const allPageSelected =
    unimportedOnPage.length > 0 && unimportedOnPage.every((g) => selectedIds.has(getGameKey(g)));

  const toggleSelectAllPage = () => {
    if (allPageSelected) {
      // Uncheck all on current page
      setSelectedIds((prev) => {
        const next = new Set(prev);
        unimportedOnPage.forEach((g) => next.delete(getGameKey(g)));
        return next;
      });
    } else {
      // Check all on current page
      setSelectedIds((prev) => {
        const next = new Set(prev);
        unimportedOnPage.forEach((g) => next.add(getGameKey(g)));
        return next;
      });
    }
  };

  // Quick select first 10 unimported games on the page
  const selectFirst10 = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      unimportedOnPage.slice(0, 10).forEach((g) => next.add(getGameKey(g)));
      return next;
    });
  };

  // Card state after an import attempt: in the catalog now, or a same-name game exists.
  const markImported = (key: string, slug?: string) => {
    setGames((prev) =>
      prev.map((g) => (getGameKey(g) === key ? { ...g, is_imported: true, imported_slug: slug, same_name_slug: undefined } : g))
    );
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  };
  const markSameName = (key: string, slug?: string) => {
    setGames((prev) => prev.map((g) => (getGameKey(g) === key ? { ...g, same_name_slug: slug } : g)));
  };

  // Single game import
  const handleImportSingle = async (sourceGame: SourceGame) => {
    const key = getGameKey(sourceGame);
    let allowSameName = false;
    if (sourceGame.same_name_slug) {
      allowSameName = confirm(
        `Kho đã có game cùng tên "${sourceGame.name}" (${sourceGame.same_name_slug}).\n` +
          `Bản này là một file khác (${sourceGame.filename}). Vẫn nhập thêm thành một game riêng?`
      );
      if (!allowSameName) return;
    }
    setImportingId(key);
    try {
      const res = await importCrawlerGame(key, { allowSameName });
      const importedData = res.data;
      const reason = (res.error as any)?.reason as string | undefined;
      const existingSlug = (res.error as any)?.slug as string | undefined;
      if (res.success && importedData) {
        const note = importedData.warnings?.length ? ' (không lấy được ảnh bìa, dùng ảnh mặc định)' : '';
        showToast(`Đã nhập thành công game "${sourceGame.name}" vào Catalog!${note}`, 'success');
        markImported(key, importedData.game.slug);
      } else if (reason && ALREADY_IN_CATALOG.has(reason)) {
        markImported(key, existingSlug);
        showToast(`"${sourceGame.name}" đã có trong kho, không nhập lại.`, 'success');
      } else if (reason === 'SAME_NAME') {
        markSameName(key, existingSlug);
        showToast(res.error?.message || 'Kho đã có game cùng tên.', 'error');
      } else {
        showToast(res.error?.message || 'Nhập game thất bại', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Lỗi khi nhập game', 'error');
    } finally {
      setImportingId(null);
    }
  };

  // Bulk Import Selected Games
  const handleBatchImportSelected = async () => {
    const idsToImport = Array.from(selectedIds);
    if (idsToImport.length === 0) {
      showToast('Vui lòng tích chọn ít nhất 1 game để nhập hàng loạt', 'error');
      return;
    }

    if (!confirm(`Bạn có chắc chắn muốn nhập tự động ${idsToImport.length} game đã chọn vào hệ thống?\nGame đã có trong kho hoặc trùng tên sẽ được bỏ qua.`)) {
      return;
    }

    setBatchLoading(true);
    setBatchReport(null);
    let successCount = 0;
    let existingCount = 0;
    let sameNameCount = 0;
    let failCount = 0;
    const report: NonNullable<typeof batchReport> = [];

    for (let i = 0; i < idsToImport.length; i++) {
      const key = idsToImport[i];
      const gameObj = games.find((g) => getGameKey(g) === key);
      const gameName = gameObj ? gameObj.name : key;
      setBatchProgressText(`Đang nhập (${i + 1}/${idsToImport.length}): ${gameName}...`);

      try {
        const res = await importCrawlerGame(key);
        const importedData = res.data;
        const reason = (res.error as any)?.reason as string | undefined;
        const existingSlug = (res.error as any)?.slug as string | undefined;
        if (res.success && importedData) {
          successCount++;
          markImported(key, importedData.game.slug);
          report.push({ name: gameName, status: 'imported', detail: importedData.warnings?.join(' ') });
        } else if (reason && ALREADY_IN_CATALOG.has(reason)) {
          existingCount++;
          markImported(key, existingSlug);
          report.push({ name: gameName, status: 'skipped', detail: res.error?.message || 'Đã có trong kho' });
        } else if (reason === 'SAME_NAME') {
          sameNameCount++;
          markSameName(key, existingSlug);
          report.push({ name: gameName, status: 'skipped', detail: res.error?.message || 'Trùng tên với game trong kho' });
        } else {
          failCount++;
          report.push({ name: gameName, status: 'failed', detail: res.error?.message || 'Lỗi không xác định' });
        }
      } catch (err: any) {
        failCount++;
        report.push({ name: gameName, status: 'failed', detail: err?.message || 'Lỗi kết nối' });
      }
    }
    setBatchReport(report);

    setBatchLoading(false);
    setBatchProgressText('');
    setSelectedIds(new Set());

    const parts = [`Đã nhập thành công ${successCount} game`];
    if (existingCount > 0) parts.push(`bỏ qua ${existingCount} game đã có trong kho`);
    if (sameNameCount > 0) parts.push(`bỏ qua ${sameNameCount} game trùng tên`);
    if (failCount > 0) parts.push(`lỗi ${failCount} game`);
    showToast(`Hoàn tất! ${parts.join(', ')}.`, failCount > 0 && successCount === 0 ? 'error' : 'success');

    // Re-read the page from the server so every card reflects the catalog.
    fetchGames(page, search, selectedCategory);
  };

  // Top 5 preset
  const handleBatchImportTop = async () => {
    if (!confirm('Bạn có muốn tự động tải và nhập 5 tựa game kinh điển hàng đầu vào hệ thống?')) return;
    setBatchLoading(true);
    const topIds = ['DiamondRush', 'BounceTales', 'NinjaSchool2', 'PrinceOfPersia', 'Worms'];
    try {
      const res = await batchImportCrawlerGames(topIds);
      if (res.success && res.data) {
        showToast(
          `Hoàn tất! Đã nhập thành công ${res.data.importedCount} game, bỏ qua (đã có/trùng tên): ${res.data.skippedCount ?? 0}, lỗi: ${res.data.errorCount}.`,
          'success'
        );
        fetchGames(page, search, selectedCategory);
      } else {
        showToast(res.error?.message || 'Lỗi khi nhập hàng loạt', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Lỗi khi nhập hàng loạt', 'error');
    } finally {
      setBatchLoading(false);
    }
  };

  const categories = [
    { key: 'all', label: 'Tất cả' },
    { key: 'nhập vai', label: 'Nhập vai (RPG)' },
    { key: 'hành động', label: 'Hành động' },
    { key: 'phiêu lưu', label: 'Phiêu lưu' },
    { key: 'chiến thuật', label: 'Chiến thuật' },
    { key: 'trí tuệ', label: 'Trí tuệ / Giải đố' },
    { key: 'thể thao', label: 'Đua xe / Thể thao' },
    { key: 'việt hóa', label: 'Game Việt Hóa' },
  ];

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-5 py-3 rounded-xl shadow-2xl text-xs font-bold flex items-center gap-3 border ${
            toast.type === 'success'
              ? 'bg-neon-green/10 text-neon-green border-neon-green/40 backdrop-blur-md'
              : 'bg-neon-pink/10 text-neon-pink border-neon-pink/40 backdrop-blur-md'
          }`}
        >
          <span>{toast.type === 'success' ? '✓' : '⚠️'}</span>
          <span>{toast.message}</span>
        </div>
      )}

      {/* Header Banner */}
      <div className="bg-gradient-to-r from-neon-cyan/15 via-arcade-850 to-neon-pink/15 border border-arcade-800 rounded-3xl p-6 lg:p-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <span className="text-xs font-mono font-bold text-neon-cyan uppercase tracking-wider bg-neon-cyan/20 px-2.5 py-1 rounded-full border border-neon-cyan/30">
            Nguồn Ngoài: gametuoitho.cc
          </span>
          <h2 className="text-2xl font-black text-slate-100 flex items-center gap-2 mt-2">
            <span>🕷️</span>
            <span>Trình Nhập Game Cực Nhanh (Crawler)</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Duyệt hơn 3.350 tựa game Java Nokia từ gametuoitho.cc. Tải tự động file JAR, icon và nạp thẳng vào Catalog!
          </p>
        </div>

        <button
          onClick={handleBatchImportTop}
          disabled={batchLoading}
          className="px-5 py-3 bg-neon-yellow hover:bg-neon-cyan text-arcade-950 font-black rounded-xl text-xs transition-all flex items-center gap-2 shadow-lg disabled:opacity-50 flex-shrink-0"
        >
          {batchLoading && !batchProgressText ? (
            <>
              <div className="w-3.5 h-3.5 border-2 border-arcade-950 border-t-transparent rounded-full animate-spin" />
              <span>Đang xử lý...</span>
            </>
          ) : (
            <>
              <span>⚡</span>
              <span>Tự Động Nhập Top 5 Game Hot</span>
            </>
          )}
        </button>
      </div>

      {/* Search & Filter Controls */}
      <div className="bg-arcade-900 border border-arcade-800 rounded-2xl p-5 space-y-4">
        <form onSubmit={handleSearchSubmit} className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm theo tên game (vd: Ninja School, Contra, Diamond Rush, Đặt bom, AoE, Tam Quốc...)"
              className="w-full bg-arcade-800 border border-arcade-700 focus:border-neon-cyan rounded-xl px-4 py-2.5 text-xs text-slate-100 placeholder-slate-400 focus:outline-none"
            />
            {search && (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  fetchGames(1, '', selectedCategory);
                }}
                className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-200 text-xs"
              >
                ✕
              </button>
            )}
          </div>

          <button
            type="submit"
            className="px-6 py-2.5 bg-neon-cyan text-arcade-950 font-bold rounded-xl text-xs hover:bg-neon-yellow transition-all flex items-center justify-center gap-1.5"
          >
            <span>🔍</span>
            <span>Tìm Kiếm</span>
          </button>
        </form>

        {/* Category Pills */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none text-xs">
          {categories.map((c) => (
            <button
              key={c.key}
              onClick={() => handleCategorySelect(c.key)}
              className={`px-3 py-1.5 rounded-full whitespace-nowrap transition-all font-semibold ${
                selectedCategory === c.key
                  ? 'bg-neon-pink text-arcade-950 font-bold'
                  : 'bg-arcade-800 text-slate-400 hover:text-slate-200 border border-arcade-700'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Bulk Action & Multi-select Toolbar */}
      <div className="bg-arcade-850 border border-arcade-700/80 rounded-2xl p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shadow-md">
        <div className="flex flex-wrap items-center gap-3">
          {/* Select all on page checkbox */}
          <label className="flex items-center gap-2.5 cursor-pointer text-xs font-bold text-slate-200 select-none bg-arcade-800/80 px-3 py-2 rounded-xl border border-arcade-700 hover:border-slate-500 transition-colors">
            <input
              type="checkbox"
              checked={allPageSelected}
              disabled={unimportedOnPage.length === 0}
              onChange={toggleSelectAllPage}
              className="w-4 h-4 rounded text-neon-pink bg-arcade-900 border-arcade-600 focus:ring-neon-pink cursor-pointer"
            />
            <span>
              Chọn tất cả trên trang này ({unimportedOnPage.length} game chưa có)
            </span>
          </label>

          {/* Quick select 10 button */}
          {unimportedOnPage.length > 5 && (
            <button
              type="button"
              onClick={selectFirst10}
              className="text-xs bg-arcade-800 hover:bg-arcade-700 text-slate-300 px-3 py-2 rounded-xl border border-arcade-700 transition-colors"
            >
              + Chọn 10 game đầu
            </button>
          )}

          {/* Deselect all */}
          {selectedIds.size > 0 && (
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="text-xs text-slate-400 hover:text-red-400 transition-colors underline ml-1"
            >
              Bỏ chọn ({selectedIds.size})
            </button>
          )}
        </div>

        {/* Bulk Action CTA */}
        <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-end">
          <div className="text-xs font-mono">
            {selectedIds.size > 0 ? (
              <span className="text-neon-yellow font-bold">
                Đã tích chọn: <strong className="text-base text-neon-cyan">{selectedIds.size}</strong> game
              </span>
            ) : (
              <span className="text-slate-500">Tích chọn các ô vuông để duyệt nhiều game</span>
            )}
          </div>

          <button
            type="button"
            onClick={handleBatchImportSelected}
            disabled={selectedIds.size === 0 || batchLoading}
            className={`px-5 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 shadow-neon-pink ${
              selectedIds.size > 0 && !batchLoading
                ? 'bg-gradient-to-r from-neon-pink via-neon-yellow to-neon-cyan text-arcade-950 hover:scale-105 cursor-pointer'
                : 'bg-arcade-800 text-slate-500 border border-arcade-700 cursor-not-allowed opacity-60'
            }`}
          >
            {batchLoading ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-arcade-950 border-t-transparent rounded-full animate-spin" />
                <span>{batchProgressText || `Đang nạp ${selectedIds.size} game...`}</span>
              </>
            ) : (
              <>
                <span>⚡</span>
                <span>Duyệt & Nhập Hàng Loạt ({selectedIds.size})</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Result of the last batch import: one line per game, with the reason when it was not imported */}
      {batchReport && batchReport.length > 0 && (
        <div id="batch-report" className="bg-arcade-900 border border-arcade-700 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-slate-100">
              Kết quả nhập hàng loạt:{' '}
              <span className="text-neon-green">{batchReport.filter((r) => r.status === 'imported').length} đã nhập</span>
              {' · '}
              <span className="text-neon-yellow">{batchReport.filter((r) => r.status === 'skipped').length} bỏ qua</span>
              {' · '}
              <span className="text-red-400">{batchReport.filter((r) => r.status === 'failed').length} lỗi</span>
            </h3>
            <button
              type="button"
              onClick={() => setBatchReport(null)}
              className="flex-shrink-0 px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white hover:bg-arcade-800"
            >
              Đóng ✕
            </button>
          </div>
          <ul className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
            {batchReport.map((r, i) => (
              <li key={i} className="flex items-start gap-2 text-xs">
                <span
                  className={`flex-shrink-0 w-16 text-center px-1.5 py-0.5 rounded font-bold ${
                    r.status === 'imported'
                      ? 'bg-neon-green/15 text-neon-green'
                      : r.status === 'skipped'
                      ? 'bg-neon-yellow/15 text-neon-yellow'
                      : 'bg-red-500/15 text-red-400'
                  }`}
                >
                  {r.status === 'imported' ? 'Đã nhập' : r.status === 'skipped' ? 'Bỏ qua' : 'Lỗi'}
                </span>
                <span className="min-w-0">
                  <span className="font-semibold text-slate-200">{r.name}</span>
                  {r.detail && <span className="text-slate-400"> — {r.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Stats bar */}
      <div className="flex items-center justify-between text-xs text-slate-400 px-1 font-mono">
        <span>Tìm thấy: <strong className="text-neon-cyan">{pagination.total}</strong> game phù hợp</span>
        <span>Trang {pagination.page} / {pagination.totalPages}</span>
      </div>

      {/* Games Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="bg-arcade-900 border border-arcade-800 rounded-2xl p-4 animate-pulse h-48 flex flex-col justify-between">
              <div className="flex gap-3">
                <div className="w-16 h-16 bg-arcade-800 rounded-xl" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-arcade-800 rounded w-3/4" />
                  <div className="h-3 bg-arcade-800 rounded w-1/2" />
                </div>
              </div>
              <div className="h-8 bg-arcade-800 rounded-lg" />
            </div>
          ))}
        </div>
      ) : games.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {games.map((g) => {
            const key = getGameKey(g);
            const isImporting = importingId === key;
            const isSelected = selectedIds.has(key);
            const fullIconUrl = g.icon.startsWith('http')
              ? g.icon
              : `https://gametuoitho.cc${g.icon}`;

            return (
              <div
                key={key}
                onClick={(e) => {
                  // If clicking on buttons or links, don't toggle card
                  if ((e.target as HTMLElement).closest('button, a')) return;
                  if (!g.is_imported) {
                    toggleSelectGame(key, g.is_imported);
                  }
                }}
                className={`relative bg-arcade-900 border rounded-2xl p-4 flex flex-col justify-between transition-all duration-200 select-none ${
                  g.is_imported
                    ? 'border-neon-green/30 bg-arcade-900/90 opacity-90'
                    : isSelected
                    ? 'border-neon-pink ring-2 ring-neon-pink/40 bg-arcade-850 shadow-neon-pink cursor-pointer'
                    : 'border-arcade-800 hover:border-arcade-600 cursor-pointer'
                }`}
              >
                {/* Checkbox indicator */}
                <div className="absolute top-3 right-3 z-10">
                  {g.is_imported ? (
                    <span
                      title="Game này đã được nhập vào kho của bạn"
                      className="w-5 h-5 rounded-md bg-neon-green/20 text-neon-green border border-neon-green/50 flex items-center justify-center text-xs font-bold"
                    >
                      ✓
                    </span>
                  ) : (
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelectGame(key, g.is_imported)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-5 h-5 rounded text-neon-pink bg-arcade-950 border-2 border-arcade-600 focus:ring-neon-pink cursor-pointer"
                    />
                  )}
                </div>

                <div>
                  <div className="flex gap-3 items-start pr-6">
                    {/* Icon */}
                    <div className="w-14 h-14 rounded-xl overflow-hidden bg-arcade-950 border border-arcade-700/60 flex-shrink-0 relative">
                      <img
                        src={fullIconUrl}
                        alt={g.name}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                    </div>

                    {/* Meta */}
                    <div className="min-w-0 flex-1">
                      <h3 className="font-bold text-slate-100 text-sm truncate" title={g.name}>
                        {g.name}
                      </h3>
                      <p className="text-[11px] text-slate-400 truncate mt-0.5">
                        {g.developer} • {g.year}
                      </p>
                      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                        <span className="text-[10px] bg-arcade-800 border border-arcade-700 text-neon-yellow px-1.5 py-0.5 rounded font-mono">
                          {g.category}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {g.width}x{g.height}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Filename tag */}
                  <div className="mt-3 py-1 px-2 bg-arcade-950/70 rounded border border-arcade-800 text-[10px] font-mono text-slate-400 truncate">
                    📁 {g.filename}
                  </div>

                  {!g.is_imported && g.same_name_slug && (
                    <div className="mt-2 py-1 px-2 rounded border border-neon-yellow/40 bg-neon-yellow/10 text-[10px] text-neon-yellow leading-snug">
                      ⚠ Kho đã có game cùng tên (
                      <a href={`/game/${encodeURIComponent(g.same_name_slug)}`} target="_blank" rel="noreferrer" className="underline font-mono">
                        {g.same_name_slug}
                      </a>
                      ). Nhập hàng loạt sẽ bỏ qua bản này.
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="mt-4 pt-3 border-t border-arcade-800 flex items-center justify-between gap-2">
                  {g.is_imported ? (
                    <>
                      <span className="text-neon-green text-xs font-bold flex items-center gap-1">
                        <span>✓</span>
                        <span>Đã có trong kho</span>
                      </span>
                      <a
                        href={`/play/${g.imported_slug || g.id.toLowerCase()}`}
                        target="_blank"
                        rel="noreferrer"
                        className="px-3 py-1.5 bg-neon-cyan/20 hover:bg-neon-cyan text-neon-cyan hover:text-arcade-950 border border-neon-cyan/40 rounded-lg text-xs font-bold transition-all"
                      >
                        ▶ Chơi ngay
                      </a>
                    </>
                  ) : (
                    <div className="flex items-center gap-2 w-full">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSelectGame(key, g.is_imported);
                        }}
                        className={`py-2 px-2.5 rounded-lg text-xs font-semibold transition-all border ${
                          isSelected
                            ? 'bg-neon-pink/20 text-neon-pink border-neon-pink'
                            : 'bg-arcade-800 text-slate-300 border-arcade-700 hover:border-slate-500'
                        }`}
                      >
                        {isSelected ? '✓ Đã chọn' : '+ Chọn'}
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleImportSingle(g);
                        }}
                        disabled={isImporting || batchLoading}
                        className="flex-1 py-2 px-3 bg-neon-cyan hover:bg-neon-yellow text-arcade-950 font-bold rounded-lg text-xs transition-all flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-50"
                      >
                        {isImporting ? (
                          <>
                            <div className="w-3 h-3 border-2 border-arcade-950 border-t-transparent rounded-full animate-spin" />
                            <span>Đang nạp...</span>
                          </>
                        ) : (
                          <>
                            <span>📥</span>
                            <span>Nhập 1 Game</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="py-20 text-center bg-arcade-900 border border-arcade-800 rounded-3xl">
          <span className="text-5xl">🔍</span>
          <h3 className="text-base font-bold text-slate-300 mt-3">Không tìm thấy tựa game nào</h3>
          <p className="text-xs text-slate-500 mt-1">Hãy thử tìm kiếm với từ khóa khác</p>
        </div>
      )}

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="mt-8 flex justify-center items-center gap-2">
          <button
            type="button"
            disabled={pagination.page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="px-4 py-2 bg-arcade-900 border border-arcade-800 rounded-lg text-xs font-bold text-slate-300 hover:border-neon-cyan hover:text-neon-cyan transition-all disabled:opacity-40"
          >
            ← Trang trước
          </button>

          <span className="px-4 py-2 bg-arcade-900 border border-arcade-800 rounded-lg text-xs font-mono text-slate-400">
            Trang {pagination.page} / {pagination.totalPages}
          </span>

          <button
            type="button"
            disabled={pagination.page >= pagination.totalPages}
            onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
            className="px-4 py-2 bg-arcade-900 border border-arcade-800 rounded-lg text-xs font-bold text-slate-300 hover:border-neon-cyan hover:text-neon-cyan transition-all disabled:opacity-40"
          >
            Trang sau →
          </button>
        </div>
      )}
    </div>
  );
}
