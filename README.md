# Nền Tảng Game Tuổi Thơ (J2ME Retro Platform)

Nền tảng lưu trữ, quản lý và trải nghiệm các tựa game Java cổ điển (J2ME) thời kỳ hoàng kim của điện thoại Nokia, Motorola, Sony Ericsson trên nền tảng Web hiện đại, sẵn sàng mở rộng cho ứng dụng Native Android APK và iOS.

**Trạng thái nghiệm thu:** Web MVP đang được review và sửa lỗi; emulator chưa được nghiệm thu theo lựa chọn của người dùng. Theo dõi bằng chứng và các việc còn mở trong [delivery board](docs/delivery-board.md). Các mục tính năng bên dưới cần được kiểm chứng theo `plan.md` trước khi coi là hoàn thành.

---

## ⚡ Chế Độ Chạy 1 Server Duy Nhất (Single Process + SQLite)

Repo hiện có adapter local để chạy **Frontend, Backend API và SQLite trong 1 tiến trình Node.js** trên **1 cổng mạng**. Mục tiêu triển khai Cloudflare Workers/D1/R2 vẫn theo `plan.md`; triển khai production chưa được nghiệm thu.

- 🌐 **Web Frontend (Astro 5 + React 19 + Tailwind CSS)**: Tự động phục vụ giao diện người dùng, trang chi tiết game và Web Emulator iframe.
- 🔌 **Backend REST API (Hono)**: Cung cấp đầy đủ endpoint `/api/v1/*` (xác thực, catalog, tìm kiếm, upload file, thư viện cá nhân, trang quản trị admin).
- 🗄️ **Cơ sở dữ liệu cục bộ (SQLite / better-sqlite3)**: Tự động khởi tạo schema và seed dữ liệu vào file `gametuoitho.sqlite`.
- 📁 **Lưu trữ file cục bộ (Local Storage)**: Lưu file game `.jar` và ảnh bìa trong thư mục `./uploads/`, hỗ trợ HTTP 206 `Range` streaming cho trình giả lập Web.

### Khởi Chạy Nhanh (1 Câu Lệnh)

```bash
# 1. Cài đặt các thư viện
pnpm install

# 2. Build giao diện web
pnpm build

# 3. Chạy Server hợp nhất (Mặc định cổng 4321)
pnpm start
```

Truy cập ngay trên trình duyệt:
- 🕹️ **Website & Chơi Game:** [http://localhost:4321](http://localhost:4321)
- 📑 **REST API v1:** [http://localhost:4321/api/v1](http://localhost:4321/api/v1)
- 🏥 **Kiểm tra trạng thái (Health):** [http://localhost:4321/health](http://localhost:4321/health)

### Tài Khoản Khởi Tạo Mẫu
| Vai trò | Tên đăng nhập / Email | Mật khẩu | Quyền hạn |
| :--- | :--- | :--- | :--- |
| **Quản trị viên (Admin)** | `admin` (`admin@gametuoitho.vn`) | `Admin@123456` | Quản lý Catalog, xuất bản game, duyệt uploads |
| **Người chơi (User)** | `gamer9x` (`gamer9x@gametuoitho.vn`) | `Gamer@123456` | Thư viện cá nhân, upload JAR riêng, yêu thích |

### Tùy Biến Cổng & Môi Trường
Bạn có thể thay đổi cổng chạy hoặc đường dẫn lưu file qua các biến môi trường:
```bash
# Đổi sang cổng 8080 (hoặc bất kỳ cổng nào trống)
PORT=8080 pnpm start

# Trên Windows PowerShell
$env:PORT=8080; pnpm start
```

---

## 🚀 Tính Năng Nổi Bật
- 🎮 **Chơi Game Trực Tiếp Trên Trình Duyệt:** Tích hợp Web Emulator chạy mượt mà đồ họa 2D Canvas và 3D WebGL (M3G), âm thanh MIDI FluidSynth.
- 📱 **Điều Khiển Linh Hoạt:** Bàn phím ảo Touch Keypad tùy biến cho cả màn hình dọc và xoay ngang, hỗ trợ đầy đủ phím bấm máy tính.
- 📚 **Game Catalog Phong Phú:** Quản lý hàng trăm tựa game huyền thoại (Ninja School, Diamond Rush, Bounce Tales, Avatar, Asphalt 3, Space Impact, v.v.).
- 💾 **Thư Viện Riêng (User Library):** Người dùng có thể đăng ký tài khoản, lưu game yêu thích, xem lịch sử chơi và tự upload/import file JAR riêng của mình.
- 🛡️ **Hệ Thống Quản Trị Toàn Diện (Admin Portal):** Quản lý Catalog, duyệt game, upload phiên bản mới, kiểm duyệt file tải lên, theo dõi dung lượng lưu trữ.
- 🔒 **Bảo Mật Tối Đa ([AGENTS.md](AGENTS.md)):** Không thực thi nhị phân JAR trên server, phân quyền nghiêm ngặt theo JWT Token, kiểm tra Magic Bytes file JAR (`0x50 0x4B 0x03 0x04`).

---

## 📂 Cấu Trúc Dự Án (Monorepo)
- `apps/web`: Website người dùng và trang quản trị (Astro 5 + React 19 + Tailwind CSS).
- `apps/api`: RESTful API backend (Hono + TypeScript + SQLite / D1 + Local Storage / R2).
- `apps/emulator-web`: Gói trình giả lập độc lập chạy trong Web Sandbox (CheerpJ + FreeJ2ME).
- `packages/shared-types`: Các kiểu dữ liệu dùng chung (Types & Interfaces).
- `packages/api-contracts`: Định dạng request/response API và Zod schemas.
- `packages/shared-utils`: Các hàm tiện ích, mã hóa mật khẩu PBKDF2 WebCrypto, xử lý file và validation.
- `database/`: Schema migrations và seed data cho SQLite / Cloudflare D1.
- `docs/`: Toàn bộ tài liệu kiến trúc, database, deployment và security.

---

## 🛠️ Lệnh Phát Triển & Kiểm Thử
```bash
# Chạy server hợp nhất ở chế độ dev (tự động reload khi sửa code)
pnpm dev

# Chạy riêng API dev server
pnpm dev:api

# Chạy riêng Web Frontend dev server
pnpm dev:web

# Chạy bộ test tích hợp API (10/10 passed)
pnpm test
```

## Điều phối agent Antigravity

Xem [hướng dẫn tiếp tục conversation Antigravity](docs/antigravity-agent-access.md) để dùng lại CLI, giao packet sửa lỗi và kiểm tra kết quả. Tiến độ review nằm trong [delivery board](docs/delivery-board.md).
