# Game Tuổi Thơ

Website chơi lại game điện thoại Java (J2ME) ngay trên trình duyệt, máy tính lẫn điện thoại, không cần cài đặt.

**Bản đang chạy:** [gametuoitho.toandn9x.workers.dev](https://gametuoitho.toandn9x.workers.dev)

- [Mục đích và chức năng](#muc-dich)
- [Các nền tảng sử dụng](#nen-tang)
- [Chạy trên máy (local)](#local)
- [Deploy lên Cloudflare (Workers + D1 + Tigris)](#cloudflare)
- [Lệnh hay dùng](#lenh)
- [Xử lý lỗi thường gặp](#loi)
- [Kế hoạch Android APK](plan.md)

<a id="muc-dich"></a>

## Mục đích và chức năng

Dự án lưu giữ và cho chơi lại các game Java trên điện thoại đời cũ (Nokia, Sony Ericsson…). Game chạy bằng trình giả lập J2ME trong trình duyệt, có bàn phím Nokia ảo cho màn hình cảm ứng.

| Đối tượng | Chức năng |
| --- | --- |
| Khách | Xem kho game theo thể loại, tìm kiếm, chơi ngay |
| Thành viên | Đăng ký bằng tài khoản hoặc Google; lưu game vào thư viện; xem lại game **Chơi gần đây**; tải game JAR riêng để chơi (chỉ mình mình thấy); báo lỗi game |
| Admin (`/admin`) | Thống kê hoạt động; upload game hoặc nhập từ nguồn ngoài (vào dạng nháp rồi duyệt, xuất bản); chọn game nổi bật; quản lý người dùng; quản lý storage; xem log lỗi trình giả lập |

Mã nguồn là monorepo pnpm:

| Thư mục | Nội dung |
| --- | --- |
| `apps/web` | Giao diện Astro + React + Tailwind (trang người chơi, trang admin, player) |
| `apps/api` | API Hono: server Node cho local và Worker cho Cloudflare |
| `apps/web/public/emulator` | Trình giả lập J2ME (freej2me-web chạy trên CheerpJ). Bản gốc và các bản vá nằm ở `apps/emulator-web` |
| `packages/` | Kiểu dữ liệu, hợp đồng API và tiện ích dùng chung |
| `database/` | Migration SQL và dữ liệu thể loại mẫu |
| `tests/` | Kiểm thử tự động |

<a id="nen-tang"></a>

## Các nền tảng sử dụng

Khi chạy trên cloud, toàn bộ website nằm trên **một domain**:

```text
Trình duyệt ──► Cloudflare Worker "gametuoitho"
                 ├─ HTML/JS/CSS, trình giả lập ──► Workers Static Assets
                 ├─ /api/v1/*                   ──► D1 (dữ liệu)
                 └─ /api/v1/assets/raw/*        ──► Tigris (file game, ảnh)
```

Dùng Tigris thay cho Cloudflare R2 vì R2 bắt buộc khai báo thẻ thanh toán. Cả ba dịch vụ đều có hạn mức miễn phí; xem bảng giá [Workers](https://developers.cloudflare.com/workers/platform/pricing/), [D1](https://developers.cloudflare.com/d1/platform/pricing/), [Tigris](https://www.tigrisdata.com/pricing/) trước khi tăng dữ liệu hoặc lưu lượng.

Khi chạy local, một tiến trình Node.js thay cho cả ba: SQLite thay D1, thư mục `uploads/` thay Tigris.

<a id="local"></a>

## Chạy trên máy (local)

Cần **Node.js 22+** và **pnpm 10+**. Không cần tài khoản cloud.

**1. Cài đặt và chạy** (PowerShell, tại thư mục gốc repo):

```powershell
pnpm install --frozen-lockfile
$env:JWT_SECRET = "<chuỗi ngẫu nhiên, ít nhất 32 ký tự>"
$env:HOST = "127.0.0.1"
pnpm build
pnpm start
```

Trên Linux/macOS dùng `export JWT_SECRET="$(openssl rand -hex 48)"`.

Mở <http://localhost:4321>. Lần chạy đầu, server tự tạo database `gametuoitho.sqlite` và 8 thể loại. Server không tạo sẵn game hay tài khoản nào.

**2. Tạo admin** (mở terminal khác, giữ server đang chạy):

```powershell
pnpm --filter @gametuoitho/api create-admin
```

Nhập username, email và mật khẩu, rồi đăng nhập và vào <http://localhost:4321/admin> để thêm game.

**3. Sau khi sửa code:** chạy `pnpm restart` (tức build lại rồi start). Migration mới được áp dụng tự động.

| Biến môi trường | Mặc định / ghi chú |
| --- | --- |
| `JWT_SECRET` | Bắt buộc. Giữ cố định giữa các lần chạy, nếu đổi thì mọi người phải đăng nhập lại |
| `PORT`, `HOST` | `4321`; nên đặt `HOST=127.0.0.1` |
| `DB_PATH` | `gametuoitho.sqlite` ở gốc repo |
| `UPLOADS_DIR` | `uploads/` ở gốc repo |
| `GOOGLE_CLIENT_ID` | Để trống nếu không dùng Google login |

Database và `uploads/` là dữ liệu thật của bạn: build lại không xóa chúng. Sao lưu cả hai trước khi đổi `DB_PATH`/`UPLOADS_DIR`.

**Tự host trên VPS:** làm như trên, thêm `NODE_ENV=production`, chạy bằng systemd/PM2 sau một reverse proxy HTTPS. Proxy phải cho phép upload 50 MB và giữ nguyên header `Range`.

<a id="cloudflare"></a>

## Deploy lên Cloudflare (Workers + D1 + Tigris)

Bạn tạo tài nguyên trên giao diện web, điền một file cấu hình, rồi chạy `deploy.bat`. Không cần kết nối GitHub.

### Bước 1: Tạo Worker

[Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages → Create → Hello World** → đặt tên `gametuoitho` → **Deploy**. Ghi lại **Account ID** (32 ký tự hex, không phải Zone ID).

### Bước 2: Tạo D1

**Storage & databases → D1 SQL Database → Create** → đặt tên `gametuoitho-d1`. Ghi lại **Database ID**. Bạn không cần tự tạo bảng, vì lệnh deploy sẽ chạy migration.

### Bước 3: Tạo API token Cloudflare

**My Profile → API Tokens → Create Token** → mẫu **Edit Cloudflare Workers**. Token cần quyền:

| Quyền | Mức | Để làm gì |
| --- | --- | --- |
| Account → Workers Scripts | Edit | Phát hành code, file tĩnh, secrets |
| Account → D1 | Edit | Chạy migration và seed |

Giới hạn token vào đúng account. Token chỉ hiện một lần, nên copy ngay.

### Bước 4: Tạo bucket và key Tigris

1. [Tigris Dashboard](https://console.storage.dev/) → tạo bucket (tier **Standard**, để **Private**), ví dụ `game`.
2. **Access Keys → Create New Access Key** → quyền **ReadWrite**, **chọn đúng bucket** vừa tạo. Nếu key không được gán bucket, mọi thao tác với file trong bucket sẽ bị `403`.
3. Ghi lại **Access Key ID** và **Secret Access Key**.

### Bước 5: Điền `.env.deploy.local`

Copy [.env.deploy.local.example](.env.deploy.local.example) thành `.env.deploy.local` ở gốc repo rồi điền:

| Trường | Giá trị |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` | Từ bước 1 và 3 |
| `WORKER_NAME` | `gametuoitho` (tên Worker ở bước 1) |
| `D1_DATABASE_ID`, `D1_DATABASE_NAME` | Từ bước 2 |
| `TIGRIS_BUCKET`, `TIGRIS_ACCESS_KEY_ID`, `TIGRIS_SECRET_ACCESS_KEY` | Từ bước 4 |
| `JWT_SECRET` | Để trống: lần đầu tự tạo, các lần sau giữ nguyên secret trên Worker |
| `GOOGLE_CLIENT_ID` | Để trống nếu không dùng Google login |

File này đã được git-ignore. Không dán token/key vào chat, ảnh chụp hay `wrangler.toml`.

### Bước 6: Chạy `deploy.bat`

Nhấp đúp [deploy.bat](deploy.bat). Script tự làm các bước sau:

1. Cài dependency.
2. Kiểm tra token, D1 và Tigris có truy cập được không.
3. Build giao diện và thử đóng gói Worker.
4. Áp dụng migration D1 và tạo thể loại.
5. Đặt secrets (`JWT_SECRET`, key Tigris).
6. Phát hành Worker cùng file tĩnh.

Khi thấy **SUCCESS**, mở website và nhấn **Ctrl+F5**. Nếu lỗi, cửa sổ sẽ ghi bước bị lỗi; log đầy đủ (đã che token/key) nằm trong `logs/deploy/`.

Có thể chạy thử trước mà không thay đổi gì trên cloud: `deploy.bat --check` chỉ kiểm tra token/D1/Tigris, `deploy.bat --dry-run` chỉ build và đóng gói, không gọi cloud.

### Bước 7: Cấp quyền admin

1. Đăng ký tài khoản trên website vừa deploy.
2. Cloudflare → **D1 → `gametuoitho-d1` → Studio → bảng `users`** → sửa `role` của tài khoản đó từ `USER` thành `ADMIN` → **Save**.
3. Đăng xuất, đăng nhập lại, rồi mở `/admin`.

### Cập nhật và vận hành

- **Cập nhật code:** sửa xong chạy lại `deploy.bat`. Chỉ các migration mới được áp dụng; dữ liệu D1 và Tigris giữ nguyên.
- **Domain riêng:** Worker → **Settings → Domains & Routes → Add → Custom domain**.
- **Xem log:** Worker → **Observability → Logs**. Lỗi trình giả lập của người chơi được gửi về `/admin/reports`.
- **Quay lại bản cũ:** Worker → **Deployments → Rollback**. Rollback chỉ đổi code, không hoàn tác migration hay file đã xóa.
- **Sao lưu:** export D1 và giữ các object Tigris với nguyên tên (key); hai phần này phải đi cùng nhau. Deploy không copy dữ liệu local lên cloud.

<a id="google-login"></a>

### Đăng nhập Google (tùy chọn)

1. [Google Cloud Console](https://console.cloud.google.com/) → **Google Auth Platform → Clients → Create client → Web application**.
2. Ở **Authorized JavaScript origins**, thêm đúng địa chỉ website, ví dụ `https://gametuoitho.toandn9x.workers.dev` và `http://localhost:4321`. Không cần redirect URI hay client secret.
3. Copy **Client ID** (`….apps.googleusercontent.com`):
   - Cloud: điền vào `GOOGLE_CLIENT_ID` trong `.env.deploy.local` rồi deploy lại.
   - Local: đặt biến môi trường cùng tên rồi khởi động lại server.

Tài khoản Google mới đăng nhập lần đầu sẽ có role USER. Email trùng với tài khoản mật khẩu có sẵn sẽ không được tự gộp.

<a id="lenh"></a>

## Lệnh hay dùng

| Lệnh | Tác dụng |
| --- | --- |
| `pnpm build` / `pnpm start` | Build rồi chạy server local |
| `pnpm restart` | Build lại rồi chạy |
| `pnpm dev` | Server API tự reload khi sửa code (giao diện vẫn cần build lại) |
| `pnpm lint` | Kiểm tra TypeScript |
| `pnpm test` | Kiểm thử API, Google auth, Tigris, crawler, Range, helper deploy |
| `pnpm cf:dev` | Chạy thử bản Cloudflare trên máy (D1/R2 giả lập). Cần tạo `apps/api/.dev.vars` từ `.dev.vars.example` |

`pnpm catalog:update`            # chỉ xem trước: game mới, game bị bỏ qua, game nguồn đã gỡ
`pnpm catalog:update --write`    # ghi vào database/


Tài liệu kỹ thuật thêm: [kiến trúc](docs/architecture.md), [database](docs/database.md), [bảo mật](docs/security.md), [tích hợp emulator](docs/emulator-integration.md).
