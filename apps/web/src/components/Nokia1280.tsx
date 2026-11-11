import React from 'react';
import './Nokia1280.css';

interface Nokia1280Props {
  children: React.ReactNode;
  className?: string;
  keypadRef?: React.Ref<HTMLDivElement>;
  keyHandlers?: (code: string) => React.ButtonHTMLAttributes<HTMLButtonElement>;
}

// The same frame serves the playable emulator and the homepage's static preview.
// Without handlers, keys are decorative spans so the preview can be a single link.
export default function Nokia1280({ children, className = '', keypadRef, keyHandlers }: Nokia1280Props) {
  const key = (code: string, label: string, title: string, style: string, content: React.ReactNode) =>
    keyHandlers ? (
      <button type="button" {...keyHandlers(code)} className={`nokia1280__key ${style}`} aria-label={label} title={title}>
        {content}
      </button>
    ) : (
      <span className={`nokia1280__key ${style}`} aria-hidden="true">{content}</span>
    );

  return (
    <div ref={keypadRef} className={`nokia1280 ${className}`} role="group" aria-label="Điện thoại Nokia 1280">
      <div className="nokia1280__top" aria-hidden="true">
        <div className="nokia1280__speaker" />
        <span className="nokia1280__brand">NOKIA</span>
      </div>

      <div className="nokia1280__bezel">
        <div className="nokia1280__screen">{children}</div>
      </div>

      <div className="nokia1280__controls" role={keyHandlers ? 'group' : undefined}
        aria-label={keyHandlers ? 'Phím điều hướng' : undefined} aria-hidden={!keyHandlers || undefined}>
        <div className="nokia1280__sidekeys">
          {key('F1', 'Phím mềm trái (F1)', 'Phím mềm trái · F1', 'nokia1280__function',
            <span className="nokia1280__softkey-mark" aria-hidden="true" />)}
          {key('Enter', 'Chọn / Đồng ý (Enter)', 'Chọn / Đồng ý · Enter', 'nokia1280__function nokia1280__call',
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m5 4 3-1 3 5-2 2a14 14 0 0 0 5 5l2-2 5 3-1 3c-.3 1-1.4 2-3 2C10 20 4 14 3 7c0-1.6 1-2.7 2-3Z" />
            </svg>)}
        </div>

        <div className="nokia1280__dpad">
          {[
            { code: 'ArrowUp', position: 'up', label: 'Lên', symbol: '▲' },
            { code: 'ArrowLeft', position: 'left', label: 'Trái', symbol: '◀' },
            { code: 'ArrowRight', position: 'right', label: 'Phải', symbol: '▶' },
            { code: 'ArrowDown', position: 'down', label: 'Xuống', symbol: '▼' },
          ].map(direction => (
            <React.Fragment key={direction.code}>
              {key(direction.code, direction.label, direction.label, `nokia1280__direction nokia1280__direction--${direction.position}`,
                <span aria-hidden="true">{direction.symbol}</span>)}
            </React.Fragment>
          ))}
          {key('Enter', 'OK / Chọn (Enter)', 'OK / Chọn · Enter', 'nokia1280__select', 'OK')}
        </div>

        <div className="nokia1280__sidekeys">
          {key('F2', 'Phím mềm phải (F2)', 'Phím mềm phải · F2', 'nokia1280__function',
            <span className="nokia1280__softkey-mark" aria-hidden="true" />)}
          {key('Escape', 'Quay lại / Menu (Esc)', 'Quay lại / Menu · Esc', 'nokia1280__function nokia1280__end',
            <svg viewBox="0 0 24 24" aria-hidden="true" style={{ transform: 'rotate(135deg)' }}>
              <path d="m5 4 3-1 3 5-2 2a14 14 0 0 0 5 5l2-2 5 3-1 3c-.3 1-1.4 2-3 2C10 20 4 14 3 7c0-1.6 1-2.7 2-3Z" />
            </svg>)}
        </div>
      </div>

      <div className="nokia1280__numbers" role={keyHandlers ? 'group' : undefined}
        aria-label={keyHandlers ? 'Bàn phím số' : undefined} aria-hidden={!keyHandlers || undefined}>
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
        ].map(number => (
          <React.Fragment key={number.code}>
            {key(number.code, `Phím ${number.digit}`, `Phím ${number.digit}`, 'nokia1280__number', <>
              <span className="nokia1280__digit">{number.digit}</span>
              <span className="nokia1280__letters" aria-hidden="true">{number.letters}</span>
            </>)}
          </React.Fragment>
        ))}
      </div>
      <div className="nokia1280__bottom" aria-hidden="true"><span /><span /><span /></div>
    </div>
  );
}
