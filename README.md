# Nền Tảng Game Tuổi Thơ (J2ME Retro Platform)

Nền tảng lưu trữ, quản lý và trải nghiệm các tựa game Java cổ điển (J2ME) thời kỳ hoàng kim của điện thoại Nokia, Motorola, Sony Ericsson trên nền tảng Web hiện đại, sẵn sàng mở rộng cho ứng dụng Native Android APK và iOS.

## 🚀 Tính Năng Chính
- 🎮 **Chơi Game Trực Tiếp Trên Trình Duyệt:** Tích hợp Web Emulator chạy mượt mà đồ họa 2D Canvas và 3D WebGL (M3G), âm thanh MIDI FluidSynth.
- 📱 **Điều Khiển Linh Hoạt:** Bàn phím ảo Touch Keypad tùy biến cho cả màn hình dọc và xoay ngang, hỗ trợ đầy đủ phím bấm máy tính.
- 📚 **Game Catalog Phong Phú:** Quản lý hàng trăm tựa game huyền thoại (Ninja School, Diamond Rush, Bounce Tales, Avatar, Gomoku, v.v.).
- 💾 **Thư Viện Riêng (User Library):** Người dùng có thể đăng ký tài khoản, lưu game yêu thích, xem lịch sử chơi và tự upload/import file JAR/JAD riêng của mình.
- 🛡️ **Hệ Thống Quản Trị Toàn Diện (Admin Portal):** Quản lý Catalog, duyệt game, upload phiên bản mới, kiểm duyệt file tải lên, theo dõi dung lượng lưu trữ R2 và nhật ký hệ thống.
- ⚡ **Hạ Tầng Hiện Đại:** Hono API trên Cloudflare Workers, Cloudflare D1 Database, Cloudflare R2 Object Storage và Astro/React UI.

## 📂 Cấu Trúc Dự Án (Monorepo)
- `apps/web`: Website người dùng và trang quản trị (Astro + React + TypeScript + Tailwind CSS).
- `apps/api`: RESTful API backend (Hono + TypeScript + Cloudflare Workers / D1 / R2).
- `apps/emulator-web`: Gói trình giả lập độc lập chạy trong Web Sandbox (CheerpJ + FreeJ2ME).
- `packages/shared-types`: Các kiểu dữ liệu dùng chung (Types & Interfaces).
- `packages/api-contracts`: Định dạng request/response API và Zod schemas.
- `packages/shared-utils`: Các hàm tiện ích, mã hóa, xử lý file và validation.
- `database/`: Schema migrations và seed data cho Cloudflare D1 / SQLite.
- `docs/`: Toàn bộ tài liệu kiến trúc, database, deployment và security.

## 🛠️ Hướng Dẫn Cài Đặt & Chạy Môi Trường Phát Triển
```bash
# 1. Cài đặt dependencies
pnpm install

# 2. Khởi chạy API
pnpm dev:api

# 3. Khởi chạy Web Frontend
pnpm dev:web
```
