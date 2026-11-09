import React, { useState, useEffect, useRef } from 'react';
import { recordPlay, reportGameCrash } from '../lib/api';
import { Game, GameVersion } from '@gametuoitho/shared-types';
import { DEFAULT_KEY_MAPPINGS, KEYBOARD_HINT_MESSAGE, DEFAULT_KEYS_NOTE } from '../constants/keyMapping';
import './Nokia1280.css';

export interface EmulatorPlayerProps {
  game?: Game;
  gameId?: string;
  gameName?: string;
  activeVersion?: GameVersion;
  versions?: GameVersion[];
  jarUrl?: string;
  directBytes?: ArrayBuffer | Uint8Array | null;
  initialPhoneType?: string;
}

export default function EmulatorPlayer({
  game,
  gameId,
  gameName,
  activeVersion,
  jarUrl,
  directBytes,
}: EmulatorPlayerProps) {
  const effectiveGameId = gameId || game?.id || '';
  const effectiveGameName = gameName || game?.name || 'Trò chơi';
  const effectiveJarUrl = jarUrl || activeVersion?.jar_url || '';

  const [skin, setSkin] = useState<'nokia' | 'arcade' | 'clean'>('nokia');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showKeyGuide, setShowKeyGuide] = useState(false);
  const [emulatorError, setEmulatorError] = useState<string | null>(null);
  const [crashReportStatus, setCrashReportStatus] = useState<string | null>(null);

  // Crash report modal states
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportType, setReportType] = useState('CRASH');
  const [reportDetails, setReportDetails] = useState('');
  const [isSendingReport, setIsSendingReport] = useState(false);
  const [reportSuccessMsg, setReportSuccessMsg] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const crashReportedRef = useRef(false);
  const handleEmulatorLoad = () => {
    crashReportedRef.current = false;
    setEmulatorError(null);
    setCrashReportStatus(null);
  };

  useEffect(() => {
    // Record play history
    if (effectiveGameId) {
      recordPlay(effectiveGameId).catch(() => {});
    }
  }, [effectiveGameId]);

  // Handle messages from emulator iframe
  useEffect(() => {
    const handleMsg = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== iframeRef.current?.contentWindow) return;
      if (!event.data || typeof event.data !== 'object') return;

      if (event.data.type === 'EMULATOR_READY' && directBytes) {
        if (!iframeRef.current?.contentWindow) return;
        const bytesToSend =
          directBytes instanceof Uint8Array
            ? directBytes.buffer.slice(
                directBytes.byteOffset,
                directBytes.byteOffset + directBytes.byteLength
              )
            : directBytes.slice(0);
        iframeRef.current.contentWindow.postMessage(
          { type: 'LOAD_GAME_BYTES', bytes: bytesToSend },
          window.location.origin,
          [bytesToSend]
        );
      } else if (event.data.type === 'EMULATOR_ERROR') {
        if (crashReportedRef.current) return;
        crashReportedRef.current = true;
        const errMsg = typeof event.data.message === 'string' && event.data.message.trim()
          ? event.data.message.slice(0, 1000) : 'Trình giả lập gặp lỗi khi chạy game.';
        setEmulatorError(errMsg);
        setCrashReportStatus('Đang gửi log lỗi…');

        // Auto-report error to server
        reportGameCrash({
          game_id: effectiveGameId || undefined,
          game_version_id: activeVersion?.id,
          game_name: effectiveGameName,
          game_slug: game?.slug || undefined,
          error_type: ['LOAD_FAILED', 'CRASH', 'EMULATOR_ERROR', 'CORRUPT_JAR'].includes(event.data.errorType)
            ? event.data.errorType : 'CRASH',
          error_message: errMsg,
          stack_trace: typeof event.data.stack === 'string' ? event.data.stack.slice(0, 8000) : undefined,
        }).then(response => {
          if (!response.success) throw new Error(response.error?.message || 'Máy chủ từ chối báo cáo');
          setCrashReportStatus('Đã gửi log lỗi tới quản trị.');
        }).catch(error => {
          setCrashReportStatus(`Chưa gửi được log lỗi: ${error.message || 'Không thể kết nối máy chủ'}`);
          console.error('[EmulatorPlayer] Gửi báo cáo lỗi thất bại:', error);
        });
      } else if (event.data.type === 'NAVIGATE_BACK') {
        if (window.history.length > 1) {
          window.history.back();
        } else {
          window.location.href = '/games';
        }
      }
    };

    window.addEventListener('message', handleMsg);
    return () => window.removeEventListener('message', handleMsg);
  }, [directBytes, effectiveGameId, effectiveGameName, game?.slug, activeVersion?.id]);

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  // Helper to send keypad click to emulator iframe via postMessage with targetOrigin
  const sendKey = (code: string, pressed: boolean) => {
    if (!iframeRef.current || !iframeRef.current.contentWindow) return;
    const targetOrigin = window.location.origin;
    iframeRef.current.contentWindow.postMessage(
      { type: 'KEY_EVENT', code, pressed },
      targetOrigin
    );
  };

  // Pointer event handlers for virtual keypad buttons
  const createKeyHandlers = (code: string) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      sendKey(code, true);
    },
    onPointerUp: (e: React.PointerEvent) => {
      e.preventDefault();
      sendKey(code, false);
    },
    onPointerCancel: (e: React.PointerEvent) => {
      e.preventDefault();
      sendKey(code, false);
    },
    onPointerLeave: (e: React.PointerEvent) => {
      e.preventDefault();
      sendKey(code, false);
    },
  });

  const isDirectMode = !!directBytes;
  const effectiveAppId = activeVersion?.id || effectiveGameId || 'game';
  const emulatorSrc = isDirectMode
    ? `/emulator/run.html?mode=direct&appId=${encodeURIComponent(effectiveAppId)}`
    : effectiveJarUrl
      ? `/emulator/run.html?jar=${encodeURIComponent(effectiveJarUrl)}&appId=${encodeURIComponent(effectiveAppId)}`
      : '';

  return (
    <div
      ref={containerRef}
      className={`relative flex flex-col items-center justify-center p-4 transition-all ${
        isFullscreen ? 'bg-black w-screen h-screen' : 'w-full'
      }`}
    >
      {/* Top Toolbar */}
      {!isFullscreen && (
        <div className="w-full max-w-4xl flex flex-wrap items-center justify-between gap-4 mb-4 bg-arcade-900/90 border border-arcade-800 p-3 rounded-2xl">
          <div className="flex items-center gap-3">
            <span className="w-2.5 h-2.5 rounded-full bg-neon-green animate-pulse" />
            <span className="font-bold text-sm text-slate-200 truncate">{effectiveGameName}</span>
          </div>

          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            {/* Skin Selector */}
            <div className="flex w-full max-w-full items-center bg-arcade-800 rounded-lg p-0.5 text-[10px] sm:text-xs font-mono sm:w-auto">
              <button
                onClick={() => setSkin('nokia')}
                className={`whitespace-nowrap px-2 sm:px-3 py-1 rounded transition-colors ${
                  skin === 'nokia' ? 'bg-neon-cyan text-arcade-950 font-bold' : 'text-slate-400'
                }`}
              >
                📱 Nokia 1280
              </button>
              <button
                onClick={() => setSkin('arcade')}
                className={`whitespace-nowrap px-2 sm:px-3 py-1 rounded transition-colors ${
                  skin === 'arcade' ? 'bg-neon-pink text-white font-bold' : 'text-slate-400'
                }`}
              >
                🕹️ Arcade
              </button>
              <button
                onClick={() => setSkin('clean')}
                className={`whitespace-nowrap px-2 sm:px-3 py-1 rounded transition-colors ${
                  skin === 'clean' ? 'bg-slate-700 text-white font-bold' : 'text-slate-400'
                }`}
              >
                🖥️ Màn hình rộng
              </button>
            </div>

            {/* Fullscreen Button */}
            <button
              onClick={toggleFullscreen}
              className="px-3 py-1.5 bg-arcade-800 hover:bg-arcade-700 border border-arcade-700 rounded-lg text-xs font-bold text-slate-300 hover:text-neon-cyan transition-all flex items-center gap-1"
            >
              <span>⛶</span>
              <span>Toàn màn hình</span>
            </button>

            {/* Report Bug / Crash Button */}
            <button
              onClick={() => {
                setShowReportModal(true);
                setReportSuccessMsg(null);
              }}
              className="px-3 py-1.5 bg-arcade-800 hover:bg-red-500/20 border border-arcade-700 hover:border-red-500/50 rounded-lg text-xs font-bold text-slate-300 hover:text-red-400 transition-all flex items-center gap-1"
              title="Báo cáo game không chạy được, bị văng hoặc lỗi hiển thị"
            >
              <span>🚨</span>
              <span>Báo Lỗi</span>
            </button>
          </div>
        </div>
      )}

      {/* Emulator Error Alert Banner */}
      {emulatorError && (
        <div className="w-full max-w-4xl mb-4 p-4 bg-red-950/90 border-2 border-red-500 rounded-2xl flex flex-wrap items-center justify-between gap-4 text-red-200 shadow-lg animate-fadeIn">
          <div className="flex items-center gap-3">
            <span className="text-2xl">⚠️</span>
            <div>
              <p className="font-bold text-sm text-red-100">{emulatorError}</p>
              <p className="text-xs text-red-300 mt-0.5">
                {crashReportStatus}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setEmulatorError(null);
                setCrashReportStatus(null);
                crashReportedRef.current = false;
                if (iframeRef.current) {
                  iframeRef.current.src = iframeRef.current.src;
                }
              }}
              className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white font-bold text-xs rounded-lg transition-all"
            >
              Thử lại
            </button>
            <button
              onClick={() => {
                if (window.history.length > 1) window.history.back();
                else window.location.href = '/games';
              }}
              className="px-3 py-1.5 bg-arcade-800 hover:bg-arcade-700 text-slate-300 font-bold text-xs rounded-lg transition-all"
            >
              Quay về
            </button>
          </div>
        </div>
      )}

      {/* User Crash / Bug Report Modal */}
      {showReportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-arcade-900 border border-red-500/50 rounded-3xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-arcade-800 pb-3">
              <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <span>🚨</span>
                <span>Báo Cáo Sự Cố Game</span>
              </h3>
              <button
                onClick={() => setShowReportModal(false)}
                className="w-7 h-7 rounded-full bg-arcade-800 hover:bg-arcade-700 text-slate-400 hover:text-white flex items-center justify-center text-xs font-bold transition-colors"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Trò chơi: <strong className="text-neon-cyan">{effectiveGameName}</strong>
            </p>

            {reportSuccessMsg ? (
              <div className="p-4 bg-neon-green/15 border border-neon-green/40 rounded-2xl text-neon-green text-xs font-bold text-center space-y-2">
                <div>✓ {reportSuccessMsg}</div>
                <button
                  onClick={() => setShowReportModal(false)}
                  className="px-4 py-1.5 bg-neon-green text-arcade-950 rounded-xl text-xs font-black"
                >
                  Đóng
                </button>
              </div>
            ) : (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setIsSendingReport(true);
                  try {
                    const response = await reportGameCrash({
                      game_id: effectiveGameId || undefined,
                      game_version_id: activeVersion?.id,
                      game_name: effectiveGameName,
                      game_slug: game?.slug || undefined,
                      error_type: reportType,
                      error_message: reportDetails || `Người chơi báo cáo sự cố (${reportType})`,
                    });
                    if (!response.success) throw new Error(response.error?.message || 'Không thể gửi báo cáo lỗi');
                    setReportSuccessMsg('Đã gửi báo cáo lỗi thành công! Cảm ơn bạn đã phản hồi.');
                  } catch (err: any) {
                    alert(err.message || 'Lỗi gửi báo cáo');
                  } finally {
                    setIsSendingReport(false);
                  }
                }}
                className="space-y-4"
              >
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">
                    Vấn đề bạn đang gặp phải:
                  </label>
                  <select
                    value={reportType}
                    onChange={(e) => setReportType(e.target.value)}
                    className="w-full bg-arcade-800 border border-arcade-700 focus:border-neon-cyan rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none"
                  >
                    <option value="CRASH">Game bị văng / đứng hình khi đang chơi (CRASH)</option>
                    <option value="LOAD_FAILED">Không tải được game hoặc màn hình đen</option>
                    <option value="EMULATOR_ERROR">Lỗi âm thanh, hình ảnh bị vỡ</option>
                    <option value="USER_REPORT">Bàn phím ảo không nhận diện phím</option>
                    <option value="CORRUPT_JAR">File game bị lỗi / thiếu dữ liệu</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">
                    Mô tả chi tiết thêm (tuỳ chọn):
                  </label>
                  <textarea
                    rows={3}
                    value={reportDetails}
                    onChange={(e) => setReportDetails(e.target.value)}
                    placeholder="Ví dụ: Vừa chơi qua màn 2 thì màn hình bị trắng xóa..."
                    className="w-full bg-arcade-800 border border-arcade-700 focus:border-neon-cyan rounded-xl p-3 text-xs text-slate-100 placeholder-slate-500 focus:outline-none"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowReportModal(false)}
                    className="px-4 py-2 bg-arcade-800 hover:bg-arcade-700 text-slate-300 rounded-xl text-xs font-bold"
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    disabled={isSendingReport}
                    className="px-5 py-2 bg-red-600 hover:bg-red-500 text-white font-bold rounded-xl text-xs uppercase tracking-wider transition-all shadow-lg"
                  >
                    {isSendingReport ? 'Đang gửi...' : 'Gửi Báo Cáo'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Screen Presentation according to Skin */}
      {skin === 'nokia' ? (
        <div className="nokia1280" role="group" aria-label="Điện thoại Nokia 1280">
          <div className="nokia1280__top" aria-hidden="true">
            <div className="nokia1280__speaker" />
            <span className="nokia1280__brand">NOKIA</span>
          </div>

          <div className="nokia1280__bezel">
            <div className="nokia1280__screen">
              <iframe
                ref={iframeRef}
                onLoad={handleEmulatorLoad}
                src={emulatorSrc ? `${emulatorSrc}&skin=nokia1280&fractionScale=true` : emulatorSrc}
                sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-forms"
                title={effectiveGameName}
              />
            </div>
          </div>

          <div className="nokia1280__controls" role="group" aria-label="Phím điều hướng">
            <div className="nokia1280__sidekeys">
              <button type="button" {...createKeyHandlers('F1')} className="nokia1280__function"
                aria-label="Phím mềm trái (F1)" title="Phím mềm trái · F1">
                <span className="nokia1280__softkey-mark" aria-hidden="true" />
              </button>
              <button type="button" {...createKeyHandlers('Enter')} className="nokia1280__function nokia1280__call"
                aria-label="Chọn / Đồng ý (Enter)" title="Chọn / Đồng ý · Enter">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m5 4 3-1 3 5-2 2a14 14 0 0 0 5 5l2-2 5 3-1 3c-.3 1-1.4 2-3 2C10 20 4 14 3 7c0-1.6 1-2.7 2-3Z" />
                </svg>
              </button>
            </div>

            <div className="nokia1280__dpad">
              {[
                { code: 'ArrowUp', position: 'up', label: 'Lên', symbol: '▲' },
                { code: 'ArrowLeft', position: 'left', label: 'Trái', symbol: '◀' },
                { code: 'ArrowRight', position: 'right', label: 'Phải', symbol: '▶' },
                { code: 'ArrowDown', position: 'down', label: 'Xuống', symbol: '▼' },
              ].map(key => (
                <button key={key.code} type="button" {...createKeyHandlers(key.code)}
                  className={`nokia1280__direction nokia1280__direction--${key.position}`}
                  aria-label={key.label} title={key.label}>
                  <span aria-hidden="true">{key.symbol}</span>
                </button>
              ))}
              <button type="button" {...createKeyHandlers('Enter')} className="nokia1280__select"
                aria-label="OK / Chọn (Enter)" title="OK / Chọn · Enter">OK</button>
            </div>

            <div className="nokia1280__sidekeys">
              <button type="button" {...createKeyHandlers('F2')} className="nokia1280__function"
                aria-label="Phím mềm phải (F2)" title="Phím mềm phải · F2">
                <span className="nokia1280__softkey-mark" aria-hidden="true" />
              </button>
              <button type="button" {...createKeyHandlers('Escape')} className="nokia1280__function nokia1280__end"
                aria-label="Quay lại / Menu (Esc)" title="Quay lại / Menu · Esc">
                <svg viewBox="0 0 24 24" aria-hidden="true" style={{ transform: 'rotate(135deg)' }}>
                  <path d="m5 4 3-1 3 5-2 2a14 14 0 0 0 5 5l2-2 5 3-1 3c-.3 1-1.4 2-3 2C10 20 4 14 3 7c0-1.6 1-2.7 2-3Z" />
                </svg>
              </button>
            </div>
          </div>

          <div className="nokia1280__numbers" role="group" aria-label="Bàn phím số">
            {[
              { digit: '1', letters: '· , ?', code: 'Digit1' },
              { digit: '2', letters: 'abc', code: 'Digit2' },
              { digit: '3', letters: 'def', code: 'Digit3' },
              { digit: '4', letters: 'ghi', code: 'Digit4' },
              { digit: '5', letters: 'jkl', code: 'Digit5' },
              { digit: '6', letters: 'mno', code: 'Digit6' },
              { digit: '7', letters: 'pqrs', code: 'Digit7' },
              { digit: '8', letters: 'tuv', code: 'Digit8' },
              { digit: '9', letters: 'wxyz', code: 'Digit9' },
              { digit: '*', letters: '+', code: 'NumpadMultiply' },
              { digit: '0', letters: '␣', code: 'Digit0' },
              { digit: '#', letters: '↑', code: 'NumpadDivide' },
            ].map(key => (
              <button key={key.code} type="button" {...createKeyHandlers(key.code)} className="nokia1280__number"
                aria-label={`Phím ${key.digit}`} title={`Phím ${key.digit}`}>
                <span className="nokia1280__digit">{key.digit}</span>
                <span className="nokia1280__letters" aria-hidden="true">{key.letters}</span>
              </button>
            ))}
          </div>
          <div className="nokia1280__bottom" aria-hidden="true"><span /><span /><span /></div>
        </div>
      ) : skin === 'arcade' ? (
        <div className="relative w-full max-w-2xl bg-arcade-900 border-4 border-neon-pink rounded-3xl p-6 shadow-neon-pink">
          <div className="aspect-[4/3] w-full rounded-xl overflow-hidden bg-black border-2 border-neon-cyan shadow-inner">
            <iframe
              ref={iframeRef}
              onLoad={handleEmulatorLoad}
              src={emulatorSrc}
              className="w-full h-full border-0"
              sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-forms"
              title={effectiveGameName}
            />
          </div>
        </div>
      ) : (
        <div className="relative w-full max-w-3xl aspect-[4/3] bg-black border border-arcade-800 rounded-2xl overflow-hidden shadow-2xl">
          <iframe
            ref={iframeRef}
            onLoad={handleEmulatorLoad}
            src={emulatorSrc}
            className="w-full h-full border-0"
            sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-forms"
            title={effectiveGameName}
          />
        </div>
      )}

      {/* Keyboard Controls Guide */}
      {!isFullscreen && (
        <div className="w-full max-w-4xl mt-6 bg-arcade-900/80 border border-arcade-800 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-base">⌨️</span>
              <h3 className="font-bold text-sm text-slate-200">Hướng dẫn phím điều khiển trên bàn phím</h3>
            </div>
            <button
              onClick={() => setShowKeyGuide((v) => !v)}
              className="text-xs text-neon-cyan hover:underline md:hidden"
            >
              {showKeyGuide ? 'Thu gọn ▲' : 'Xem chi tiết ▼'}
            </button>
          </div>
          <p className="text-xs text-slate-400 mb-3">
            <strong className="text-neon-cyan">{KEYBOARD_HINT_MESSAGE}</strong>. {DEFAULT_KEYS_NOTE}
          </p>

          <div className={`${showKeyGuide ? 'block' : 'hidden md:block'} overflow-x-auto`}>
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-arcade-800 text-slate-400 font-mono">
                  <th className="py-2 px-3 font-semibold">Phím trên bàn phím</th>
                  <th className="py-2 px-3 font-semibold">Chức năng</th>
                  <th className="py-2 px-3 font-semibold">Ghi chú</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-arcade-800/60 font-mono text-slate-300">
                {DEFAULT_KEY_MAPPINGS.map((item) => (
                  <tr key={item.key} className="hover:bg-arcade-800/40">
                    <td className="py-2 px-3">
                      <kbd className="px-2 py-0.5 bg-arcade-800 border border-arcade-700 rounded text-neon-cyan font-bold">
                        {item.key}
                      </kbd>
                    </td>
                    <td className="py-2 px-3 font-bold text-slate-200">{item.action}</td>
                    <td className="py-2 px-3 text-slate-400">{item.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* User Crash / Bug Report Modal */}
      {showReportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-arcade-900 border border-red-500/50 rounded-3xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-arcade-800 pb-3">
              <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <span>🚨</span>
                <span>Báo Cáo Sự Cố Game</span>
              </h3>
              <button
                onClick={() => setShowReportModal(false)}
                className="w-7 h-7 rounded-full bg-arcade-800 hover:bg-arcade-700 text-slate-400 hover:text-white flex items-center justify-center text-xs font-bold transition-colors"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Trò chơi: <strong className="text-neon-cyan">{effectiveGameName}</strong>
            </p>

            {reportSuccessMsg ? (
              <div className="p-4 bg-neon-green/15 border border-neon-green/40 rounded-2xl text-neon-green text-xs font-bold text-center space-y-2">
                <div>✓ {reportSuccessMsg}</div>
                <button
                  onClick={() => setShowReportModal(false)}
                  className="px-4 py-1.5 bg-neon-green text-arcade-950 rounded-xl text-xs font-black"
                >
                  Đóng
                </button>
              </div>
            ) : (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setIsSendingReport(true);
                  try {
                    const response = await reportGameCrash({
                      game_id: effectiveGameId || undefined,
                      game_version_id: activeVersion?.id,
                      game_name: effectiveGameName,
                      game_slug: game?.slug || undefined,
                      error_type: reportType,
                      error_message: reportDetails || `Người chơi báo cáo sự cố (${reportType})`,
                    });
                    if (!response.success) throw new Error(response.error?.message || 'Không thể gửi báo cáo lỗi');
                    setReportSuccessMsg('Đã gửi báo cáo lỗi thành công! Cảm ơn bạn đã phản hồi.');
                  } catch (err: any) {
                    alert(err.message || 'Lỗi gửi báo cáo');
                  } finally {
                    setIsSendingReport(false);
                  }
                }}
                className="space-y-4"
              >
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">
                    Vấn đề bạn đang gặp phải:
                  </label>
                  <select
                    value={reportType}
                    onChange={(e) => setReportType(e.target.value)}
                    className="w-full bg-arcade-800 border border-arcade-700 focus:border-neon-cyan rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none"
                  >
                    <option value="CRASH">Game bị văng / đứng hình khi đang chơi (CRASH)</option>
                    <option value="LOAD_FAILED">Không tải được game hoặc màn hình đen</option>
                    <option value="EMULATOR_ERROR">Lỗi âm thanh, hình ảnh bị vỡ</option>
                    <option value="USER_REPORT">Bàn phím ảo không nhận diện phím</option>
                    <option value="CORRUPT_JAR">File game bị lỗi / thiếu dữ liệu</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">
                    Mô tả chi tiết thêm (tuỳ chọn):
                  </label>
                  <textarea
                    rows={3}
                    value={reportDetails}
                    onChange={(e) => setReportDetails(e.target.value)}
                    placeholder="Ví dụ: Vừa chơi qua màn 2 thì màn hình bị trắng xóa..."
                    className="w-full bg-arcade-800 border border-arcade-700 focus:border-neon-cyan rounded-xl p-3 text-xs text-slate-100 placeholder-slate-500 focus:outline-none"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowReportModal(false)}
                    className="px-4 py-2 bg-arcade-800 hover:bg-arcade-700 text-slate-300 rounded-xl text-xs font-bold"
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    disabled={isSendingReport}
                    className="px-5 py-2 bg-red-600 hover:bg-red-500 text-white font-bold rounded-xl text-xs uppercase tracking-wider transition-all shadow-lg"
                  >
                    {isSendingReport ? 'Đang gửi...' : 'Gửi Báo Cáo'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
