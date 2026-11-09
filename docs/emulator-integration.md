# Tài liệu Tích hợp Web Emulator (Emulator Integration Report)

## 1. Giới thiệu & Mục tiêu
Tài liệu này thuộc **Phase 0** theo kế hoạch `plan.md`. Mục tiêu là nghiên cứu, đánh giá các công nghệ emulator Java ME (J2ME) trên nền tảng Web, xác định giải pháp tối ưu và thiết kế kiến trúc adapter độc lập để nhúng vào nền tảng **Game Tuổi Thơ**.

---

## 2. Khảo sát các giải pháp Emulator ứng viên

| Tiêu chí | `iqbaladinur/j2me-player` (Chọn) | `zb3/freej2me-web` | `L1games/J2ME-On-Web` |
| :--- | :--- | :--- | :--- |
| **Nền tảng lõi** | FreeJ2ME + CheerpJ 4.1 | FreeJ2ME + CheerpJ 3/4 | J2ME-Plus / CheerpJ |
| **Graphics** | Canvas 2D (nhanh) + WebGL 2 (M3G/Mascot Capsule v3) | Canvas 2D + WebGL 2 | AWT / Canvas cơ bản |
| **Âm thanh** | WebAssembly FluidSynth (MIDI) + FFmpeg (WAV/AMR) | WebAssembly FluidSynth | WebAudio cơ bản |
| **Giao diện & Điều khiển** | Responsive Retro UI, Virtual Touch Keypad (Portrait/Landscape), Phím tùy chỉnh | UI tối giản, cần tự xây thêm keypad | UI cơ bản, chưa tối ưu mobile |
| **Lưu trữ RMS** | CheerpJ virtual file system `/files/` (IndexedDB tự động) | IndexedDB / Local | LocalStorage |
| **License** | GPL-3.0 (phù hợp mã nguồn mở client) | GPL-3.0 | Mở |
| **Tình trạng bảo trì** | Cập nhật CheerpJ 4.1, hỗ trợ Cloudflare Pages/CDN Range Headers | Hoạt động tốt | Ít cập nhật |

### Kết luận lựa chọn:
Chúng tôi chọn kiến trúc dựa trên **FreeJ2ME Web / J2ME Player**:
1. Sử dụng **CheerpJ 4.1** runtime chạy trực tiếp Java bytecode trong WebAssembly của trình duyệt.
2. Render đồ họa 2D qua HTML5 Canvas độc lập (không phụ thuộc Java AWT nặng nề).
3. Hỗ trợ đồ họa 3D qua WebGL 2 (M3G).
4. Bộ giải mã âm thanh MIDI FluidSynth được biên dịch sang WebAssembly.
5. Touch Keypad responsive hỗ trợ cả điện thoại dọc và ngang.

---

## 3. Phân tích Bản quyền & Giấy phép (License & Compliance)

1. **FreeJ2ME**: Giấy phép **GNU General Public License v3.0 (GPL-3.0)**.
   - Module `apps/emulator-web` tuân thủ GPLv3.
   - Emulator được đóng gói độc lập trong iframe sandbox, tách biệt khỏi website chính và Backend API để bảo đảm ranh giới kiến trúc (Clean Boundary Isolation).
2. **FluidSynth (`libmidi`)**: Giấy phép **LGPL-2.1**.
3. **FFmpeg (`libmedia`)**: Giấy phép **LGPL-2.1 / GPL-2.0**.
4. **CheerpJ Runtime**:
   - Do Leaning Technologies phát triển. CheerpJ 4.x cung cấp loader miễn phí cho các ứng dụng public web / phi thương mại.
   - Emulator chỉ sử dụng CheerpJ cho Java bytecode execution tối thiểu, không can thiệp sâu vào nhân thương mại.
5. **Dữ liệu Game JAR**:
   - Game Catalog chỉ xuất bản các game có quyền phân phối hoặc giấy phép cho phép lưu trữ.
   - Game do người dùng import được lưu trữ riêng tư trong tài khoản (`visibility = PRIVATE`), không công khai ra Catalog.

---

## 4. Kiến trúc Adapter (`GameEmulatorAdapter`)

Để Frontend không bị phụ thuộc chặt vào một loại emulator cụ thể, chúng tôi áp dụng mẫu thiết kế **Adapter Pattern**:

```typescript
export interface GameEmulatorConfig {
  container: HTMLElement;
  jarUrl: string;
  jadUrl?: string;
  gameId: string;
  title: string;
  screenSize?: { width: number; height: number };
  phoneType?: 'Standard' | 'Nokia' | 'Motorola' | 'Siemens' | 'SonyEricsson';
  enableSound?: boolean;
  onReady?: () => void;
  onError?: (err: Error) => void;
  onExit?: () => void;
}

export interface GameEmulatorInstance {
  start(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
  sendKey(keyCode: string, isDown: boolean): void;
  enterFullscreen(): Promise<void>;
  destroy(): void;
}
```

### Cơ chế Sandbox bảo mật:
- Emulator được chạy bên trong thẻ `<iframe>` với các thuộc tính sandbox:
  `sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-forms"`
- Tuyệt đối **không truyền Authorization Token hay JWT** của Admin/User vào context của Emulator iframe.
- Giao tiếp giữa Host Website và Emulator iframe thông qua cơ chế `postMessage` có kiểm tra `origin` an toàn.

---

## 5. Kết quả Thử nghiệm Tương thích (Compatibility Report)

Đã kiểm tra danh sách đại diện các thể loại game J2ME:

| Tên Game | Thể loại | Phân giải chuẩn | Âm thanh | Keypad | Kết quả | Ghi chú |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Ninja School** | ARPG 2D | 240x320 | MIDI | Full 0-9, Softkeys | **Mượt mà** | Đồ họa sắc nét, chuyển cảnh nhanh |
| **Diamond Rush** | Puzzle/Adventure | 240x320 | MIDI/SFX | D-Pad, 2,4,6,8 | **Hoàn hảo** | Gameplay ổn định, lưu RMS tốt |
| **Bounce Tales** | Platformer 2D | 240x320 | MIDI | D-Pad / Softkeys | **Hoàn hảo** | Hiệu ứng bóng nảy vật lý chuẩn |
| **Avatar (Thành phố Diệu kỳ)** | Social/Casual | 240x320 | SFX | Phím số, Softkeys | **Tốt** | Font chữ hiển thị rõ ràng |
| **Gomoku / Cờ Caro** | Trí tuệ 2D | 176x208 / 240x320 | Bíp/MIDI | D-Pad, Enter | **Hoàn hảo** | Nhẹ, tải tức thì |
| **Space Impact** | Bắn phi thuyền | 96x65 / 128x128 | Bíp 8-bit | D-Pad, 5/Enter | **Hoàn hảo** | Cảm giác hoài niệm Nokia monochrome |
| **Asphalt 3 / 3D Games** | Đua xe 3D | 240x320 | Đầy đủ | Phím số 4, 6, 2, 8 | **Khá** | WebGL2 xử lý tốt polygon 3D cơ bản |

---

## 6. Hướng dẫn Triển khai & Yêu cầu HTTP Server
- CheerpJ yêu cầu máy chủ phân phối HTTP hỗ trợ tiêu đề `Range` (`Accept-Ranges: bytes` & `206 Partial Content`).
- Cloudflare Pages, Cloudflare Workers, Cloudflare R2 và local server (`serve`, `hono/node-server`, `vite`) đều đáp ứng trọn vẹn yêu cầu này.
