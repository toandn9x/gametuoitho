import { LibMedia } from "../libmedia/libmedia.js";
import { LibMidi, createUnlockingAudioContext } from "../libmidi/libmidi.js";
import { codeMap, KeyRepeatManager } from "./key.js";
import { EventQueue } from "./eventqueue.js";
import { initKbdListeners, setKbdHandler, kbdWidth, kbdHeight } from "./screenKbd.js";
import { KeyMapper } from "./keyMapper.js";

// we need to import natives here, don't use System.loadLibrary
// since CheerpJ fails to load them in firefox and we can't set breakpoints
import canvasFontNatives from "../libjs/libcanvasfont.js";
import canvasGraphicsNatives from "../libjs/libcanvasgraphics.js";
import gles2Natives from "../libjs/libgles2.js";
import jsReferenceNatives from "../libjs/libjsreference.js";
import mediaBridgeNatives from "../libjs/libmediabridge.js";
import midiBridgeNatives from "../libjs/libmidibridge.js";

const evtQueue = new EventQueue();
const sp = new URLSearchParams(location.search);

const cheerpjWebRoot = '/app'+location.pathname.replace(/\/[^/]*$/,'');

let isMobile = sp.get('mobile');

let display = null;
let screenCtx = null;

let fractionScale = sp.get('fractionScale') || (localStorage && localStorage.getItem("pl.zb3.freej2me.fractionScale") === "true");
let scaleSet = false;

const keyRepeatManager = new KeyRepeatManager();
const keyMapper = new KeyMapper();

window.evtQueue = evtQueue;

function autoscale() {
    if (!scaleSet) return;

    let screenWidth = window.innerWidth;
    let screenHeight = window.innerHeight;

    if (isMobile) {
        document.getElementById('left-keys').style.display = '';
        document.getElementById('right-keys').style.display = '';

        if (screenWidth > screenHeight) {
            document.body.classList.add('kbd-landscape');
            document.body.classList.remove('kbd-portrait');
            screenWidth = screenWidth - 2*kbdWidth;
        } else {
            document.body.classList.add('kbd-portrait');
            document.body.classList.remove('kbd-landscape');
            screenHeight = screenHeight - kbdHeight;
        }
    }

    let scale = Math.min(
        screenWidth/screenCtx.canvas.width,
        screenHeight/screenCtx.canvas.height
    );

    if (!fractionScale) {
        scale = scale|0;
    }

    display.style.zoom = scale;
}

