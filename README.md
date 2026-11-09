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

### Khởi Chạy Nhanh

#### 1. Cài đặt thư viện và thiết lập biến môi trường
Server yêu cầu biến môi trường `JWT_SECRET` có độ dài tối thiểu 32 ký tự ngẫu nhiên để ký và xác thực token JWT. Khuyến nghị đặt `HOST=127.0.0.1` khi chạy local trên máy cá nhân để tránh bind công khai trên `0.0.0.0`.

**Trên Linux / macOS (Bash):**
```bash
pnpm install

# Thiết lập JWT_SECRET ngẫu nhiên (tối thiểu 32 ký tự) và bind local
export JWT_SECRET=$(openssl rand -hex 32)
export HOST=127.0.0.1
```

**Trên Windows (PowerShell):**
```powershell
pnpm install

# Thiết lập JWT_SECRET ngẫu nhiên bảo mật (tối thiểu 32 ký tự) và bind local
$b = New-Object byte[] 48; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); $env:JWT_SECRET = [Convert]::ToBase64String($b)
$env:HOST = "127.0.0.1"
```

#### 2. Khởi tạo tài khoản Quản trị viên (Admin) đầu tiên
Hệ thống không cài sẵn tài khoản hay mật khẩu mặc định vì lý do bảo mật. Bạn có thể bootstrap admin đầu tiên qua một trong hai cách:

- **Cách A: Dùng CLI tương tác hoặc biến môi trường (Khuyến nghị):**
  ```bash
  # Nhập tương tác an toàn qua terminal (mật khẩu được ẩn và không lưu vào lịch sử shell):
  pnpm --filter @gametuoitho/api create-admin

  # Hoặc thiết lập qua biến môi trường trước khi chạy CLI:
  ADMIN_BOOTSTRAP_PASSWORD="<your-secure-password>" pnpm --filter @gametuoitho/api create-admin --username admin --email admin@example.com
  ```
  *(Cảnh báo: Nếu bạn dùng trực tiếp cờ `--password "..."`, mật khẩu có thể bị lưu lại trong lịch sử shell của hệ thống; không khuyến nghị trên máy dùng chung).*
- **Cách B: Thiết lập biến môi trường trước khi chạy server:**
  ```bash
  # Bash:
  export ADMIN_BOOTSTRAP_USERNAME="admin"
  export ADMIN_BOOTSTRAP_EMAIL="admin@example.com"
  export ADMIN_BOOTSTRAP_PASSWORD="<your-secure-password>"
  ```
  ```powershell
  # PowerShell:
  $env:ADMIN_BOOTSTRAP_USERNAME = "admin"
  $env:ADMIN_BOOTSTRAP_EMAIL = "admin@example.com"
  $env:ADMIN_BOOTSTRAP_PASSWORD = "<your-secure-password>"
  ```
  *Lưu ý:* Cơ chế bootstrap môi trường mang tính chất idempotent; nếu database đã có ít nhất một admin, các biến này sẽ tự động bị bỏ qua và mật khẩu không bao giờ được ghi vào log.

#### 3. Build giao diện và chạy server
```bash
# Build frontend web tĩnh
pnpm build

# Khởi chạy server hợp nhất (Mặc định cổng 4321)
pnpm start
```

Truy cập ngay trên trình duyệt:
- 🕹️ **Website & Chơi Game:** [http://localhost:4321](http://localhost:4321)
- ⚙️ **Quản trị hệ thống (Admin):** [http://localhost:4321/admin](http://localhost:4321/admin) (Đăng nhập bằng tài khoản admin vừa tạo)
- 📑 **REST API v1:** [http://localhost:4321/api/v1](http://localhost:4321/api/v1)
- 🏥 **Kiểm tra trạng thái (Health):** [http://localhost:4321/health](http://localhost:4321/health)

### Lưu Ý An Toàn & Bảo Mật (Security Advisory)
> [!WARNING]
> - **Cơ sở dữ liệu cũ:** Nếu bạn đang sử dụng cơ sở dữ liệu (`gametuoitho.sqlite`) từ phiên bản cũ từng chứa tài khoản quản trị viên hoặc mật khẩu thử nghiệm công khai trong lịch sử commit, bạn **BẮT BUỘC** phải xóa file database cũ (`rm gametuoitho.sqlite`) để hệ thống khởi tạo lại sạch từ đầu, sau đó tạo admin mới bằng cơ chế bootstrap trên.
> - **Đổi mật khẩu:** Hiện tại giao diện người dùng Web chưa hỗ trợ chức năng đổi mật khẩu (backlog limitation). Do đó trên môi trường phát triển local, cách an toàn nhất để đặt lại tài khoản là tạo mới database.

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

### Luồng Thêm Game Vào Catalog & Trải Nghiệm
1. **Thêm qua Admin Upload:**
   - Quản trị viên truy cập `/admin/games/create`, điền metadata (tên, thể loại, nhà phát triển, năm phát hành) và tải lên file JAR (kèm JAD/ảnh bìa tùy chọn).
   - Game được tạo ở trạng thái **`DRAFT`** (nháp, chưa xuất bản) và asset ở trạng thái `ACTIVE`.
2. **Thêm qua Nguồn Crawler:**
   - Quản trị viên truy cập `/admin/crawler`, tìm kiếm game từ nguồn `gametuoitho.cc` và bấm "Nhập Game".
   - File JAR và ảnh được tải về kiểm thực an toàn, tạo bản ghi game ở trạng thái **`DRAFT`** (không tự động public ra Catalog).
3. **Kiểm tra và Xuất bản (Publish):**
   - Quản trị viên kiểm tra phiên bản JAR hợp lệ, sau đó bấm "Xuất bản" (`status = 'PUBLISHED'`, `visibility = 'PUBLIC'`).
   - Game lập tức xuất hiện trên Catalog công khai và người dùng có thể chơi trực tiếp hoặc thêm vào Thư viện cá nhân.

---

## 🛠️ Lệnh Phát Triển & Kiểm Thử
```bash
# Chạy server hợp nhất ở chế độ dev (tự động reload khi sửa code)
pnpm dev

# Chạy riêng API dev server
pnpm dev:api

# Chạy riêng Web Frontend dev server
pnpm dev:web

# Chạy toàn bộ kiểm thử tự động API & DB
pnpm test

# Chạy kiểm tra kiểu TypeScript monorepo
pnpm lint

# Build các ứng dụng
pnpm --filter @gametuoitho/api build
pnpm --filter @gametuoitho/web build

# Bộ nghiệm thu PM độc lập
pnpm --filter @gametuoitho/api exec tsx ../../tests/pm/asset-review.ts
node tests/pm/admin-render-review.cjs
```
