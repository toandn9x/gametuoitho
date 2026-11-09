# Web Emulator Package (`apps/emulator-web`)

Trình giả lập J2ME trên trình duyệt được tách biệt hoàn toàn để chạy độc lập trong sandbox iframe.

## Tính năng
- Dựa trên CheerpJ 4.x và FreeJ2ME.
- Hỗ trợ render Canvas 2D & WebGL 2 (3D M3G).
- Bộ giải mã âm thanh FluidSynth WebAssembly cho MIDI và FFmpeg cho âm thanh nén.
- Bàn phím ảo Touch Keypad hỗ trợ màn hình dọc (portrait) và ngang (landscape).
- Hỗ trợ lưu trữ RMS vào IndexedDB qua `/files/`.

## Cách thức chạy độc lập hoặc nhúng:
- Truy cập trực tiếp: `run.html?jar=URL_TO_JAR` hoặc `run.html?app=APP_ID`
- Nhúng vào giao diện Web qua thẻ iframe:
  ```html
  <iframe src="/emulator/run.html?jar=..." sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-forms" />
  ```

> [!WARNING]
> **Giới hạn an toàn (Hạn chế F3 - Người dùng tạm hoãn):** Trên thực tế, do emulator hiện chạy trên cùng origin với website chính (`allow-scripts` kết hợp với `allow-same-origin`), sandbox này không cô lập được `localStorage`, IndexedDB hoặc cookie của trang web chính. Đây là hạn chế đã được ghi nhận trong Phase 0; người dùng đã lựa chọn tạm hoãn tách domain riêng cho iframe sang giai đoạn sau. Không tuyên bố cấu hình hiện tại là an toàn tuyệt đối.
