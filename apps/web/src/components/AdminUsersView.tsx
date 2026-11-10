import { useEffect, useState } from 'react';
import type { AdminUser, UserRole, UserStatus } from '@gametuoitho/shared-types';
import { apiRequest } from '../lib/api';

const PAGE_SIZE = 20;
const controlClass = 'rounded-lg border border-arcade-700 bg-arcade-950 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-neon-cyan disabled:opacity-50';
const buttonClass = 'rounded-lg border border-arcade-700 px-3 py-2 text-xs font-bold text-slate-300 hover:border-neon-cyan hover:text-neon-cyan disabled:opacity-40 disabled:cursor-not-allowed';

function formatDate(value: string) {
  const date = new Date(value.endsWith('Z') || value.includes('T') ? value : value.replace(' ', 'T') + 'Z');
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('vi-VN');
}

export default function AdminUsersView() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<UserRole | ''>('');
  const [status, setStatus] = useState<UserStatus | ''>('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [updating, setUpdating] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const query = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
    if (search) query.set('search', search);
    if (role) query.set('role', role);
    if (status) query.set('status', status);
    apiRequest<AdminUser[]>(`/admin/users?${query}`, { signal: controller.signal }).then((res) => {
      if (controller.signal.aborted) return;
      if (res.success && res.data && res.pagination) {
        const lastPage = Math.max(1, res.pagination.totalPages);
        if (page > lastPage) {
          setPage(lastPage);
          return;
        }
        setUsers(res.data);
        setTotal(res.pagination.total);
      } else {
        setUsers([]);
        setError(res.error?.message || 'Không thể tải danh sách người dùng.');
      }
      setLoading(false);
    });
    return () => controller.abort();
  }, [page, search, role, status, revision]);

  async function changeStatus(user: AdminUser) {
    const nextStatus: UserStatus = user.status === 'ACTIVE' ? 'BLOCKED' : 'ACTIVE';
    const action = nextStatus === 'BLOCKED' ? 'Khóa' : 'Mở khóa';
    const detail = nextStatus === 'BLOCKED' ? ' Người dùng sẽ bị đăng xuất và không thể đăng nhập cho đến khi được mở khóa.' : '';
    if (!window.confirm(`${action} tài khoản "${user.username}"?${detail}`)) return;
    setUpdating(user.id);
    setNotice('');
    setError('');
    const res = await apiRequest<AdminUser>(`/admin/users/${encodeURIComponent(user.id)}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status: nextStatus }),
    });
    setUpdating(null);
    if (!res.success) {
      setError(res.error?.message || 'Không thể cập nhật trạng thái tài khoản.');
      return;
    }
    setNotice(`Đã ${action.toLowerCase()} tài khoản "${user.username}".`);
    setRevision((value) => value + 1);
  }

  return (
    <div className="space-y-4">
      <form className="flex flex-wrap items-end gap-3 rounded-2xl border border-arcade-800 bg-arcade-900 p-4" onSubmit={(event) => {
        event.preventDefault();
        setPage(1);
        setSearch(searchDraft.trim());
        setRevision((value) => value + 1);
      }}>
        <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-xs text-slate-400">
          Tìm tài khoản
          <input type="search" maxLength={100} placeholder="Tên tài khoản hoặc email" value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)} className={`${controlClass} w-full`} disabled={!!updating} />
        </label>
        <label className="flex flex-col gap-1.5 text-xs text-slate-400">
          Vai trò
          <select value={role} onChange={(event) => { setRole(event.target.value as UserRole | ''); setPage(1); }} className={controlClass} disabled={!!updating}>
            <option value="">Tất cả vai trò</option>
            <option value="USER">Thành viên</option>
            <option value="ADMIN">Quản trị viên</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-xs text-slate-400">
          Trạng thái
          <select value={status} onChange={(event) => { setStatus(event.target.value as UserStatus | ''); setPage(1); }} className={controlClass} disabled={!!updating}>
            <option value="">Tất cả trạng thái</option>
            <option value="ACTIVE">Đang hoạt động</option>
            <option value="BLOCKED">Đã khóa</option>
          </select>
        </label>
        <button type="submit" className={`${buttonClass} py-2.5`} disabled={!!updating}>Tìm kiếm</button>
      </form>

      {error && <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
        <span>{error}</span>
        <button type="button" className={buttonClass} disabled={loading || !!updating} onClick={() => setRevision((value) => value + 1)}>Tải lại</button>
      </div>}
      {notice && <p role="status" className="rounded-xl border border-neon-green/30 bg-neon-green/10 p-3 text-sm text-neon-green">{notice}</p>}

      <div className="overflow-hidden rounded-2xl border border-arcade-800 bg-arcade-900 shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-xs" aria-busy={loading}>
            <caption className="sr-only">Danh sách tài khoản người dùng</caption>
            <thead className="border-b border-arcade-800 bg-arcade-850 text-[10px] uppercase text-slate-400">
              <tr>
                <th scope="col" className="px-5 py-4">Tài khoản & Email</th>
                <th scope="col" className="px-5 py-4">Vai trò</th>
                <th scope="col" className="px-5 py-4">Trạng thái</th>
                <th scope="col" className="px-5 py-4">Ngày đăng ký</th>
                <th scope="col" className="px-5 py-4 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-arcade-800 text-slate-300">
              {loading ? <tr><td colSpan={5} className="px-5 py-10 text-center text-slate-500">Đang tải người dùng...</td></tr>
                : users.length === 0 ? <tr><td colSpan={5} className="px-5 py-10 text-center text-slate-500">
                  {error ? 'Danh sách người dùng chưa tải được.' : 'Chưa có người dùng phù hợp với bộ lọc.'}
                </td></tr> : users.map((user) => (
                  <tr key={user.id} className="hover:bg-arcade-850/50">
                    <td className="max-w-xs px-5 py-4 break-words">
                      <span className="block font-bold text-slate-100">{user.username}</span>
                      <span className="text-slate-400">{user.email}</span>
                      <details className="mt-2 text-[10px] text-slate-500">
                        <summary className="cursor-pointer hover:text-neon-cyan">Chi tiết tài khoản</summary>
                        <p className="mt-1 break-all">ID: {user.id}</p>
                        <p>Cập nhật: {formatDate(user.updated_at)}</p>
                      </details>
                    </td>
                    <td className="px-5 py-4 whitespace-nowrap">{user.role === 'ADMIN' ? 'Quản trị viên' : 'Thành viên'}</td>
                    <td className="px-5 py-4 whitespace-nowrap">
                      <span className={`rounded-md px-2 py-1 ${user.status === 'ACTIVE' ? 'bg-neon-green/10 text-neon-green' : 'bg-red-500/10 text-red-400'}`}>
                        {user.status === 'ACTIVE' ? 'Đang hoạt động' : 'Đã khóa'}
                      </span>
                    </td>
                    <td className="px-5 py-4 whitespace-nowrap text-slate-400">{formatDate(user.created_at)}</td>
                    <td className="px-5 py-4 text-right whitespace-nowrap">
                      {user.role === 'ADMIN' ? <span className="text-[10px] text-slate-500">Tài khoản quản trị</span>
                        : <button type="button" disabled={!!updating || loading} onClick={() => changeStatus(user)}
                          aria-label={`${user.status === 'ACTIVE' ? 'Khóa' : 'Mở khóa'} tài khoản ${user.username}`}
                          className={buttonClass}>
                          {updating === user.id ? 'Đang lưu...' : user.status === 'ACTIVE' ? 'Khóa tài khoản' : 'Mở khóa'}
                        </button>}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-arcade-800 p-4">
          <p className="text-xs text-slate-400" aria-live="polite">
            {loading ? 'Đang tải...' : error && users.length === 0 ? 'Không thể tải dữ liệu' : `${total} tài khoản · Trang ${page}/${totalPages}`}
          </p>
          <div className="flex gap-2">
            <button type="button" className={buttonClass} disabled={loading || !!updating || !!error || page <= 1} onClick={() => setPage((value) => value - 1)}>← Trước</button>
            <button type="button" className={buttonClass} disabled={loading || !!updating || !!error || page >= totalPages} onClick={() => setPage((value) => value + 1)}>Sau →</button>
          </div>
        </div>
      </div>
    </div>
  );
}
