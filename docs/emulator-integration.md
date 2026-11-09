# Tài liệu Tích hợp Web Emulator (Emulator Integration Report)

> **Trạng thái: CHƯA NGHIỆM THU.** Ngày 09/11/2026, người dùng yêu cầu tiếp tục sửa hệ thống và giữ emulator ở trạng thái chưa nghiệm thu. Nội dung khảo sát, license và khả năng tích hợp dưới đây cần được đối chiếu với upstream và bằng chứng thực tế trước khi dùng để kết luận. Chưa có đủ kết quả game/version/hash/browser/device theo gate Phase 0.

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

### Cơ chế nạp JAR và lưu trữ RMS hiện tại
1. **Nạp nhị phân JAR vào Runtime:**
   - Trình duyệt tải dữ liệu file JAR dưới dạng byte stream hoặc `ArrayBuffer` từ endpoint phát asset (`/api/v1/assets/raw/...`).
   - Sử dụng API hệ thống tệp ảo của CheerpJ: `cheerpOSAddStringFile('/str/<appId>.jar', jarBinary)` để nạp trực tiếp file nhị phân vào bộ nhớ ảo.
   - Khởi chạy FreeJ2ME thông qua lớp thực thi Java: gọi `FreeJ2ME.main` hoặc `CheerpJ.run('com.freej2me.FreeJ2ME', ['-jar', '/str/<appId>.jar', ...])`.
2. **Cơ chế cô lập lưu trữ RMS (Record Management System):**
   - Dữ liệu lưu game (RMS) được lưu trữ vào IndexedDB của trình duyệt thông qua phân vùng ảo `/files/`.
   - Mỗi tựa game được cấp một namespace định danh riêng biệt (ví dụ `/files/rms/<appId>/` hoặc dựa trên hash/slug của trò chơi).
   - Cơ chế này đảm bảo dữ liệu RMS của các game khác nhau không bị ghi đè hay xung đột khi chơi nhiều trò trên cùng một trình duyệt.

### Cơ chế Sandbox và Giới hạn hiện tại
- Emulator được chạy bên trong thẻ `<iframe>` với các thuộc tính sandbox:
  `sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-forms"`
- Tuyệt đối **không truyền Authorization Token hay JWT** của Admin/User vào context của Emulator iframe.
- Giao tiếp giữa Host Website và Emulator iframe thông qua cơ chế `postMessage` có kiểm tra `origin`.

> [!WARNING]
> **Hạn chế bảo mật F3 (Người dùng đã tạm hoãn):** Trên thực tế, do emulator hiện chạy trên **cùng origin** với website chính, việc kết hợp giữa `allow-scripts` và `allow-same-origin` không thể cô lập hoàn toàn `localStorage`, IndexedDB hay cookie của trang chính. Đây là hạn chế kỹ thuật đã được ghi nhận; người dùng đã quyết định tạm hoãn việc phân tách tên miền/origin riêng cho emulator sang giai đoạn sau. Không tuyên bố cấu hình hiện tại là đã cô lập origin an toàn.

---

## 5. Ma trận tương thích chờ xác minh

Các tên game dưới đây là danh sách dự kiến từ báo cáo ban đầu. Chưa có bằng chứng đủ để giữ các kết luận hiệu năng “hoàn hảo/mượt mà” trước đây; không dùng chúng để nghiệm thu.

| Game dự kiến | JAR version/hash | Emulator revision | Browser/device | Khởi chạy, đồ họa, âm thanh, phím, RMS | Trạng thái |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Ninja School | Chưa ghi nhận | Chưa ghi nhận | Chưa ghi nhận | Chưa có bằng chứng | CHƯA XÁC MINH |
| Diamond Rush | Chưa ghi nhận | Chưa ghi nhận | Chưa ghi nhận | Chưa có bằng chứng | CHƯA XÁC MINH |
| Bounce Tales | Chưa ghi nhận | Chưa ghi nhận | Chưa ghi nhận | Chưa có bằng chứng | CHƯA XÁC MINH |
| Avatar | Chưa ghi nhận | Chưa ghi nhận | Chưa ghi nhận | Chưa có bằng chứng | CHƯA XÁC MINH |
| Gomoku / Cờ Caro | Chưa ghi nhận | Chưa ghi nhận | Chưa ghi nhận | Chưa có bằng chứng | CHƯA XÁC MINH |
| Space Impact | Chưa ghi nhận | Chưa ghi nhận | Chưa ghi nhận | Chưa có bằng chứng | CHƯA XÁC MINH |
| Asphalt 3 / game 3D | Chưa ghi nhận | Chưa ghi nhận | Chưa ghi nhận | Chưa có bằng chứng | CHƯA XÁC MINH |

Phase 0 cần ít nhất 10 game đại diện được phép dùng để kiểm thử, cùng kết quả và bằng chứng thực tế. JAR fixture hoặc archive chỉ có manifest không phải game chạy được. Không thực thi JAR trên server; kiểm thử chạy game thuộc trình duyệt/client. Hiện tiếp tục sửa hệ thống, chưa chuyển trạng thái emulator sang đạt.

---

## 6. Hướng dẫn Triển khai & Yêu cầu HTTP Server
- CheerpJ yêu cầu máy chủ phân phối HTTP hỗ trợ tiêu đề `Range` (`Accept-Ranges: bytes` & `206 Partial Content`).
- Cloudflare Pages, Cloudflare Workers, Cloudflare R2 và local server (`serve`, `hono/node-server`, `vite`) đều đáp ứng trọn vẹn yêu cầu này.
