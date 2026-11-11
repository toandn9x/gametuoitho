import React, { useEffect, useRef, useState } from 'react';

export interface PlayerKeyAction { action: string; keys: { code: string; label: string }[]; }
export interface KeyMappingCommand { operation: 'add' | 'remove' | 'reset'; action?: string; code?: string; }
interface Props {
  actions: PlayerKeyAction[] | null;
  error: string | null;
  ready: boolean;
  onChange: (command: KeyMappingCommand) => void;
  onClose: () => void;
  onOpenFps: () => void;
}
const labels: Record<string, string> = {
  UP: 'Lên', DOWN: 'Xuống', LEFT: 'Trái', RIGHT: 'Phải', OK: 'OK / Chọn',
  SOFT_LEFT: 'Phím mềm trái', SOFT_RIGHT: 'Phím mềm phải', MENU: 'Menu giả lập',
  STAR: 'Phím *', HASH: 'Phím #',
};
const actionLabel = (action: string) => labels[action] || (action.startsWith('KEY_') ? `Phím ${action.slice(4)}` : action);

export default function PlayerSettings({ actions, error, ready, onChange, onClose, onOpenFps }: Props) {
  const [capturing, setCapturing] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState('');
  const modalRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    modalRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => previousFocus?.focus();
  }, []);
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        if (capturing) setCapturing(null); else onClose();
        return;
      }
      if (capturing) {
        event.preventDefault(); event.stopPropagation();
        if (event.repeat || ['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;
        if (event.ctrlKey || event.altKey || event.metaKey || ['Tab', 'F5', 'F12'].includes(event.code)) {
          setCaptureError('Chọn một phím đơn; Esc để hủy.'); return;
        }
        onChange({ operation: 'add', action: capturing, code: event.code });
        setCapturing(null); setCaptureError('');
        return;
      }
      if (event.key === 'Tab') {
        const controls = modalRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])');
        if (!controls?.length) return;
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', handleKey, true);
    return () => document.removeEventListener('keydown', handleKey, true);
  }, [capturing, onChange, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm sm:p-6"
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="player-settings-title"
        className="max-h-[90dvh] w-full max-w-xl overflow-y-auto overscroll-contain rounded-2xl border border-arcade-600 bg-arcade-950 p-4 text-slate-200 shadow-2xl sm:p-6">
        <div className="mb-5 flex items-center justify-between gap-3">
          <h2 id="player-settings-title" className="text-lg font-bold">Cài đặt phím và FPS</h2>
          <button type="button" onClick={onClose} aria-label="Đóng cài đặt" className="rounded-lg border border-arcade-600 px-3 py-2">✕</button>
        </div>
        <section className="mb-5 rounded-xl border border-arcade-700 bg-arcade-900 p-4">
          <h3 className="font-bold">Giới hạn FPS</h3>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">Mở menu giả lập, chọn <strong className="text-slate-200">Limit FPS</strong>, rồi chọn Auto, 60, 30 hoặc 15. Thử 30 hoặc 15 nếu máy chạy chậm.</p>
          <button type="button" onClick={onOpenFps} disabled={!ready} className="mt-3 rounded-lg bg-neon-cyan px-4 py-2.5 text-sm font-bold text-arcade-950 disabled:opacity-50">Mở cài đặt FPS</button>
          {!ready && <p className="mt-2 text-xs text-slate-400">Menu FPS sẵn sàng sau khi game khởi động.</p>}
        </section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-bold">Phím trên bàn phím máy tính</h3>
          <button type="button" disabled={!actions} onClick={() => { setCapturing(null); onChange({ operation: 'reset' }); }}
            className="rounded-lg border border-arcade-600 px-3 py-2 text-xs text-neon-cyan disabled:opacity-50">Khôi phục phím mặc định</button>
        </div>
        <p className="mb-4 text-xs leading-relaxed text-slate-400">Chọn “Thêm phím” rồi nhấn phím muốn dùng. Phím trùng sẽ chuyển sang chức năng mới. Cấu hình được nhớ trên trình duyệt này; các nút cảm ứng giữ nguyên chức năng.</p>
        <p className="mb-4 text-xs leading-relaxed text-slate-400">Bỏ phím cuối cùng của một chức năng sẽ khôi phục phím mặc định và chuyển phím đó về chức năng này nếu đang được gán ở nơi khác.</p>
        {capturing && <div role="status" className="sticky top-0 z-10 mb-4 rounded-xl border border-neon-cyan bg-arcade-900 p-3 text-sm">
          Nhấn phím cho <strong>{actionLabel(capturing)}</strong> · Esc để hủy.
          {captureError && <p className="mt-2 text-neon-yellow">{captureError}</p>}
          <button type="button" onClick={() => setCapturing(null)} className="ml-3 underline">Hủy gán phím</button>
        </div>}
        {error && <p role="alert" className="mb-3 text-sm text-red-300">{error}</p>}
        {!actions ? <p role="status" className="py-5 text-sm text-slate-400">Đang kết nối bộ điều khiển giả lập…</p> : (
          <div className="space-y-2">
            {actions.map(action => <div key={action.action} className="rounded-xl border border-arcade-800 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{actionLabel(action.action)}</span>
                <button type="button" onClick={() => { setCapturing(action.action); setCaptureError(''); }}
                  aria-label={`Thêm phím cho ${actionLabel(action.action)}`} className="rounded-lg border border-arcade-600 px-3 py-2 text-xs text-neon-cyan">Thêm phím</button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {action.keys.map(key => <span key={key.code} className="inline-flex items-center gap-1 rounded-lg bg-arcade-800 pl-2 text-xs">
                  <kbd>{key.label}</kbd>
                  <button type="button" aria-label={`Bỏ phím ${key.label} khỏi ${actionLabel(action.action)}`}
                    onClick={() => onChange({ operation: 'remove', action: action.action, code: key.code })} className="min-h-8 min-w-8 rounded-lg text-slate-400 hover:text-red-300">×</button>
                </span>)}
              </div>
            </div>)}
          </div>
        )}
      </div>
    </div>
  );
}
