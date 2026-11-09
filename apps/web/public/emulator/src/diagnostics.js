// Install before CheerpJ's loader: Java catches some failures and only prints them.
(() => {
    const limit = 8000;
    let history = '';
    let fatalLog = null;
    let handler = null;
    let timer = null;
    let deadline = null;
    let delivered = false;
    const fatalMarker = /Error Running Jar|Problem with setCurrent\(next\)|Problem Constructing [^\n]*class:/;

    function redact(value) {
        return String(value)
            .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_JWT]')
            .replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [REDACTED]')
            .replace(/((?:[?&]|\b)(?:access_token|refresh_token|token|jwt|api_key|apikey|password|secret|authorization|cookie)\s*[=:]\s*)[^\s&"'<>]+/gi, '$1[REDACTED]');
    }

    function bounded(text) {
        return text.length <= limit ? text : text.slice(0, 3000) + '\n[...truncated...]\n' + text.slice(-4900);
    }

    function deliver() {
        if (!handler || delivered || fatalLog === null) return;
        delivered = true;
        clearTimeout(timer);
        clearTimeout(deadline);
        handler({ message: 'Trình giả lập gặp lỗi khi khởi động game.', stack: bounded(fatalLog) });
    }

    for (const level of ['log', 'warn', 'error']) {
        const original = console[level];
        console[level] = function (...args) {
            original.apply(console, args);
            // Never traverse arbitrary Java/game objects or serialize game data.
            const text = redact(args.map(value => typeof value === 'string' ? value : value instanceof Error ? value.stack || value.message : '').join(' ')).slice(0, limit);
            if (!text || delivered) return;
            history = (history + text).slice(-limit);
            if (fatalLog !== null) fatalLog = bounded(fatalLog + text);
            else if (fatalMarker.test(history)) {
                fatalLog = history;
                deadline = setTimeout(deliver, 1000);
            }
            if (fatalLog !== null) {
                clearTimeout(timer);
                timer = setTimeout(deliver, 200);
            }
        };
    }

    window.emulatorDiagnostics = {
        onFatal(callback) {
            handler = callback;
            if (fatalLog !== null) timer = setTimeout(deliver, 200);
        },
        snapshot: () => bounded(fatalLog ?? history),
        redact,
    };
})();
