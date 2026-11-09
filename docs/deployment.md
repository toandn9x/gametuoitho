# Hướng Dẫn Triển Khai Nền Tảng Game Tuổi Thơ (Deployment Guide)

Theo kế hoạch kiến trúc tại `plan.md`, hệ thống hướng tới **mục tiêu production chính thức trên Cloudflare (Serverless: Workers + D1 + R2 + Pages)** nhằm tối ưu chi phí và độ trễ toàn cầu.

Song song đó, repo cung cấp một **Adapter máy chủ hợp nhất (Unified Server: Node.js + SQLite)** phục vụ cho quá trình phát triển cục bộ (local development), chạy kiểm thử tích hợp E2E hoặc cho các môi trường tự host (self-hosting VPS/Docker) đơn giản.

---

## PHƯƠNG ÁN 1: Môi Trường Tự Host & Local Development (Node.js + SQLite Adapter)

> [!NOTE]
> Đây là adapter chạy toàn bộ Frontend + Backend API + Database SQLite + Local File Storage trong 1 tiến trình duy nhất phục vụ phát triển hoặc máy chủ riêng, không phải mục tiêu production Cloudflare của plan.

### 1. Kiến Trúc Server Hợp Nhất
- **Cổng dịch vụ:** 1 cổng duy nhất (Ví dụ `4321` hoặc `80` hoặc `8080`).
- **Frontend:** Astro 5 Static Pages & React Components được serve trực tiếp từ `./apps/web/dist`.
- **Backend API:** Hono REST API chạy tại `/api/v1/*`.
- **Database:** SQLite file `./gametuoitho.sqlite` tự động chạy migration runner cập nhật schema.
- **File Storage:** Thư mục `./uploads/` lưu trữ JAR và Covers cục bộ với hỗ trợ HTTP 206 `Range` header.

### 2. Biến Môi Trường & Khởi Tạo Quản Trị Viên (Admin Bootstrap)

#### Biến Môi Trường Bắt Buộc
- `JWT_SECRET`: Chuỗi khóa bảo mật ngẫu nhiên tối thiểu 32 ký tự dùng để ký JWT.
  - **Bash (Linux/macOS):** `export JWT_SECRET=$(openssl rand -hex 32)`
  - **PowerShell (Windows):** `$b = New-Object byte[] 48; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); $env:JWT_SECRET = [Convert]::ToBase64String($b)`
- `HOST`: Khuyến nghị đặt `HOST=127.0.0.1` khi chạy local hoặc sau Nginx Reverse Proxy để tránh bind công khai trên `0.0.0.0`.
- `PORT`: Cổng dịch vụ (mặc định `4321`).

#### Khởi Tạo Quản Trị Viên Đầu Tiên (Bootstrap Admin)
Vì lý do an toàn, database ban đầu không chứa tài khoản hay mật khẩu mặc định:
- **Cách 1: Sử dụng CLI chuyên dụng:**
  ```bash
  # Nhập tương tác an toàn (mật khẩu ẩn, không lưu lịch sử shell):
  pnpm --filter @gametuoitho/api create-admin

  # Hoặc thông qua biến môi trường:
  ADMIN_BOOTSTRAP_PASSWORD="<your-secure-password>" pnpm --filter @gametuoitho/api create-admin --username admin --email admin@example.com
  ```
  *(Cảnh báo: Nếu truyền mật khẩu bằng tham số dòng lệnh `--password "..."`, mật khẩu có thể bị lưu trong lịch sử shell).*
- **Cách 2: Sử dụng biến môi trường khi khởi động server lần đầu:**
  ```bash
  export ADMIN_BOOTSTRAP_USERNAME="admin"
  export ADMIN_BOOTSTRAP_EMAIL="admin@example.com"
  export ADMIN_BOOTSTRAP_PASSWORD="<your-secure-password>"
  ```
  *(Cơ chế này mang tính idempotent: tự động bỏ qua nếu DB đã có ít nhất một admin; mật khẩu không bao giờ được ghi vào log).*

> [!WARNING]
> **Cảnh báo bảo mật với cơ sở dữ liệu cũ:** Nếu bạn đang dùng database cũ từng chứa tài khoản quản trị viên với mật khẩu mặc định đã từng công khai trong commit trước, hãy xóa database cũ (`gametuoitho.sqlite`) để tạo lại từ đầu. Giao diện Web hiện chưa hỗ trợ đổi mật khẩu (backlog limitation).

