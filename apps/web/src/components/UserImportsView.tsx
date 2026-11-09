import React, { useState, useEffect } from 'react';
import { getUserImports, uploadJarFile, removeGameFromLibrary } from '../lib/api';
import { UserLibraryItem } from '@gametuoitho/shared-types';

export default function UserImportsView() {
  const [imports, setImports] = useState<UserLibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [customName, setCustomName] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadData = () => {
    getUserImports()
      .then((res) => {
        if (res.success && res.data) {
          setImports(res.data);
        }
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (!file.name.toLowerCase().endsWith('.jar')) {
        setError('Vui lòng chọn file có định dạng .jar');
        setSelectedFile(null);
        return;
      }
      setSelectedFile(file);
      if (!customName) {
        // Auto-fill custom name from filename
        const baseName = file.name.replace(/\.[^/.]+$/, '');
        setCustomName(baseName);
      }
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      setError('Vui lòng chọn file JAR');
      return;
    }
    if (!customName.trim()) {
      setError('Vui lòng nhập tên cho game');
      return;
    }

    setUploading(true);
    setError(null);
    setSuccess(null);

    try {
      await uploadJarFile(selectedFile, customName.trim());
      setSuccess(`Đã import thành công "${customName}"!`);
      setSelectedFile(null);
      setCustomName('');
      const fileInput = document.getElementById('jar-file-input') as HTMLInputElement;
      if (fileInput) fileInput.value = '';
      loadData();
    } catch (err: any) {
      setError(err.message || 'Lỗi khi import file');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Bạn có chắc chắn muốn xóa game "${name}"? File sẽ bị gỡ khỏi tài khoản.`)) return;
    try {
      const res = await removeGameFromLibrary(id);
      if (res.success) {
        setImports(imports.filter((item) => item.id !== id));
      } else {
        alert(res.error?.message || 'Xóa thất bại');
      }
    } catch {
      alert('Đã xảy ra lỗi');
    }
  };

  return (
    <div className="space-y-10">
      {/* Upload Box */}
      <div className="bg-arcade-900 border-2 border-dashed border-neon-cyan/40 rounded-3xl p-6 sm:p-8">
        <h2 className="text-lg font-black text-slate-100 flex items-center gap-2 mb-2">
          <span className="text-neon-cyan">📤</span>
          <span>Tải Lên File JAR Của Bạn</span>
        </h2>
        <p className="text-xs text-slate-400 mb-6">
          File được lưu riêng tư trong tài khoản của bạn, chỉ bạn mới có thể chơi và quản lý.
        </p>

        {error && (
          <div className="p-3 mb-4 bg-red-500/20 border border-red-500 text-red-200 text-xs rounded-lg font-medium">
            {error}
          </div>
        )}
        {success && (
          <div className="p-3 mb-4 bg-neon-green/20 border border-neon-green text-neon-green text-xs rounded-lg font-medium">
            {success}
          </div>
        )}

        <form onSubmit={handleUpload} className="space-y-4 max-w-xl">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Chọn File .JAR từ thiết bị
            </label>
            <input
              type="file"
              id="jar-file-input"
              accept=".jar"
              onChange={handleFileChange}
              required
              className="w-full bg-arcade-800 border border-arcade-700 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-neon-cyan file:text-arcade-950 hover:file:bg-neon-yellow rounded-xl p-2 text-xs text-slate-300"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Tên hiển thị của trò chơi
            </label>
            <input
              type="text"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder="vd: Ninja School 2, Tam Quốc Chí, v.v."
              required
              className="w-full bg-arcade-800 border border-arcade-700 focus:border-neon-cyan rounded-xl px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={uploading || !selectedFile}
            className="px-6 py-2.5 bg-neon-cyan hover:bg-neon-yellow disabled:opacity-50 text-arcade-950 font-black rounded-xl text-xs uppercase tracking-wider transition-all shadow-neon-cyan"
          >
            {uploading ? 'ĐANG TẢI LÊN VÀ KIỂM TRA...' : 'BẮT ĐẦU IMPORT'}
          </button>
        </form>
      </div>

      {/* Uploaded Games List */}
      <div>
        <h2 className="text-xl font-black text-slate-100 mb-4 flex items-center gap-2">
          <span>📦</span>
          <span>Danh Sách Game Đã Import ({imports.length})</span>
        </h2>

        {loading ? (
          <div className="space-y-3 animate-pulse">
            {[1, 2].map((n) => (
              <div key={n} className="h-16 bg-arcade-850 rounded-xl border border-arcade-800" />
            ))}
          </div>
        ) : imports.length === 0 ? (
          <div className="text-center py-12 bg-arcade-900 rounded-2xl border border-arcade-800">
            <p className="text-xs text-slate-400">Bạn chưa import file game nào.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {imports.map((item: any) => (
              <div
                key={item.id}
                className="bg-arcade-900 border border-arcade-800 hover:border-neon-cyan/40 p-4 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition-all"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-200 text-sm">{item.custom_name}</span>
                    <span className="text-[10px] bg-neon-yellow/20 text-neon-yellow border border-neon-yellow/30 px-1.5 py-0.2 rounded font-mono">
                      PRIVATE
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-slate-400 font-mono mt-1">
                    <span>File: {item.custom_original_filename}</span>
                    <span>•</span>
                    <span>{((item.custom_file_size || 0) / 1024).toFixed(0)} KB</span>
                    <span>•</span>
                    <span>{new Date(item.created_at).toLocaleDateString('vi-VN')}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto">
                  {item.jar_url && (
                    <a
                      href={`/play/custom?importId=${encodeURIComponent(item.id)}`}
                      className="flex-1 sm:flex-none px-4 py-2 bg-neon-cyan hover:bg-neon-yellow text-arcade-950 font-bold text-xs rounded-lg transition-all text-center"
                    >
                      ▶ Chơi ngay
                    </a>
                  )}
                  <button
                    onClick={() => handleDelete(item.id, item.custom_name)}
                    className="px-3 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg text-xs transition-colors"
                  >
                    Xóa
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
