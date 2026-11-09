/**
 * Bảng ánh xạ phím mặc định cho trình giả lập J2ME.
 * Nguồn tham chiếu gốc: apps/emulator-web/src/keyMapper.js (ACTION_DEFINITIONS)
 */

export interface KeyGuideItem {
  key: string;
  action: string;
  description: string;
}

export const DEFAULT_KEY_MAPPINGS: KeyGuideItem[] = [
  { key: '↑ ↓ ← →', action: 'D-pad', description: 'Di chuyển / Điều hướng' },
  { key: 'Enter', action: 'OK / Chọn', description: 'Phím chọn giữa' },
  { key: 'F1', action: 'Phím mềm trái', description: 'Phím mềm trái (Soft Key 1)' },
  { key: 'F2', action: 'Phím mềm phải', description: 'Phím mềm phải (Soft Key 2)' },
  { key: 'Esc', action: 'Menu / Back', description: 'Quay lại / Menu' },
  { key: '0–9', action: 'Phím số', description: 'Hàng phím số hoặc Numpad 0–9' },
  { key: 'Numpad *', action: '*', description: 'Phím sao (*)' },
  { key: 'Numpad /', action: '#', description: 'Phím thăng (#)' },
];

export const KEYBOARD_HINT_MESSAGE = 'Bấm vào màn hình game để điều khiển bằng bàn phím';
export const DEFAULT_KEYS_NOTE = 'Đây là thiết lập phím mặc định của giả lập.';
