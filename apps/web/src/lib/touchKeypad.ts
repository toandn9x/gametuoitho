export interface TouchKeypadBinding {
  releaseAll(): void;
  hasActiveTouches(): boolean;
  destroy(): void;
}

/** Native, non-passive Touch Events: cancelling React's delegated pointerdown
 * alone does not reliably stop focus changes on iOS/WebKit. */
export function bindTouchKeypad(
  root: HTMLElement,
  sendKey: (code: string, pressed: boolean) => void,
): TouchKeypadBinding {
  const active = new Map<number, string>();
  const doc = root.ownerDocument;
  const releaseAll = () => {
    const codes = new Set(active.values());
    active.clear();
    for (const code of codes) sendKey(code, false);
  };
  const release = (id: number) => {
    const code = active.get(id);
    if (!code) return;
    active.delete(id);
    if (![...active.values()].includes(code)) sendKey(code, false);
  };
  const start = (event: TouchEvent) => {
    let handled = false;
    for (const touch of Array.from(event.changedTouches)) {
      const target = touch.target as Element | null;
      const button = target?.closest?.<HTMLButtonElement>('button[data-emulator-key]');
      const code = button?.dataset.emulatorKey;
      if (!button || !root.contains(button) || button.disabled || !code || active.has(touch.identifier)) continue;
      handled = true;
      const alreadyHeld = [...active.values()].includes(code);
      active.set(touch.identifier, code);
      if (!alreadyHeld) sendKey(code, true);
    }
    if (handled && event.cancelable) event.preventDefault();
  };
  const move = (event: TouchEvent) => {
    if (active.size && event.cancelable) event.preventDefault();
  };
  const end = (event: TouchEvent) => {
    const handled = Array.from(event.changedTouches).some(touch => active.has(touch.identifier));
    if (event.type === 'touchcancel' && event.changedTouches.length === 0) releaseAll();
    else for (const touch of Array.from(event.changedTouches)) release(touch.identifier);
    if (handled && event.cancelable) event.preventDefault();
  };
  const contextMenu = (event: Event) => {
    if (active.size && event.cancelable) event.preventDefault();
  };
  root.addEventListener('touchstart', start, { passive: false });
  root.addEventListener('touchmove', move, { passive: false });
  root.addEventListener('contextmenu', contextMenu);
  // End/cancel can be retargeted outside the original button after scrolling,
  // focus changes, rotation or a system gesture. Never leave a phone key held.
  doc.addEventListener('touchend', end, { passive: false, capture: true });
  doc.addEventListener('touchcancel', end, { passive: false, capture: true });
  return {
    releaseAll,
    hasActiveTouches: () => active.size > 0,
    destroy() {
      releaseAll();
      root.removeEventListener('touchstart', start);
      root.removeEventListener('touchmove', move);
      root.removeEventListener('contextmenu', contextMenu);
      doc.removeEventListener('touchend', end, true);
      doc.removeEventListener('touchcancel', end, true);
    },
  };
}