### 3. Triển Khai Trên VPS với PM2
```bash
# 1. Clone repository
git clone <repo_url>
cd gametuoitho

# 2. Cài đặt pnpm và dependencies
corepack enable
pnpm install

# 3. Thiết lập biến môi trường JWT_SECRET và HOST
export JWT_SECRET=$(openssl rand -hex 32)
export HOST=127.0.0.1

# 4. Tạo admin đầu tiên qua CLI tương tác
pnpm --filter @gametuoitho/api create-admin

# 5. Build Web Frontend
pnpm build

# 6. Chạy dịch vụ nền bằng PM2
pnpm add -g pm2
PORT=4321 pm2 start "pnpm start" --name "gametuoitho"

# 7. Lưu trạng thái PM2 tự khởi động khi reboot server
pm2 save
pm2 startup
```

### 4. Cấu Hình Nginx Reverse Proxy (Tùy Chọn)
Nếu bạn muốn trỏ tên miền (ví dụ: `gametuoitho.vn`):
```nginx
server {
    listen 80;
    server_name gametuoitho.vn www.gametuoitho.vn;

    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:4321;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

### 4. Cơ Chế Dynamic Shell Rewrites & Xử Lý 404
Nền tảng sử dụng kiến trúc Static Pre-rendering kết hợp Dynamic Client Shell để đảm bảo:
- Các game và chuyên mục đã có lúc build được sinh file HTML tĩnh phục vụ SEO tối ưu.
- Game mới được Admin xuất bản (publish) sau thời điểm build vẫn có thể truy cập và chơi ngay lập tức mà **không cần rebuild lại frontend**.
- Server trả về **HTTP 404** chuẩn mực cho các tài nguyên không tồn tại (tránh việc trả về mã 200 kèm HTML trang chủ làm emulator CheerpJ crash).

Cấu hình rewrites:
- `/play/*` -> `/play/_shell/index.html` (HTTP 200)
- `/game/*` -> `/game/_shell/index.html` (HTTP 200)
- `/categories/*` -> `/categories/_shell/index.html` (HTTP 200)
- Mọi route khác không tồn tại -> Trả về `404.html` (HTTP 404)

---

## PHƯƠNG ÁN 2: Triển Khai Phân Tán Serverless (Cloudflare)

Tối ưu chi phí $0 cho traffic toàn cầu với Cloudflare:

### 1. Tạo D1 Database & Áp Dụng Schema Migrations
Khởi tạo cơ sở dữ liệu Cloudflare D1 và áp dụng tuần tự các migration:
```bash
# Tạo database D1
wrangler d1 create gametuoitho-d1

# Áp dụng các migration theo thứ tự
wrangler d1 execute gametuoitho-d1 --file=./database/migrations/0001_initial_schema.sql --remote
wrangler d1 execute gametuoitho-d1 --file=./database/migrations/0002_crash_reports.sql --remote
wrangler d1 execute gametuoitho-d1 --file=./database/migrations/0003_token_version.sql --remote
wrangler d1 execute gametuoitho-d1 --file=./database/migrations/0004_library_constraints.sql --remote
```

> [!CAUTION]
> **Không seed dữ liệu mẫu lên Production:** Tuyệt đối không thực thi file `database/seeds/0001_seed_data.sql` lên môi trường Production. Danh mục game và thể loại trên Production phải được khởi tạo và kiểm duyệt chính thức thông qua Admin Portal hoặc API quản trị viên.

### 2. Tạo R2 Storage Bucket
```bash
wrangler r2 bucket create gametuoitho-assets
```

### 3. Deploy Backend Worker API
> [!IMPORTANT]
> `JWT_SECRET` bắt buộc phải có độ dài tối thiểu 32 ký tự ngẫu nhiên trong môi trường Production.
```bash
cd apps/api
wrangler secret put JWT_SECRET
wrangler deploy
```

### 4. Deploy Web Frontend (Cloudflare Pages)
```bash
cd apps/web
PUBLIC_API_URL=https://api.gametuoitho.vn/api/v1 pnpm build
npx wrangler pages deploy dist --project-name gametuoitho-web
```
