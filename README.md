# Game Tuổi Thơ — Hướng dẫn setup và deploy

Website lưu trữ và chơi game Java ME, gồm Web Astro/React, REST API Hono, Game Catalog và thư viện riêng của người dùng.

Sau khi đăng nhập, mục **Chơi gần đây** trên trang chủ hiển thị 6 game vừa mở chơi, mới nhất trước. Chọn **Xem tất cả** hoặc menu tài khoản → **Chơi gần đây** để xem tối đa 50 game. Lịch sử lưu theo tài khoản, gồm cả game import riêng tư; game chơi lại chỉ xuất hiện một lần và được đưa lên đầu.

**Website đã triển khai:** [gametuoitho.toandn9x.workers.dev](https://gametuoitho.toandn9x.workers.dev).

Đây là hướng dẫn chung cho setup, deploy và vận hành. Với Cloudflare, bạn tạo tài nguyên/token/key trên giao diện web, điền file local rồi [chạy deploy.bat](#manual-deploy). Không cần kết nối GitHub.

- [Chạy local](#local)
- [Deploy Cloudflare bằng token/key](#cloudflare)
- [Tạo admin và nhập game](#admin)
- [Bật đăng nhập Google](#google-login)
- [Cập nhật, sao lưu và khôi phục](#operations)
- [Tự host trên VPS](#vps)
- [Các lệnh phát triển và kiểm tra](#checks)
- [Xử lý lỗi](#troubleshooting)
- [Phạm vi đã kiểm chứng](#verification)

## Môi trường và dữ liệu

| Môi trường | Web/API | Database | File JAR/JAD/ảnh |
| --- | --- | --- | --- |
| Local thông thường | Một tiến trình Node.js, mặc định cổng 4321 | SQLite tại gốc repo | Thư mục `uploads/` tại gốc repo |
| Cloudflare production | Một Worker + Static Assets, cùng domain | D1 | Bucket Tigris PRIVATE |
| Giả lập Workers local | Wrangler, mặc định cổng 8787 | D1 giả lập | R2 giả lập offline |

D1/SQLite chỉ lưu metadata; file game nằm trong storage. Game user import luôn riêng tư và không tự xuất hiện trong Catalog. Deploy cloud không tự chuyển database hoặc file game đang có trên máy.

<a id="local"></a>

## 1. Chạy local

### Chuẩn bị

- Node.js 22 và pnpm 10, cùng phiên bản chính với cấu hình CI của repo.
- Mở terminal tại thư mục gốc có `pnpm-workspace.yaml`.
- Local thông thường không cần tài khoản Cloudflare, Tigris hoặc thẻ thanh toán.

### Cài đặt và khởi động

Trên Windows PowerShell:

```powershell
pnpm install --frozen-lockfile

$jwtBytes = New-Object byte[] 48
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($jwtBytes)
$env:JWT_SECRET = [Convert]::ToBase64String($jwtBytes)
$env:HOST = '127.0.0.1'

pnpm build
pnpm start
```

Trên Linux/macOS:

```bash
pnpm install --frozen-lockfile
export JWT_SECRET="$(openssl rand -hex 48)"
export HOST=127.0.0.1
pnpm build
pnpm start
```

Mở [website local](http://localhost:4321), [trang admin](http://localhost:4321/admin), [health](http://localhost:4321/health) hoặc [API Catalog](http://localhost:4321/api/v1/games).

Server tự chạy các migration còn thiếu và seed 8 thể loại khi database chưa có thể loại. Không có game hay tài khoản/mật khẩu mặc định. Sau khi server tạo database lần đầu, tạo admin theo [mục 3](#admin).

Giữ cùng `JWT_SECRET` giữa các lần chạy nếu muốn duy trì phiên đăng nhập. Các lệnh tạo khóa ở trên sinh khóa mới mỗi lần thực hiện; khi khóa thay đổi, cần đăng nhập lại. `.env.deploy.local` phục vụ helper deploy cloud, không được server Node tự nạp.

### Biến môi trường local

| Biến | Giá trị mặc định / cách dùng |
| --- | --- |
| `JWT_SECRET` | Dùng khóa ngẫu nhiên ít nhất 32 ký tự; bắt buộc khi `NODE_ENV=production` |
| `HOST` | Nên đặt `127.0.0.1` khi chạy trên máy |
| `PORT` | `4321` |
| `DB_PATH` | `gametuoitho.sqlite` tại gốc repo |
| `UPLOADS_DIR` | `uploads/` tại gốc repo |
| `WEB_DIST` | `apps/web/dist` |
| `GOOGLE_CLIENT_ID` | Để trống nếu chưa bật Google login |

Đổi `DB_PATH` hoặc `UPLOADS_DIR` không tự chuyển dữ liệu cũ sang nơi mới.

### Giả lập Cloudflare trên máy

Để thử đúng entrypoint Worker, mở [apps/api/.dev.vars.example](apps/api/.dev.vars.example), lưu bản riêng thành `apps/api/.dev.vars` và đặt `JWT_SECRET` ngẫu nhiên ít nhất 32 ký tự. Sau đó agent hoặc người phát triển chạy:

```powershell
pnpm cf:dev
```

Lệnh này build giao diện, migrate/seed D1 local và chạy Wrangler với `--env local`. Môi trường dùng D1/R2 giả lập, không gọi Tigris thật. `.dev.vars` đã được git-ignore.

<a id="cloudflare"></a>

## 2. Deploy Cloudflare bằng token/key

Mô hình đang dùng là **Workers + D1 + Tigris PRIVATE**. D1 lưu dữ liệu tài khoản/game; Tigris lưu file. Không cần kích hoạt R2 cho phương án này.

### Bước 1 — Tạo Worker bằng web

1. Đăng nhập [Cloudflare Dashboard](https://dash.cloudflare.com/) và chọn account.
2. Mở **Workers & Pages → Create application → Hello World / Create Worker**.
3. Đặt tên `gametuoitho`, bấm **Deploy**. Nếu đã có Worker, dùng lại tên hiện có.
4. Copy **Account ID** của account chứa Worker; đây không phải Zone ID.

Worker Hello World chỉ là chỗ chuẩn bị. Helper sẽ phát hành Web/API của repo lên Worker này.

### Bước 2 — Tạo D1

1. Cloudflare → **Storage & databases → D1 SQL Database → Create database**.
2. Đặt tên `gametuoitho-d1` và tạo.
3. Mở database, copy **Database ID** và tên thực tế.

Nếu đã có database cần dùng, giữ đúng ID đó. Agent sẽ chạy migration; không cần tự tạo bảng hoặc gõ SQL.

### Bước 3 — Tạo Cloudflare API token

1. Cloudflare → **My Profile → API Tokens → Create Token**.
2. Chọn mẫu **Edit Cloudflare Workers**, đặt tên như `gametuoitho-deploy`.
3. Xác nhận đủ các quyền sau:

| Quyền | Mức truy cập | Mục đích |
| --- | --- | --- |
| Account → Workers Scripts | Edit | Phát hành code, static assets và Worker secrets |
| Account → D1 | Edit | Chạy migration và seed |

Nếu UI sử dụng role Workers mới, chọn **Workers → Editor** cho Worker đã tạo. Giữ các quyền cần thiết của mẫu và giới hạn tài nguyên vào đúng account chứa Worker/D1. Quyền Read xem được thông tin nhưng không đủ để deploy.

4. Bấm **Continue / Create Token**, lưu token vào file local ở bước 5. Token thường chỉ hiển thị một lần.

Không cần Cloudflare Global API Key. Có thể sửa quyền token hiện có qua **API Tokens → token đang dùng → Edit**.

Nguồn: [tạo API token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/), [quyền Workers](https://developers.cloudflare.com/workers/authorization/workers/).

### Bước 4 — Tạo Tigris bucket và key

1. Đăng nhập [Tigris Dashboard](https://console.storage.dev/).
2. Tạo bucket, chọn tier **Standard** và giữ **PRIVATE**. Nếu đã có bucket `game`, có thể dùng lại.
3. Vào **Access Keys → Create New Access Key**.
4. Chọn **ReadWrite** và chọn cụ thể bucket cần dùng. Key phải đọc, liệt kê, ghi và xóa được object trong bucket; không cần quyền Admin toàn organization.
5. Lưu cả **Access Key ID** và **Secret Access Key** vào file local ở bước 5.

Một key chưa được gán bucket có thể xem danh sách tên bucket nhưng bị `403 AccessDenied` khi truy cập nội dung. Tạo key mà không chọn bucket chưa đủ. Nếu cả `CreatePolicy` cũng bị 403, cần tài khoản quản lý bucket cấp quyền qua dashboard.

Giữ bucket private khi sửa quyền. API sẽ kiểm tra JWT, chủ sở hữu và trạng thái asset trước khi đọc file từ Tigris.

Nguồn: [quản lý access key](https://www.tigrisdata.com/docs/iam/manage-access-key/), [tạo bucket](https://www.tigrisdata.com/docs/buckets/create-bucket/), [giá và hạn mức](https://www.tigrisdata.com/pricing/).

### Bước 5 — Điền file local

Mở [.env.deploy.local](.env.deploy.local) ở gốc repo bằng VS Code. Nếu chưa có, mở [.env.deploy.local.example](.env.deploy.local.example) rồi **Save As** thành `.env.deploy.local`.

```dotenv
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_API_TOKEN=

WORKER_NAME=gametuoitho
D1_DATABASE_ID=
D1_DATABASE_NAME=gametuoitho-d1

TIGRIS_BUCKET=
TIGRIS_ACCESS_KEY_ID=
TIGRIS_SECRET_ACCESS_KEY=

JWT_SECRET=
GOOGLE_CLIENT_ID=
```

| Trường | Điền gì |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Account ID 32 ký tự hex, đúng account chứa Worker/D1 |
| `CLOUDFLARE_API_TOKEN` | Token có quyền Workers Scripts Edit và D1 Edit |
| `WORKER_NAME` | Tên Worker thực tế |
| `D1_DATABASE_ID` | UUID database |
| `D1_DATABASE_NAME` | Tên database thực tế |
| `TIGRIS_BUCKET` | Tên bucket PRIVATE, ví dụ `game` |
| `TIGRIS_ACCESS_KEY_ID`, `TIGRIS_SECRET_ACCESS_KEY` | Cặp key ReadWrite đã chọn bucket |
| `JWT_SECRET` | Có thể để trống: giữ secret trên Worker, hoặc tạo ngẫu nhiên nếu lần đầu chưa có |
| `GOOGLE_CLIENT_ID` | Để trống nếu chưa dùng đăng nhập Google |

Dán token/key trên một dòng, không thêm `Bearer` hoặc khoảng trắng. Nếu tự đặt `JWT_SECRET`, dùng khóa ngẫu nhiên ít nhất 32 ký tự. Bấm **Ctrl+S**.

File private đã được git-ignore. Không gửi token/key vào chat, ảnh chụp màn hình hoặc `wrangler.toml`.

<a id="manual-deploy"></a>

### Bước 6 — Chạy deploy.bat

Nhấp đúp **[deploy.bat](deploy.bat)** tại gốc dự án. Script tự đọc `.env.deploy.local`, cài dependency, build và deploy.

Chờ thông báo **SUCCESS**, rồi mở [website](https://gametuoitho.toandn9x.workers.dev) và nhấn **Ctrl+F5** để tải bản mới.

Nếu có lỗi, xem trên cửa sổ đang mở hoặc file log mới nhất trong `logs/deploy/`. Log ghi rõ bước lỗi và mã lỗi; token/key được che. Sửa lỗi xong, chạy lại `deploy.bat`.

<a id="admin"></a>

## 3. Tạo admin và nhập game

### Admin local

Chạy server lần đầu để tạo database, rồi mở terminal khác tại gốc repo:

```powershell
pnpm --filter @gametuoitho/api create-admin
```

Nhập username, email và mật khẩu theo câu hỏi tương tác. CLI dùng database local và chỉ bootstrap khi chưa có admin. Nếu dùng `DB_PATH` riêng, đặt cùng đường dẫn cho server và CLI. Không dùng lệnh này để tạo admin trên D1 cloud.

### Admin Cloudflare qua UI

1. Đăng ký tài khoản thật trên website đã deploy.
2. Cloudflare → **D1 → database của website → Studio / Data Studio → users**.
3. Tìm chính xác username/email vừa đăng ký.
4. Sửa ô `role` từ `USER` sang `ADMIN`, bấm **Save / Apply changes**.
5. Đăng xuất, đăng nhập lại rồi mở `/admin`.

D1 Studio hỗ trợ sửa dữ liệu trong bảng; không cần gõ SQL. [Tài liệu Studio](https://developers.cloudflare.com/workers/local-development/local-explorer/#d1-and-durable-objects-sql-studio).

### Các mục quản trị

| Mục | Đường dẫn | Công dụng |
| --- | --- | --- |
| Game Catalog | `/admin/games` | Metadata, phiên bản, xuất bản/ẩn game |
| Nhập game | `/admin/games/create`, `/admin/crawler` | Upload hoặc nhập từ nguồn được phép, tạo DRAFT |
| Quản lý người dùng | `/admin/users` | Tìm kiếm, lọc, phân trang, khóa/mở khóa tài khoản |
| Game người dùng tải lên | `/admin/user-imports` | Theo dõi game riêng tư của user |
| Storage | `/admin/storage` | Kiểm tra tài nguyên và dọn dẹp file |
| Báo cáo lỗi | `/admin/reports` | Xem lỗi client/emulator gửi lên |

Quản lý tài khoản và quản lý game tải lên là hai chức năng riêng. API tài khoản gồm `GET /api/v1/admin/users` và `PUT /api/v1/admin/users/:id/status`, đều yêu cầu ADMIN ở server. Khóa/mở khóa thu hồi phiên cũ; màn hình này không đổi role hoặc khóa tài khoản ADMIN.

Để xuất bản game: nhập JAR/JAD/ảnh → kiểm tra game DRAFT → xuất bản với `status=PUBLISHED`, `visibility=PUBLIC`. Chỉ dùng game có quyền phân phối. Game user import vẫn PRIVATE.

Trong Game Catalog, đánh dấu ☆/★ để chọn game cho mục **Game ưa thích** trên trang chủ, tối đa 8 game công khai. Việc đánh dấu không tự xuất bản game nháp. Danh sách này khác yêu thích cá nhân tại `/me/favorites`.

<a id="google-login"></a>

## 4. Bật đăng nhập Google

1. Mở [Google Cloud Console](https://console.cloud.google.com/), tạo/chọn project.
2. Vào **Google Auth Platform**, cấu hình Branding/Audience/Contact information theo giao diện.
3. Mở **Clients → Create client → Web application**.
4. Thêm **Authorized JavaScript origins** đúng địa chỉ sử dụng, ví dụ:
   - `http://localhost:4321`
   - `http://localhost:8787` nếu thử Wrangler local
   - `https://gametuoitho.toandn9x.workers.dev`
   - Domain riêng nếu đã cấu hình.
5. Tích hợp hiện tại dùng credential callback, không cần Authorized redirect URI. Copy **Client ID** dạng `....apps.googleusercontent.com`; không dùng Client secret.
6. Kiểm tra Audience/Testing/Production và danh sách tài khoản được phép thử trong Google Console.

Nguồn: [thiết lập Google Identity Services](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid).

**Trên local**, đặt Client ID trong môi trường của server rồi khởi động lại:

```powershell
$env:GOOGLE_CLIENT_ID = 'your-client-id.apps.googleusercontent.com'
pnpm start
```

**Trên Cloudflare**, điền `GOOGLE_CLIENT_ID` trong `.env.deploy.local`, lưu và nhờ agent deploy lại. Với `pnpm cf:dev`, đặt trong `[env.local.vars]` của `apps/api/wrangler.toml`.

Để trống Client ID thì nút Google bị ẩn. Lần đăng nhập Google đầu tạo USER; muốn làm admin thì cấp role như mục 3. Email trùng tài khoản mật khẩu không tự gộp: dùng phương thức đăng nhập cũ. Lỗi `origin_mismatch` cần đối chiếu chính xác scheme/domain/port, kể cả `localhost` và `127.0.0.1`.

<a id="operations"></a>

## 5. Cập nhật, sao lưu và khôi phục

- **Local:** sau khi sửa code, build lại rồi khởi động lại server. Migration mới được áp dụng khi server chạy.
- **Cloudflare:** giữ file private, nhờ agent deploy lại; helper chỉ áp dụng migration chưa chạy.
- **Đổi token/key:** cập nhật cặp giá trị tương ứng trong file private. Đổi JWT sẽ buộc phiên cũ đăng nhập lại.
- **Domain riêng:** Worker → Settings → Domains & Routes → Add → Custom domain, chọn domain đã quản lý trên Cloudflare.
- **Log:** Worker → Observability / Logs → Live logs, rồi tái hiện thao tác bị lỗi.
- **Sao lưu local:** dừng server để copy database SQLite và toàn bộ `uploads/` nhất quán, hoặc dùng công cụ SQLite backup khi đang chạy. Giữ bản sao trước khi chuyển dữ liệu.
- **Sao lưu cloud:** lưu bản export/backup D1 và các object Tigris với nguyên storage key. Database và object phải tương ứng; không đổi bucket/ID để thay cho bước chuyển dữ liệu.
- **Khôi phục code cloud:** Worker → Deployments → chọn version cũ → Rollback / Promote. Rollback code không hoàn tác migration hoặc khôi phục file đã xóa.

Helper deploy không copy dữ liệu local lên cloud. Muốn chuyển game/tài khoản cần quy trình chuyển database và file riêng, sau khi sao lưu.

<a id="vps"></a>

## 6. Tự host trên VPS

Dùng cùng server Node như local: cài dependency, build, đặt `NODE_ENV=production`, `JWT_SECRET` ổn định ít nhất 32 ký tự, `HOST=127.0.0.1` và `PORT` mong muốn rồi chạy `pnpm start`.

Dùng process manager như systemd/PM2 để tự khởi động, reverse proxy để cấp HTTPS và giữ database/uploads ở nơi bền vững. Proxy cần cho phép payload 50 MB, chuyển tiếp `Host`/`X-Forwarded-For` và giữ header `Range` để tải game. Không thay SQLite bằng D1 chỉ bằng cách đổi biến môi trường của server Node.

<a id="checks"></a>

## 7. Các lệnh phát triển và kiểm tra

Chạy tại gốc repo:

| Lệnh | Mục đích |
| --- | --- |
| `pnpm dev` | Server hợp nhất có watch; sửa giao diện cần build lại Web |
| `pnpm dev:api` | Alias chạy cùng API dev script/server hợp nhất |
| `pnpm dev:web` | Astro dev riêng; cần cấu hình API phù hợp nếu chạy hai tiến trình |
| `pnpm build` | Kiểm tra package và build Web |
| `pnpm lint` | TypeScript monorepo |
| `pnpm test` | API, Google auth, Tigris HTTP fixture và helper deploy |
| `pnpm test:deploy` | Kiểm thử helper và launcher BAT bằng fixture; BAT chạy trên Windows |
| `pnpm cf:build` | Build cloud với các page shell, không lấy dữ liệu game local |
| `pnpm cf:dev` | Chạy Worker với D1/R2 local |

Các kiểm tra chuyên biệt:

```powershell
pnpm --filter @gametuoitho/api exec tsx ../../tests/pm/asset-review.ts
node tests/pm/admin-render-review.cjs
node tests/pm/admin-users-render-review.cjs
node tests/pm/emulator-crash-review.cjs
node tests/pm/emulator-cache-review.cjs
node tests/pm/emulator-input-review.cjs
node tests/pm/mobile-input-browser-review.cjs --url https://gametuoitho.toandn9x.workers.dev/play/ninja-school-2
```

Các kiểm tra DOM dùng Chrome/Edge headless và fixture riêng; build Web trước khi chạy kiểm tra trang admin. Fixture không chứng minh dịch vụ cloud hoặc mọi game hoạt động. JAR fixture chỉ là dữ liệu, không được chạy trên server.

Nếu cần chẩn đoán player, dùng `node scripts/diagnose-player.cjs --url <URL-trang-play> --wait-ms 30000`. Bản vá menu icon null của emulator có source, provenance và cách tái build tại [apps/emulator-web/patches/README.md](apps/emulator-web/patches/README.md).

Để kiểm tra chạm trên mobile giả lập: thêm `--viewport 390x844 --input-mode touch --tap-key F1,F1` (hai lần chạm phím mềm trái), hoặc `--tap-screen 120,160` để chạm vào tọa độ gốc của canvas. Script lưu ảnh trước/sau và log input trong thư mục tạm. Chữ trong màn hình game do JAR vẽ; chỉ các vùng game có xử lý pointer mới phản hồi chạm. Một số màn hình cần phím mềm trái/phải, không dùng nút OK.

<a id="troubleshooting"></a>

## 8. Xử lý lỗi

| Hiện tượng | Cách xử lý |
| --- | --- |
| Local không có giao diện | Chạy `pnpm build`, rồi khởi động server hợp nhất |
| Database khác sau đổi lệnh/môi trường | Kiểm tra `DB_PATH`, thư mục làm việc và server đang chạy; sao lưu trước khi đổi |
| `create-admin` chưa thấy database | Chạy server lần đầu để tạo schema, dùng cùng `DB_PATH` |
| Local đăng nhập mất sau restart | Giữ `JWT_SECRET` ổn định thay vì sinh lại mỗi lần |
| Cloud vẫn là Hello World | Lần deploy chưa hoàn tất; xem bước lỗi của helper |
| D1 báo 7500, đọc được nhưng không migrate | Token cần Account → D1 → Edit cho đúng account |
| Worker secrets báo No access to the specified resource | Token cần Workers Scripts → Edit hoặc Workers → Editor cho đúng Worker |
| Tigris LIST/PUT trả 403 | Key ReadWrite phải chọn đúng bucket/organization; thay cả cặp key trong file local |
| Upload được nhưng xóa lỗi | Kiểm tra thêm quyền DeleteObject, log Tigris và kết quả API |
| `/admin` trả 403 | Tài khoản cần role ADMIN; đăng xuất/đăng nhập lại sau khi cấp quyền |
| Google không hiện nút | Kiểm tra `GOOGLE_CLIENT_ID` ở môi trường đang chạy |
| Google `origin_mismatch` | Khớp chính xác origin đã khai báo trong Google Console |
| Worker lỗi 1102 | Kiểm tra CPU/log và tối ưu tác vụ; không bỏ validation JAR để né giới hạn |
| Mất game sau đổi bucket/D1 | Kiểm tra kho cũ và bản sao lưu; đổi cấu hình không chuyển file/DB |
| Player trắng hoặc báo crash | Xem `/admin/reports`, log browser và script chẩn đoán; không tự tạo JAR thay file bị thiếu |

Adapter Tigris dùng endpoint `https://t3.storage.dev`, region `auto`, SigV4, timeout 15 giây, `redirect: manual` và từ chối 3xx. Không dùng `redirect: error` trên Workers. URL file luôn qua `/api/v1/assets/raw/...`, không đưa key Tigris về trình duyệt.

Theo dõi [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) và [Tigris pricing](https://www.tigrisdata.com/pricing/) trước khi tăng dữ liệu hoặc lưu lượng.

<a id="verification"></a>

## 9. Phạm vi đã kiểm chứng

Lần triển khai **10/11/2026** đã xác minh Web/API/D1/Tigris thật: 13 kiểm tra HTTP/route, 22 kiểm tra auth/upload JAR nén/riêng tư/Range/admin/logout và 2 kiểm tra dashboard/storage analysis đều đạt. Chrome desktop 1280px và mobile emulation 390px tải được 8 thể loại qua API, không tràn ngang. Tài khoản và object thử đã được dọn.

Version tại lần kiểm tra: `5cc30da2-f15c-4834-95c4-b0f04edcc328`. Ảnh: [desktop](docs/evidence/cloudflare/live-home-desktop.png), [mobile](docs/evidence/cloudflare/live-home-mobile.png).

Input local ngày 10/11/2026: 7 kiểm tra bridge/phím/tọa độ, 10 kiểm tra crash và 120 kiểm tra cache đạt. Chrome giả lập touch 390×844 chạy Ninja School 2 (JAR `5ac8d83a…`) nhận hai lần chạm F1 và chuyển đến menu “Chơi mới”: [ảnh](docs/evidence/emulator-input/ninja-school-2-keypad-touch.png), [log input](docs/evidence/emulator-input/ninja-school-2-input.json). Chạm trực tiếp menu ở bản JAR này chưa kích hoạt “Chơi mới” dù bridge nhận đúng tọa độ; file khác bản Ninja School 2 mà gametuoitho.cc phục vụ. Chưa kiểm tra trên điện thoại thật.

Kiểm tra bổ sung ngày 10/11/2026: Ninja School 2 đạt **42/42 trên bản online** và **42/42 trên bản local** bằng Chrome giả lập Android 390×844, gửi sự kiện touch thật qua DevTools. Các cặp nhấn/nhả của OK, D-pad, số, `*`, `#`, phím mềm, giữ phím và hủy chạm đều tới iframe và được vòng xử lý Java lấy ra; phím mềm trái làm game chuyển màn. [Kết quả online](docs/evidence/emulator-input/mobile-browser/online-results.json), [kết quả local](docs/evidence/emulator-input/mobile-browser/local-results.json). Script chặn API ghi dữ liệu. Tại lần kiểm tra này bản online vẫn dùng mã input cũ; cần deploy để đưa bản sửa local lên. Kết quả chưa xác nhận cho điện thoại thật hoặc Safari.

Sau phản hồi Chrome trên iPhone iOS 27 không nhận phím, bàn phím Nokia có nhánh Touch Events native với `passive: false`, theo dõi từng ngón tay và không nhả phím vì iframe đổi focus. Chuột/bút vẫn dùng Pointer Events. Emulator nhúng không tự giành lại focus khi đang chạm bàn phím ngoài iframe. Bản sửa đạt 8/8 kiểm tra input, [29/29 kiểm tra WebKit](docs/evidence/emulator-input/ios-touch/webkit-results.json) và [42/42 hồi quy Chrome](docs/evidence/emulator-input/ios-touch/chromium-results.json). WebKit 26.6 chạy player và handler input thật nhưng dùng fixture thay Java/game vì WebKit Windows thiếu WebAudio, còn thử nghiệm JAR đầy đủ tại đây chưa đạt; kết quả không xác nhận Ninja School 2 chạy hoàn chỉnh trên iPhone iOS 27. Ca Chrome chạy game thật.

Kiểm tra WebKit bổ sung cần Playwright và browser WebKit đã cài; có thể đặt `PLAYWRIGHT_MODULE_PATH` và `WEBKIT_EXECUTABLE_PATH` nếu dùng bản cài sẵn. Chạy `node tests/pm/ios-webkit-input-review.cjs --url http://127.0.0.1:4321/play/ninja-school-2 --fixture` sau khi build và khởi động server. Script chặn API ghi dữ liệu và ghi rõ phạm vi fixture trong kết quả.

Với URL người dùng xác nhận `/play/ninja-school-1` (HTTPS), nhánh Touch Events đã có trên website nhưng chưa chuyển thao tác ở phím Nokia sang hàm mở khóa âm thanh trong iframe. Bản sửa bổ sung gọi `unlockGameAudio()` đồng bộ trong thao tác nhấn/nhả, cho phép `autoplay` ở iframe, giữ khả năng thử lại khi `AudioContext.resume()` bị từ chối và xử lý trạng thái `interrupted`. Ca WebKit mô phỏng AudioContext bị khóa đạt [30/31 với player online trước sửa](docs/evidence/emulator-input/ninja-school-1/online-webkit-audio-gate-results.json), [31/31 với bản local sau sửa](docs/evidence/emulator-input/ninja-school-1/local-webkit-audio-gate-results.json). Đây là fixture kiểm tra điều kiện user gesture, không phải phát âm thanh thật trên iPhone. Ninja School 1 thật trên Chrome đạt [42/42 online](docs/evidence/emulator-input/ninja-school-1/online-chromium-results.json), [42/42 local](docs/evidence/emulator-input/ninja-school-1/local-chromium-results.json); kiểm tra input đạt 9/9. Cần deploy bản bổ sung và xác nhận lại trên iPhone iOS 27.

Đây là kết quả tại thời điểm triển khai, không phải giám sát liên tục. Chơi game thật trên cloud, Google login thật, crawler nguồn thật, tải lớn và tải đồng thời chưa được xác minh đầy đủ. Emulator vẫn chưa nghiệm thu rộng; giới hạn iframe cùng origin được mô tả trong tài liệu bảo mật.

## Cấu trúc và tài liệu kỹ thuật

| Đường dẫn | Nội dung |
| --- | --- |
| `apps/web/` | Giao diện người dùng, admin và player |
| `apps/api/` | API, server Node, entrypoint Worker và storage driver |
| `apps/emulator-web/` | Emulator và bản vá upstream |
| `packages/` | Types, API contracts và tiện ích dùng chung |
| `database/` | Migration và seed thể loại |
| `tests/` | Mã kiểm thử tự động |
| `docs/` | Tài liệu kỹ thuật và hình ảnh |

Tham chiếu: [kiến trúc](docs/architecture.md), [database](docs/database.md), [bảo mật](docs/security.md), [tích hợp emulator](docs/emulator-integration.md), [kế hoạch](plan.md), [quy tắc agent](AGENTS.md), [kết nối Antigravity](docs/antigravity-agent-access.md).
