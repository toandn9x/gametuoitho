# Antigravity Status & Verification Report

**Thời gian:** 09/11/2026 (Asia/Saigon)
**Phạm vi phụ trách:** Source code, backend services/routes/repositories/storage, admin XSS remediation, test suite, `docs/anty-status.md`.
*(Điều phối, delivery board và review độc lập do Codex/PM phụ trách)*

---

## 1. Nội dung đã triển khai trong PM Review Round 01

### R01-A — Đóng lỗ hổng phát asset (S1)
- **Kiểm tra Metadata & Phân quyền trước khi đọc Storage:**
  - Route `/api/v1/assets/raw/:key{.*}` tra cứu `assetRepo.findByStorageKey(key)` trước khi thực hiện bất kỳ thao tác đọc file nào.
  - Từ chối ngay lập tức (404/403) nếu asset không tồn tại hoặc `status !== 'ACTIVE'`.
  - Phân định rõ tài sản Catalog công khai và User Import riêng tư:
    - Asset Catalog hợp lệ: yêu cầu game cha `PUBLISHED + PUBLIC`, phiên bản `ACTIVE`, asset `ACTIVE`, và không phải là user import trong `user_library`.
    - User Import: mặc định riêng tư, chỉ cho phép chính chủ (`owner_user_id`) hoặc Quản trị viên (`ADMIN`).
    - Kiểm tra user/role/status trực tiếp từ database thông qua `userRepo.findById()` để ngăn chặn việc tin tưởng vào JWT payload đã hết hiệu lực hoặc bị hạ quyền/block.
- **Bảo mật Denial & Header:**
  - Khi bị từ chối (401, 403, 404), server trả về `Cache-Control: private, no-store` và không bao giờ gọi `storage.get(key)`. Không làm lộ kích thước file, storage key hay Content-Range.
  - Toàn bộ response đều có `Cache-Control: no-store` và `X-Content-Type-Options: nosniff`.
  - Asset dạng JAR/JAD được gán `Content-Disposition: attachment; filename="..."` để tránh trình duyệt thực thi nhầm như mã cùng nguồn.
- **HTTP Range Contract & HEAD:**
  - Hỗ trợ đầy đủ các kiểu Range: Closed (`bytes=0-9`), Open-ended (`bytes=90-`), Suffix (`bytes=-15`), và Clamp vượt EOF (`bytes=95-999` tự động kẹp về cuối file).
  - Range không thỏa mãn, malformed syntax hoặc multiple ranges (`bytes=0-5,10-15`) được xử lý nhất quán trả mã `416 Range Not Satisfiable` kèm `Content-Range: bytes */<totalSize>`.
  - Hỗ trợ method `HEAD` với đầy đủ headers chuẩn xác mà không trả kèm body.
