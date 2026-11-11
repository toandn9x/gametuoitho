import React from 'react';
import './SplitControls.css';

type RenderKey = (code: string, label: string, title: string, className: string, content: React.ReactNode) => React.ReactNode;
interface Props { visible: boolean; renderKey: RenderKey; }

export function SplitDpad({ visible, renderKey }: Props) {
  return (
    <div className="split-player__left" style={visible ? undefined : { display: 'none' }} role="group" aria-label="D-pad bên trái">
      <div className="split-player__dpad">
        {[
          ['ArrowUp', 'up', 'Lên', '▲'], ['ArrowLeft', 'left', 'Trái', '◀'],
          ['ArrowRight', 'right', 'Phải', '▶'], ['ArrowDown', 'down', 'Xuống', '▼'],
        ].map(([code, position, label, symbol]) => <React.Fragment key={code}>
          {renderKey(code, label, label, `split-player__key split-player__direction--${position}`, <span aria-hidden="true">{symbol}</span>)}
        </React.Fragment>)}
        <span className="split-player__dpad-center" aria-hidden="true">✚</span>
      </div>
      <span className="split-player__caption">Di chuyển</span>
    </div>
  );
}

export function SplitActions({ visible, renderKey }: Props) {
  return (
    <div className="split-player__right" style={visible ? undefined : { display: 'none' }} role="group" aria-label="Nút hành động bên phải">
      <div className="split-player__actions">
        {renderKey('F1', 'Phím mềm trái (F1)', 'Phím mềm trái · F1', 'split-player__key', 'L')}
        {renderKey('Enter', 'OK / Chọn (Enter)', 'OK / Chọn · Enter', 'split-player__key split-player__ok', 'OK')}
        {renderKey('F2', 'Phím mềm phải (F2)', 'Phím mềm phải · F2', 'split-player__key', 'R')}
      </div>
      <div className="split-player__numbers" role="group" aria-label="Phím số bên phải">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map(digit => {
          const code = digit === '*' ? 'NumpadMultiply' : digit === '#' ? 'NumpadDivide' : `Digit${digit}`;
          return <React.Fragment key={code}>{renderKey(code, `Phím ${digit}`, `Phím ${digit}`,
            `split-player__key${digit === '5' ? ' split-player__fire' : ''}`, digit)}</React.Fragment>;
        })}
      </div>
      {renderKey('Escape', 'Menu giả lập (Esc)', 'Menu giả lập · Esc', 'split-player__key split-player__menu', 'Menu · Esc')}
    </div>
  );
}
