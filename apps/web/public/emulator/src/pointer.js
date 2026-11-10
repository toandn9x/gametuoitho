// Convert viewport coordinates to the game's native canvas resolution. The
// bounding rect includes CSS zoom/transforms on Chrome, Safari and Firefox.
export function canvasPoint(canvas, clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height || !canvas.width || !canvas.height ||
        !Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
    return {
        x: Math.max(0, Math.min(canvas.width - 1, Math.floor((clientX - rect.left) * canvas.width / rect.width))),
        y: Math.max(0, Math.min(canvas.height - 1, Math.floor((clientY - rect.top) * canvas.height / rect.height))),
    };
}

export function bindCanvasPointerEvents(canvas, queueEvent) {
    let pointerId = null;
    let lastPoint = null;
    canvas.style.touchAction = 'none';
    const post = (kind, event) => {
        const point = (event.type === 'lostpointercapture' || event.type === 'pointercancel')
            ? lastPoint : canvasPoint(canvas, event.clientX, event.clientY) || lastPoint;
        if (!point) return;
        lastPoint = point;
        queueEvent({ kind, ...point });
    };
    canvas.addEventListener('pointerdown', event => {
        if (pointerId !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
        if (!canvasPoint(canvas, event.clientX, event.clientY)) return;
        pointerId = event.pointerId;
        canvas.focus({ preventScroll: true });
        try { canvas.setPointerCapture(pointerId); } catch { /* The browser may have cancelled this pointer. */ }
        post('pointerpressed', event);
        event.preventDefault();
    });
    canvas.addEventListener('pointermove', event => {
        if (event.pointerId !== pointerId) return;
        post('pointerdragged', event);
        event.preventDefault();
    });
    const release = event => {
        if (event.pointerId !== pointerId) return;
        post('pointerreleased', event);
        pointerId = null;
        lastPoint = null;
        event.preventDefault();
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('lostpointercapture', release);
}
