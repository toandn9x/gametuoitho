# Hướng Dẫn Triển Khai Production (Deployment Guide)

Nền tảng được thiết kế tối ưu hóa cho hệ sinh thái **Cloudflare (Workers + D1 + R2 + Pages)** với chi phí tối thiểu, hiệu năng toàn cầu và độ ổn định cao.

## 1. Yêu Cầu Trước Khi Triển Khai
- Tài khoản Cloudflare (Free Tier hoặc Pro Tier).
- Node.js >= 20.x và pnpm >= 9.x.
- Cloudflare Wrangler CLI (`pnpm add -g wrangler` hoặc `npx wrangler`).

---

## 2. Triển Khai Backend API (Cloudflare Workers)

### Bước 1: Tạo D1 Database
```bash
# Tạo cơ sở dữ liệu D1
wrangler d1 create gametuoitho-d1

# Cập nhật database_id vừa tạo vào apps/api/wrangler.toml:
# [[d1_databases]]
# binding = "DB"
# database_name = "gametuoitho-d1"
# database_id = "<YOUR_DATABASE_ID>"
```

### Bước 2: Tạo R2 Storage Bucket
```bash
# Tạo R2 bucket lưu trữ file JAR và ảnh
wrangler r2 bucket create gametuoitho-assets
```

### Bước 3: Chạy Database Migration trên Production
```bash
# Áp dụng schema
wrangler d1 execute gametuoitho-d1 --file=./database/migrations/0001_initial_schema.sql --remote

# Nạp dữ liệu ban đầu (Tài khoản admin và danh mục, game mẫu)
wrangler d1 execute gametuoitho-d1 --file=./database/seeds/0001_seed_data.sql --remote
```

### Bước 4: Thiết Lập Secret Keys
```bash
# Đặt mã bí mật JWT
wrangler secret put JWT_SECRET
```

### Bước 5: Deploy Worker API
```bash
cd apps/api
wrangler deploy
# API sẽ được phát hành tại: https://gametuoitho-api.<subdomain>.workers.dev
```

---

## 3. Triển Khai Frontend Web (Cloudflare Pages)

### Bước 1: Build Frontend
```bash
# Build mã nguồn Astro + React
pnpm --filter @gametuoitho/web build
```

Thư mục build output nằm tại: `apps/web/dist/`.

### Bước 2: Deploy lên Cloudflare Pages
```bash
# Triển khai trực tiếp qua Wrangler
wrangler pages deploy apps/web/dist --project-name gametuoitho
```

Hoặc kết nối repository Git với Cloudflare Dashboard:
- **Build command**: `pnpm --filter @gametuoitho/web build`
- **Build output directory**: `apps/web/dist`
- **Environment variables**:
  `PUBLIC_API_URL` = `https://api.yourdomain.com/api/v1` (hoặc URL worker đã deploy)

---

## 4. Chạy Môi Trường Phát Triển Cục Bộ (Local Development)

```bash
# 1. Cài đặt toàn bộ dependencies
pnpm install

# 2. Chạy Backend API (sử dụng SQLite cục bộ tự tạo và uploads/ directory)
pnpm dev:api
# API chạy tại: http://localhost:8787

# 3. Chạy Web Frontend (Astro dev server)
pnpm dev:web
# Website chạy tại: http://localhost:3000
```