function setListeners() {
    let mouseDown = false;
    let noMouse = false;

    setKbdHandler((isDown, key) => {
        const symbol = key.startsWith('Digit') ? key.substring(5) : '\x00';
        keyRepeatManager.post(isDown, key, {symbol, ctrlKey: false, shiftKey: false});
    });

    function handleKeyEvent(e) {
        const isDown = e.type === 'keydown';

        // Try to resolve custom mapping first
        let effectiveKey = e.code;
        const action = keyMapper.getActionForKey(e.code);
        if (action) {
            // Get the canonical key for this action (first default key)
            const canonicalKeys = keyMapper.getDefaultKeysForAction(action);
            if (canonicalKeys.length > 0) {
                effectiveKey = canonicalKeys[0];
            }
        }

        if (codeMap[effectiveKey]) {
            keyRepeatManager.post(isDown, effectiveKey, {
                symbol: e.key.length == 1 ? e.key.charCodeAt(0) : '\x00',
                ctrlKey: e.ctrlKey,
                shiftKey: e.shiftKey
            })
        }
        e.preventDefault();
    }

    display.addEventListener('keydown', handleKeyEvent);
    display.addEventListener('keyup', handleKeyEvent);

    function handleGlobalKeyEvent(e) {
        if (e.target === display) return;
        if (e.target && (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT')) return;
        if (display && display.style.display !== 'none' && scaleSet) {
            handleKeyEvent(e);
        }
    }
    window.addEventListener('keydown', handleGlobalKeyEvent);
    window.addEventListener('keyup', handleGlobalKeyEvent);

    window.addEventListener('message', (event) => {
        // Must come from parent window
        if (event.source !== window.parent) return;

        // Origin check: must match location.origin or configured parent origin
        if (event.origin !== window.location.origin && window.location.origin !== 'null') {
            return;
        }

        // Schema validation
        if (!event.data || typeof event.data !== 'object') return;

        // Direct bytes delivery for private/imported games
        if (event.data.type === 'LOAD_GAME_BYTES') {
            const raw = event.data.bytes;
            if (raw && (raw instanceof ArrayBuffer || ArrayBuffer.isView(raw))) {
                const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
                if (resolveJarBytes) {
                    resolveJarBytes(bytes);
                    resolveJarBytes = null;
                } else {
                    pendingJarBytes = bytes;
                }
            }
            return;
        }

        const { type, code, pressed } = event.data;
        if (type !== 'KEY_EVENT' || typeof pressed !== 'boolean' || typeof code !== 'string') return;

        // Code validation: code must exist in codeMap
        if (!codeMap[code]) return;

        // Resolve custom mapping if applicable
        let effectiveKey = code;
        const action = keyMapper.getActionForKey(code);
        if (action) {
            const canonicalKeys = keyMapper.getDefaultKeysForAction(action);
            if (canonicalKeys.length > 0) {
                effectiveKey = canonicalKeys[0];
            }
        }

        if (codeMap[effectiveKey]) {
            const symbol = effectiveKey.startsWith('Digit') ? effectiveKey.substring(5) : '\x00';
            keyRepeatManager.post(pressed, effectiveKey, {
                symbol,
                ctrlKey: false,
                shiftKey: false
            });
        }
    });

    keyRepeatManager.register((kind, key, args) => {
        if (kind === 'click') {
            if (key === 'Maximize') {
                fractionScale = !fractionScale;
                localStorage && localStorage.setItem("pl.zb3.freej2me.fractionScale", fractionScale);
                autoscale();
            }
        } else if (codeMap[key]) {
            console.log('queuin event');
            evtQueue.queueEvent({
                kind: kind === 'up' ? 'keyup' : 'keydown',
                args: [codeMap[key], args.symbol, args.ctrlKey, args.shiftKey]
            });
        }
    });

    display.addEventListener('mousedown', async e => {
        display.focus();
        if (noMouse) return;

        evtQueue.queueEvent({
            kind: 'pointerpressed',
            x: e.offsetX / display.currentCSSZoom | 0,
            y: e.offsetY / display.currentCSSZoom | 0,
        });

        mouseDown = true;

        e.preventDefault();
    });

    display.addEventListener('mousemove', async e => {
        if (noMouse) return;
        if (!mouseDown) return;

        evtQueue.queueEvent({
            kind: 'pointerdragged',
            x: e.offsetX / display.currentCSSZoom | 0,
            y: e.offsetY / display.currentCSSZoom | 0,
        });

        e.preventDefault();
    });

    document.addEventListener('mouseup', async e => {
        if (noMouse) return;
        if (!mouseDown) return;

        mouseDown = false;

        evtQueue.queueEvent({
            kind: 'pointerreleased',
            x: (e.pageX - display.offsetLeft) / display.currentCSSZoom | 0,
            y: (e.pageY - display.offsetTop) / display.currentCSSZoom | 0,
        });

        e.preventDefault();
    });


    display.addEventListener('touchstart', async e => {
        display.focus();
        noMouse = true;

        const rect = display.getBoundingClientRect();
        const touch = e.changedTouches[0];

        evtQueue.queueEvent({
            kind: 'pointerpressed',
            x: (touch.clientX - rect.left) / display.currentCSSZoom | 0,
            y: (touch.clientY - rect.top) / display.currentCSSZoom | 0,
        });

        e.preventDefault();
    }, {passive: false});

    display.addEventListener('touchmove', async e => {
        noMouse = true;

        const rect = display.getBoundingClientRect();
        const touch = e.changedTouches[0];

        evtQueue.queueEvent({
            kind: 'pointerdragged',
            x: (touch.clientX - rect.left) / display.currentCSSZoom | 0,
            y: (touch.clientY - rect.top) / display.currentCSSZoom | 0,
        });

        e.preventDefault();
    }, {passive: false});

    display.addEventListener('touchend', async e => {
        noMouse = true;

        const rect = display.getBoundingClientRect();
        const touch = e.changedTouches[0];

        evtQueue.queueEvent({
            kind: 'pointerreleased',
            x: (touch.clientX - rect.left) / display.currentCSSZoom | 0,
            y: (touch.clientY - rect.top) / display.currentCSSZoom | 0,
        });

        e.preventDefault();
    });

    document.addEventListener('mousedown', e => {
        if (e.target && (e.target.tagName === 'BUTTON' || e.target.tagName === 'A')) return;
        if (display && display.style.display !== 'none' && scaleSet) {
            console.log('refocus');
            setTimeout(() => display.focus(), 20);
        }
    });

    display.addEventListener('blur', e => {
        if (document.activeElement && (document.activeElement.tagName === 'BUTTON' || document.activeElement.tagName === 'A')) {
            return;
        }
        if (display && display.style.display !== 'none' && scaleSet) {
            console.log('refocus');
            // it doesn't work without any timeout
            setTimeout(() => display.focus(), 10);
        }
    });

    window.addEventListener('resize', autoscale);

    initKbdListeners();
}

function setFaviconFromBuffer(arrayBuffer) {
    const blob = new Blob([arrayBuffer], { type: 'image/png' });

    const reader = new FileReader();
    reader.onload = function() {
        const dataURL = reader.result;

        let link = document.querySelector("link[rel*='icon']");
        if (!link) {
            link = document.createElement('link');
            link.setAttribute('rel', 'icon');
            document.head.appendChild(link);
        }
        link.setAttribute('href', dataURL);
    };
    reader.readAsDataURL(blob);
}

async function ensureAppInstalled(lib, appId) {
    const appFile = await cjFileBlob(appId + "/app.jar");

    if (!appFile) {
        const launcherUtil = await lib.pl.zb3.freej2me.launcher.LauncherUtil;

        await launcherUtil.installFromBundle(cheerpjWebRoot + "/apps/", appId);
    }
}

let pendingJarBytes = null;
let resolveJarBytes = null;
const jarBytesPromise = new Promise((resolve) => {
    resolveJarBytes = resolve;
});

function getSafeJarName() {
    const explicitId = sp.get('appId') || sp.get('versionId') || sp.get('slug');
    if (explicitId) {
        return explicitId.replace(/[^a-zA-Z0-9_-]/g, '_');
    }
    const rawJar = sp.get('jar');
    if (rawJar) {
        const decoded = decodeURIComponent(rawJar);
        const match = decoded.match(/(?:games|versions|imports)\/([^/?#]+)/g);
        if (match && match.length > 0) {
            const parts = match.map(m => m.split('/')[1]).filter(Boolean);
            if (parts.length > 0) {
                return parts.join('_').replace(/[^a-zA-Z0-9_-]/g, '_');
            }
        }
        let hash = 5381;
        for (let i = 0; i < decoded.length; i++) {
            hash = ((hash << 5) + hash) + decoded.charCodeAt(i);
            hash |= 0;
        }
        return 'jar_' + Math.abs(hash).toString(16);
    }
    return 'custom_' + Date.now().toString(16);
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

let errorReported = false;
function showError(message, canRetry = true, details = {}) {
    // A Java exception can be swallowed by FreeJ2ME without rejecting main().
    // Send one bounded report for this launch, including load/init failures.
    if (!errorReported) {
        errorReported = true;
        const diagnostics = window.emulatorDiagnostics;
        const stack = details.stack || diagnostics?.snapshot() || '';
        const safeStack = diagnostics ? diagnostics.redact(stack) : String(stack);
        console.error('[Emulator]', message, safeStack);
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: 'EMULATOR_ERROR',
                errorType: details.errorType || 'LOAD_FAILED',
                message: String(message).slice(0, 1000),
                stack: safeStack.slice(0, 8000),
            }, window.location.origin);
        }
    }
    const loadingEl = document.getElementById('loading');
    if (!loadingEl) return;
    loadingEl.hidden = false;
    if (display) {
        display.style.display = 'none';
    }
    loadingEl.innerHTML = `
        <div class="error-container" style="text-align: center; padding: 20px; max-width: 340px; margin: 0 auto; color: #ff0055;">
            <div style="font-size: 36px; margin-bottom: 12px;">⚠️</div>
            <div style="font-size: 16px; font-weight: bold; margin-bottom: 8px; color: #ff0055; font-family: 'Press Start 2P', monospace;">LỖI TẢI GAME</div>
            <div style="font-size: 16px; margin-bottom: 20px; color: #e2e8f0; font-family: 'VT323', monospace;">${escapeHtml(message)}</div>
            <div style="display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;">
                ${canRetry ? `<button id="btn-retry" style="background: #00ffff; color: #0a0a0f; border: none; padding: 8px 18px; font-family: 'VT323', monospace; font-size: 20px; font-weight: bold; cursor: pointer; border-radius: 6px;">Thử lại</button>` : ''}
                <button id="btn-back" style="background: #252535; color: #e2e8f0; border: 1px solid #4a4a60; padding: 8px 18px; font-family: 'VT323', monospace; font-size: 20px; cursor: pointer; border-radius: 6px;">Quay lại</button>
            </div>
        </div>
    `;
    if (canRetry) {
        document.getElementById('btn-retry')?.addEventListener('click', () => {
            window.location.reload();
        });
    }
    document.getElementById('btn-back')?.addEventListener('click', () => {
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({ type: 'NAVIGATE_BACK' }, window.location.origin);
        } else {
            window.history.back();
        }
    });
}

async function init() {
    document.querySelector("#loading .loading-text").textContent = "Loading Sandbox";

    display = document.getElementById('display');
    screenCtx = display.getContext('2d');

    setListeners();

    window.libmidi = new LibMidi(createUnlockingAudioContext());
    await window.libmidi.init();
    window.libmidi.midiPlayer.addEventListener('end-of-media', e => {
        window.evtQueue.queueEvent({kind: 'player-eom', player: e.target});
    })
    window.libmedia = new LibMedia();

    await cheerpjInit({
        enableDebug: false,
        natives: {
            ...canvasFontNatives,
            ...canvasGraphicsNatives,
            ...gles2Natives,
            ...jsReferenceNatives,
            ...mediaBridgeNatives,
            ...midiBridgeNatives,
            async Java_pl_zb3_freej2me_bridge_shell_Shell_setTitle(lib, title) {
                document.title = title;
            },
            async Java_pl_zb3_freej2me_bridge_shell_Shell_setIcon(lib, iconBytes) {
                if (iconBytes) {
                    setFaviconFromBuffer(iconBytes.buffer);
                }
            },
            async Java_pl_zb3_freej2me_bridge_shell_Shell_getScreenCtx(lib) {
                return screenCtx;
            },
            async Java_pl_zb3_freej2me_bridge_shell_Shell_setCanvasSize(lib, width, height) {
                if (!scaleSet) {
                    const loadingEl = document.getElementById('loading');
                    if (loadingEl) loadingEl.hidden = true;
                    display.style.display = '';
                    scaleSet = true;
                    setTimeout(() => display.focus(), 50);
                }
                screenCtx.canvas.width = width;
                screenCtx.canvas.height = height;
                autoscale();
            },
            async Java_pl_zb3_freej2me_bridge_shell_Shell_waitForAndDispatchEvents(lib, listener) {
                const KeyEvent = await lib.pl.zb3.freej2me.bridge.shell.KeyEvent;
                const PointerEvent = await lib.pl.zb3.freej2me.bridge.shell.PointerEvent;

                const evt = await evtQueue.waitForEvent();
                if (evt.kind == 'keydown') {
                    await listener.keyPressed(await new KeyEvent(...evt.args));
                } else if (evt.kind == 'keyup') {
                    await listener.keyReleased(await new KeyEvent(...evt.args));
                } else if (evt.kind == 'pointerpressed') {
                    await listener.pointerPressed(await new PointerEvent(evt.x, evt.y));
                } else if (evt.kind == 'pointerdragged') {
                    await listener.pointerDragged(await new PointerEvent(evt.x, evt.y));
                } else if (evt.kind == 'pointerreleased') {
                    await listener.pointerReleased(await new PointerEvent(evt.x, evt.y));
                } else if (evt.kind == 'player-eom') {
                    await listener.playerEOM(evt.player);
                } else if (evt.kind == 'player-video-frame') {
                    await listener.playerVideoFrame(evt.player);
                }
            },
            async Java_pl_zb3_freej2me_bridge_shell_Shell_restart(lib) {
                location.reload();
            },
            async Java_pl_zb3_freej2me_bridge_shell_Shell_exit(lib) {
                location.href = './';
            },
            async Java_pl_zb3_freej2me_bridge_shell_Shell_sthop(lib) {
                debugger;
            },
            async Java_pl_zb3_freej2me_bridge_shell_Shell_say(lib, sth) {
                console.log('[say]', sth);
            },
            async Java_pl_zb3_freej2me_bridge_shell_Shell_sayObject(lib, label, obj) {
                debugger;
                console.log('[sayobject]', label, obj);
            }
        }
    });

    document.querySelector("#loading .loading-text").textContent = "Loading...";

    const lib = await cheerpjRunLibrary(cheerpjWebRoot+"/freej2me-web.jar");

    const FreeJ2ME = await lib.org.recompile.freej2me.FreeJ2ME;

    let args;

    if (sp.get('app')) {
        const app = sp.get('app');
        await ensureAppInstalled(lib, app);

        args = ['app', sp.get('app')];
    } else {
        let jarBytes = null;
        if (sp.get('mode') === 'direct' || (!sp.get('jar') && window.parent && window.parent !== window)) {
            document.querySelector("#loading .loading-text").textContent = "Đang chờ nạp game...";
            window.parent.postMessage({ type: 'EMULATOR_READY' }, window.location.origin);
            jarBytes = pendingJarBytes || await jarBytesPromise;
        } else {
            const rawJar = sp.get('jar') || "game.jar";
            const fetchUrl = rawJar.startsWith('http://') || rawJar.startsWith('https://')
                ? rawJar
                : (rawJar.startsWith('/') ? (window.location.origin + rawJar) : (cheerpjWebRoot + "/jar/" + rawJar));

            document.querySelector("#loading .loading-text").textContent = "Đang tải file game...";

            let res;
            try {
                res = await fetch(fetchUrl, { signal: AbortSignal.timeout(30000) });
            } catch (err) {
                showError("Không thể kết nối máy chủ để tải game. Vui lòng kiểm tra lại mạng.", true);
                return;
            }

            if (!res.ok) {
                if (res.status === 401 || res.status === 403) {
                    showError("Bạn không có quyền truy cập file game này hoặc game chưa được xuất bản.", false);
                } else if (res.status === 404) {
                    showError("Không tìm thấy file game trên máy chủ (HTTP 404).", false);
                } else {
                    showError(`Tải file game thất bại (HTTP ${res.status}).`, true);
                }
                return;
            }

            const ab = await res.arrayBuffer();
            jarBytes = new Uint8Array(ab);
        }

        // Validate ZIP magic header: PK (0x50, 0x4B)
        if (!jarBytes || jarBytes.length < 22 || jarBytes[0] !== 0x50 || jarBytes[1] !== 0x4B) {
            showError("Không tải được file game (dữ liệu không phải định dạng JAR/ZIP hợp lệ).", true);
            return;
        }

        document.querySelector("#loading .loading-text").textContent = "Đang khởi động trò chơi...";

        const jarName = getSafeJarName();
        const jarFilePath = `/str/${jarName}.jar`;

        try {
            if (typeof cheerpOSAddStringFile === 'function') {
                cheerpOSAddStringFile(jarFilePath, jarBytes);
            } else if (typeof window.cheerpOSAddStringFile === 'function') {
                window.cheerpOSAddStringFile(jarFilePath, jarBytes);
            } else {
                showError("Hệ thống tệp giả lập không khả dụng.", false);
                return;
            }
        } catch (e) {
            console.error('[Emulator] cheerpOSAddStringFile error:', e);
            showError("Không thể nạp file game vào bộ nhớ giả lập.", true);
            return;
        }

        args = ['jar', jarFilePath];
    }

    FreeJ2ME.main(args).catch(e => {
        console.error('[FreeJ2ME] Error running JAR:', e);
        showError("Trình giả lập gặp lỗi khi chạy game.", true, {
            errorType: 'CRASH',
            stack: [e?.stack || String(e), window.emulatorDiagnostics?.snapshot()].filter(Boolean).join('\n'),
        });
    });
}

window.emulatorDiagnostics?.onFatal(({ message, stack }) => {
    showError(message, true, { errorType: 'CRASH', stack });
});
init().catch(error => {
    showError('Không thể khởi tạo trình giả lập. Vui lòng thử tải lại.', true, {
        errorType: 'EMULATOR_ERROR', stack: error?.stack || String(error),
    });
});
