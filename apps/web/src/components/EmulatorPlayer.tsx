import React, { useState, useEffect, useRef } from 'react';
import { recordPlay } from '../lib/api';

interface EmulatorPlayerProps {
  gameId: string;
  gameName: string;
  jarUrl: string;
  initialPhoneType?: string;
}

export default function EmulatorPlayer({
  gameId,
  gameName,
  jarUrl,
}: EmulatorPlayerProps) {
  const [skin, setSkin] = useState<'nokia' | 'arcade' | 'clean'>('nokia');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    // Record play history
    if (gameId) {
      recordPlay(gameId).catch(() => {});
    }
  }, [gameId]);

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  // Helper to send keypad click to emulator iframe
  const sendKey = (code: string) => {
    if (!iframeRef.current || !iframeRef.current.contentWindow) return;
    iframeRef.current.contentWindow.postMessage({ type: 'KEY_EVENT', code }, '*');
    iframeRef.current.focus();
  };

  const emulatorSrc = `/emulator/run.html?jar=${encodeURIComponent(jarUrl)}`;

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
            <span className="font-bold text-sm text-slate-200 truncate">{gameName}</span>
          </div>

          <div className="flex items-center gap-2">
            {/* Skin Selector */}
            <div className="flex items-center bg-arcade-800 rounded-lg p-0.5 text-xs font-mono">
              <button
                onClick={() => setSkin('nokia')}
                className={`px-3 py-1 rounded transition-colors ${
                  skin === 'nokia' ? 'bg-neon-cyan text-arcade-950 font-bold' : 'text-slate-400'
                }`}
              >
                📱 Nokia Skin
              </button>
              <button
                onClick={() => setSkin('arcade')}
                className={`px-3 py-1 rounded transition-colors ${
                  skin === 'arcade' ? 'bg-neon-pink text-white font-bold' : 'text-slate-400'
                }`}
              >
                🕹️ Arcade
              </button>
              <button
                onClick={() => setSkin('clean')}
                className={`px-3 py-1 rounded transition-colors ${
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
          </div>
        </div>
      )}

      {/* Screen Presentation according to Skin */}
      {skin === 'nokia' ? (
        <div className="relative w-full max-w-[340px] sm:max-w-[380px] bg-gradient-to-b from-slate-700 via-slate-800 to-slate-900 p-5 rounded-[48px] shadow-2xl border-4 border-slate-600">
          {/* Earpiece & Nokia Logo */}
          <div className="flex flex-col items-center mb-3">
            <div className="w-16 h-1.5 bg-slate-950 rounded-full mb-1"></div>
            <span className="text-[10px] font-bold font-mono tracking-widest text-slate-400">NOKIA</span>
          </div>

          {/* Phone Screen Frame */}
          <div className="bg-black p-3 rounded-2xl border-2 border-slate-700 shadow-inner">
            <div className="relative aspect-[3/4] w-full rounded overflow-hidden bg-black">
              <iframe
                ref={iframeRef}
                src={emulatorSrc}
                className="w-full h-full border-0"
                sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-forms"
                title={gameName}
              />
            </div>
          </div>

          {/* Hardware Touch Keypad */}
          <div className="mt-5 space-y-2">
            {/* Softkeys & D-Pad navigation */}
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => sendKey('F1')}
                className="py-2.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs font-mono text-neon-cyan font-bold border border-slate-600 active:scale-95 transition-all"
              >
                L (Q)
              </button>
              <button
                onClick={() => sendKey('ArrowUp')}
                className="py-2.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs font-mono text-slate-100 font-bold border border-slate-600 active:scale-95 transition-all"
              >
                ▲
              </button>
              <button
                onClick={() => sendKey('F2')}
                className="py-2.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs font-mono text-neon-cyan font-bold border border-slate-600 active:scale-95 transition-all"
              >
                R (W)
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => sendKey('ArrowLeft')}
                className="py-2.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs font-mono text-slate-100 font-bold border border-slate-600 active:scale-95 transition-all"
              >
                ◀
              </button>
              <button
                onClick={() => sendKey('Enter')}
                className="py-2.5 bg-neon-cyan/20 border border-neon-cyan text-neon-cyan hover:bg-neon-cyan hover:text-arcade-950 font-black rounded-lg text-xs font-mono active:scale-95 transition-all"
              >
                OK
              </button>
              <button
                onClick={() => sendKey('ArrowRight')}
                className="py-2.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs font-mono text-slate-100 font-bold border border-slate-600 active:scale-95 transition-all"
              >
                ▶
              </button>
            </div>

            <div className="flex justify-center">
              <button
                onClick={() => sendKey('ArrowDown')}
                className="w-1/3 py-2.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs font-mono text-slate-100 font-bold border border-slate-600 active:scale-95 transition-all"
              >
                ▼
              </button>
            </div>

            {/* Numpad Grid */}
            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-700/60 text-slate-200 font-mono font-bold text-xs">
              <button
                onClick={() => sendKey('Digit1')}
                className="py-2 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 active:scale-95"
              >
                1
              </button>
              <button
                onClick={() => sendKey('Digit2')}
                className="py-2 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 active:scale-95"
              >
                2
              </button>
              <button
                onClick={() => sendKey('Digit3')}
                className="py-2 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 active:scale-95"
              >
                3
              </button>
              <button
                onClick={() => sendKey('Digit4')}
                className="py-2 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 active:scale-95"
              >
                4
              </button>
              <button
                onClick={() => sendKey('Digit5')}
                className="py-2 bg-neon-yellow/20 text-neon-yellow border border-neon-yellow/40 hover:bg-neon-yellow hover:text-arcade-950 rounded font-black active:scale-95"
              >
                5
              </button>
              <button
                onClick={() => sendKey('Digit6')}
                className="py-2 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 active:scale-95"
              >
                6
              </button>
              <button
                onClick={() => sendKey('Digit7')}
                className="py-2 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 active:scale-95"
              >
                7
              </button>
              <button
                onClick={() => sendKey('Digit8')}
                className="py-2 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 active:scale-95"
              >
                8
              </button>
              <button
                onClick={() => sendKey('Digit9')}
                className="py-2 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 active:scale-95"
              >
                9
              </button>
              <button
                onClick={() => sendKey('NumpadMultiply')}
                className="py-2 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 active:scale-95"
              >
                *
              </button>
              <button
                onClick={() => sendKey('Digit0')}
                className="py-2 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 active:scale-95"
              >
                0
              </button>
              <button
                onClick={() => sendKey('NumpadDivide')}
                className="py-2 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 active:scale-95"
              >
                #
              </button>
            </div>
          </div>
        </div>
      ) : skin === 'arcade' ? (
        <div className="relative w-full max-w-2xl bg-arcade-900 border-4 border-neon-pink rounded-3xl p-6 shadow-neon-pink">
          <div className="aspect-[4/3] w-full rounded-xl overflow-hidden bg-black border-2 border-neon-cyan shadow-inner">
            <iframe
              ref={iframeRef}
              src={emulatorSrc}
              className="w-full h-full border-0"
              sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-forms"
              title={gameName}
            />
          </div>
        </div>
      ) : (
        <div className="relative w-full max-w-3xl aspect-[4/3] bg-black border border-arcade-800 rounded-2xl overflow-hidden shadow-2xl">
          <iframe
            ref={iframeRef}
            src={emulatorSrc}
            className="w-full h-full border-0"
            sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-forms"
            title={gameName}
          />
        </div>
      )}
    </div>
  );
}