- **Chống Path Traversal & Alias trong Storage Driver:**
  - `LocalStorageDriver` loại bỏ hàm thay thế chuỗi nguy hiểm `replace(/\.\./g, '')`.
  - Bổ sung `getSafeFilePath()`: từ chối tuyệt đối các key chứa `..`, dấu gạch chéo ngược `\`, ký tự null byte `\0`, đường dẫn tuyệt đối, ổ đĩa (`C:`), hoặc các key double-encoded (`%25`). Xác minh đường dẫn phân giải luôn nằm trọn vẹn trong `baseDir`.

### R01-B — Public Versions và Game Detail chỉ trả asset được xuất bản (S2)
- Endpoint `GET /api/v1/games/:id/versions` kiểm tra game cha trước khi truy vấn: nếu game không tồn tại hoặc có trạng thái `DRAFT`, `HIDDEN`, `ARCHIVED` hoặc `PRIVATE`, trả về mã `404 Not Found`.
- Truy vấn `findVersionsByGameId` với `activeOnly = true` lọc nghiêm ngặt: version `ACTIVE`, file JAR `ACTIVE`, và file JAD `ACTIVE` (nếu có). Các phiên bản có JAR bị `QUARANTINED` hoặc `DELETED` không bao giờ xuất hiện trong public versions API hay public game detail.
- Game detail và list loại bỏ ảnh bìa nếu asset bìa không ở trạng thái `ACTIVE`.
- Chuyển trạng thái động: khi game chuyển sang `HIDDEN` hoặc asset chuyển sang `QUARANTINED`, các lượt gọi tải asset qua URL cũ bị chặn tức thì.

### R01-C — Khắc phục Stored XSS trong Admin
- **`apps/web/src/pages/admin/user-imports.astro`:**
  - Loại bỏ hoàn toàn việc ghép chuỗi `innerHTML` với dữ liệu API không tin cậy.
  - Sử dụng DOM API an toàn: `document.createElement`, gán text qua `.textContent`, lưu trữ ID/Name qua `dataset`.
  - Xử lý lỗi API hiển thị thông báo lỗi rõ ràng thay vì hiển thị danh sách rỗng thành công; thao tác xóa thất bại hiển thị alert lỗi chính xác.
- **`apps/web/src/pages/admin/storage.astro`:**
  - Dựng bảng bằng DOM API và `.textContent`.
  - Xác thực URL thông qua hàm `isSafeUrl()` (chỉ chấp nhận `/api/v1/assets/raw/` hoặc http/https hợp lệ), thêm thuộc tính `rel="noopener noreferrer"` cho liên kết mở tab mới.

### R01-D — Không tái tạo game đã mất bằng JAR giả
- Cập nhật [`apps/api/src/server.ts`](file:///D:/Link%20tink/gametuoitho/apps/api/src/server.ts):
  - Xóa bỏ hoàn toàn hàm `createMinimalJarBuffer` và vòng lặp `seedAssets` tự động tạo file JAR giả khi thiếu file trên đĩa.
  - Nếu thiếu asset trên storage, hệ thống trả về 404 trung thực.
  - Xóa bỏ việc in tài khoản/mật khẩu mặc định trong console log khi khởi động server.

---

## 2. Bảng đối chiếu Hành vi Trước / Sau (Before vs After)

| Thành phần | Trước khi sửa (Before) | Sau khi sửa (After) |
| --- | --- | --- |
| **Phát asset trực tiếp** | `routes/upload.ts` gọi `storage.getFile(key)` trực tiếp không qua DB, cache public 24h, ai có link cũng tải được private import. | Kiểm tra metadata DB trước; chỉ phát asset `ACTIVE`. Khách chỉ xem Catalog `PUBLISHED+PUBLIC`. Private import chỉ chủ sở hữu hoặc Admin active xem được. Cache `no-store`. |
| **Đọc storage khi bị từ chối** | Đọc file rồi mới kiểm tra hoặc không kiểm tra; lộ Content-Range. | Denial diễn ra trước khi gọi storage (Spy xác nhận 0 lần đọc storage). Trả `Cache-Control: private, no-store`. |
| **Path Traversal / Encoding** | `LocalStorageDriver` dùng `key.replace(/\.\./g, '')`, dễ bị bypass bằng `....//` hoặc backslash. | Kiểm tra nghiêm ngặt `..`, `\`, `\0`, đường dẫn tuyệt đối, double encoding `%25`; chặn đứng mọi nguy cơ traversal. |
| **HTTP Range** | Chỉ hỗ trợ dạng cơ bản `start-end`, dễ lỗi NaN khi malformed, không hỗ trợ suffix hay clamp. | Hỗ trợ chuẩn closed, open-ended, suffix, clamp over-EOF. Malformed/multiple ranges trả 416 kèm Content-Range chuẩn. HEAD không trả body. |
| **Public Versions (S2)** | `GET /api/v1/games/:id/versions` trả version của cả game draft/hidden/private; version có JAR quarantined vẫn hiển thị. | Game không phải `PUBLISHED+PUBLIC` trả 404. Chỉ trả version `ACTIVE` có JAR `ACTIVE`. Ẩn game hoặc quarantine asset chặn ngay request tiếp theo. |
| **Admin UI XSS** | Ghép trực tiếp `custom_name`, filename, username vào template string `innerHTML` và attribute. | Dựng DOM bằng `createElement`, `textContent`, `dataset`, kiểm tra protocol an toàn và `rel="noopener noreferrer"`. |
| **Server startup** | Tự động sinh file JAR rỗng giả lập khi thiếu file; in mật khẩu admin ra console. | Bỏ tạo file giả, báo lỗi 404 trung thực khi thiếu file; không in mật khẩu ra console. |

---

## 3. Kết quả chạy kiểm tra thực tế (Verification Commands)

