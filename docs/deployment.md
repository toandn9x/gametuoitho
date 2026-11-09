# Hướng Dẫn Triển Khai Nền Tảng Game Tuổi Thơ (Deployment Guide)

Nền tảng hỗ trợ 2 mô hình triển khai linh hoạt:
1. **Mô hình 1 Server Tinh Gọn (Single Server Node.js + SQLite):** Toàn bộ Frontend + Backend API + Database SQLite + Local File Storage chạy trong 1 tiến trình duy nhất trên VPS/Server riêng/Docker.
2. **Mô hình Serverless (Cloudflare Workers + D1 + R2 + Pages):** Triển khai phân tán toàn cầu trên hạ tầng Cloudflare.

---

## PHƯƠNG ÁN 1: Triển Khai 1 Server Duy Nhất (Node.js + SQLite)

Đây là phương án đơn giản, tiết kiệm và dễ quản lý nhất cho máy chủ riêng (VPS Ubuntu/Debian, Windows Server hoặc Docker):

### 1. Kiến Trúc 1 Server
- **Cổng dịch vụ:** 1 cổng duy nhất (Ví dụ `4321` hoặc `80` hoặc `8080`).
- **Frontend:** Astro 5 Static Pages & React Components được serve trực tiếp từ `./apps/web/dist`.
- **Backend API:** Hono REST API chạy tại `/api/v1/*`.
- **Database:** SQLite file `./gametuoitho.sqlite` tự động tạo schema & seed dữ liệu mẫu khi khởi động.
- **File Storage:** Thư mục `./uploads/` lưu trữ JAR và Covers cục bộ với hỗ trợ HTTP 206 `Range` header.

### 2. Triển Khai Trên VPS với PM2
```bash
# 1. Clone repository
git clone <repo_url>
cd gametuoitho

# 2. Cài đặt pnpm và dependencies
corepack enable
pnpm install

# 3. Build Web Frontend
pnpm build

# 4. Chạy dịch vụ nền bằng PM2
pnpm add -g pm2
PORT=4321 pm2 start "pnpm start" --name "gametuoitho"

# 5. Lưu trạng thái PM2 tự khởi động khi reboot server
pm2 save
pm2 startup
```

### 3. Cấu Hình Nginx Reverse Proxy (Tùy Chọn)
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

---

## PHƯƠNG ÁN 2: Triển Khai Phân Tán Serverless (Cloudflare)

Tối ưu chi phí $0 cho traffic toàn cầu với Cloudflare:

### 1. Tạo D1 Database
```bash
wrangler d1 create gametuoitho-d1
wrangler d1 execute gametuoitho-d1 --file=./database/migrations/0001_initial_schema.sql --remote
wrangler d1 execute gametuoitho-d1 --file=./database/seeds/0001_seed_data.sql --remote
```

### 2. Tạo R2 Storage Bucket
```bash
wrangler r2 bucket create gametuoitho-assets
```

### 3. Deploy Backend Worker API
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