| Lệnh thực hiện | Exit Code | Kết quả chi tiết |
| --- | --- | --- |
| `pnpm test` | **0** | **15/15 test suites đạt PASS** (bao gồm 10 test smoke gốc và 5 test suites hồi quy mới cho S1, S2, Path Traversal, HTTP Range/HEAD, và State Transitions). Test spy xác nhận 0 lần đọc storage khi bị từ chối quyền. |
| `pnpm --filter @gametuoitho/api build` | **0** | `tsc --noEmit` hoàn tất không có lỗi trên toàn bộ mã nguồn API. |
| `pnpm --filter @gametuoitho/web build` | **0** | `astro build` biên dịch thành công 33 static pages và 57 client modules vite, bao gồm 2 trang admin đã sửa. |
| `git diff --check` | **0** | Không có lỗi whitespace hay conflict markers. |
| `git status --short` | **0** | Toàn bộ thay đổi nằm đúng phạm vi cho phép; không có file ngoài ý muốn bị xóa hoặc sửa. |
| `pnpm lint` | **1** | **Báo cáo trung thực:** 4/5 workspace package đạt exit 0 (`packages/shared-types`, `packages/shared-utils`, `packages/api-contracts`, `apps/api`). `apps/web` còn 2 lỗi TypeScript frontend hiện hữu đã biết nằm ngoài scope round này (`PlayGameClient.tsx` và `src/lib/api.ts`). |

---

## 4. Danh sách các file đã sửa đổi trong Round 01

- [`apps/api/src/storage/storage.ts`](file:///D:/Link%20tink/gametuoitho/apps/api/src/storage/storage.ts) (phòng thủ Path Traversal, absolute path, encoding)
- [`apps/api/src/repositories/assetRepository.ts`](file:///D:/Link%20tink/gametuoitho/apps/api/src/repositories/assetRepository.ts) (thêm `isCatalogPublicAsset`)
- [`apps/api/src/repositories/gameRepository.ts`](file:///D:/Link%20tink/gametuoitho/apps/api/src/repositories/gameRepository.ts) (lọc version/screenshot/cover active)
- [`apps/api/src/services/gameService.ts`](file:///D:/Link%20tink/gametuoitho/apps/api/src/services/gameService.ts) (guard kiểm tra game cha PUBLISHED + PUBLIC)
- [`apps/api/src/routes/games.ts`](file:///D:/Link%20tink/gametuoitho/apps/api/src/routes/games.ts) (trả 404 khi game không hợp lệ)
- [`apps/api/src/services/uploadService.ts`](file:///D:/Link%20tink/gametuoitho/apps/api/src/services/uploadService.ts) (thêm `checkAssetAccess` xác thực quyền qua DB)
- [`apps/api/src/routes/upload.ts`](file:///D:/Link%20tink/gametuoitho/apps/api/src/routes/upload.ts) (xử lý authorization trước đọc storage, headers an toàn, HTTP Range & HEAD contract)
- [`apps/api/src/index.ts`](file:///D:/Link%20tink/gametuoitho/apps/api/src/index.ts) (truyền `userRepo` vào `UploadService`)
- [`apps/api/src/server.ts`](file:///D:/Link%20tink/gametuoitho/apps/api/src/server.ts) (bỏ tạo JAR giả và bỏ log mật khẩu)
- [`apps/web/src/pages/admin/user-imports.astro`](file:///D:/Link%20tink/gametuoitho/apps/web/src/pages/admin/user-imports.astro) (DOM textContent chống Stored XSS)
- [`apps/web/src/pages/admin/storage.astro`](file:///D:/Link%20tink/gametuoitho/apps/web/src/pages/admin/storage.astro) (DOM textContent chống Stored XSS và link an toàn)
- [`tests/api.test.ts`](file:///D:/Link%20tink/gametuoitho/tests/api.test.ts) (bổ sung toàn diện test suites 11-15 và storage spy)
- [`docs/anty-status.md`](file:///D:/Link%20tink/gametuoitho/docs/anty-status.md) (tài liệu trạng thái và bằng chứng kiểm thử)

---

## 5. Giới hạn & Rủi ro còn lại (Limitations & Remaining Risks)

- **Lỗi Lint Frontend hiện hữu:** 2 lỗi TypeScript ở `apps/web/src/components/PlayGameClient.tsx` (truyền prop `game` thừa) và `apps/web/src/lib/api.ts` (gọi `process.env` thay vì `import.meta.env`) chưa được sửa trong round này do tuân thủ nghiêm ngặt chỉ đạo không sửa frontend logic ngoài phạm vi gói R01.
- **Môi trường Emulator (T07):** Round này đã hoàn thành route phát asset chuẩn HTTP 206 Range cho emulator. Tuy nhiên, việc truyền byte vào emulator và kiểm chứng chạy game thực tế thuộc phạm vi gói T07, hiện tại ghi nhận là chưa kiểm chứng thực địa trên trình duyệt.
- **Production Infrastructure:** Cloudflare R2 presigned URLs cho tệp lớn và D1 migrations trên môi trường staging/production thực tế chưa được kích hoạt ở round local adapter này.
