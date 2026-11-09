# Thiết Kế Cơ Sở Dữ Liệu (Database Schema Documentation)

Hệ thống sử dụng cơ sở dữ liệu quan hệ **Cloudflare D1 (SQLite engine)** cho môi trường Edge và **better-sqlite3** cho môi trường máy chủ cục bộ / tự host.

---

## 1. Danh Sách Đầy Đủ Các Bảng

### 1.1. `users` (Tài khoản người dùng & Quản trị)
| Cột | Kiểu | Ràng buộc | Mô tả |
| :--- | :--- | :--- | :--- |
| `id` | TEXT | PRIMARY KEY | Khóa chính (UUID v4) |
| `username` | TEXT | UNIQUE, NOT NULL | Tên đăng nhập |
| `email` | TEXT | UNIQUE, NOT NULL | Địa chỉ email |
| `password_hash` | TEXT | NOT NULL | Hash mật khẩu (PBKDF2-SHA256, 100.000 iterations) |
| `role` | TEXT | NOT NULL, CHECK (`USER`, `ADMIN`) | Phân quyền tài khoản (mặc định `USER`) |
| `status` | TEXT | NOT NULL, CHECK (`ACTIVE`, `BLOCKED`) | Trạng thái hoạt động (mặc định `ACTIVE`) |
| `token_version` | INTEGER | NOT NULL DEFAULT 0 | Phiên bản token phục vụ thu hồi phiên (Session Revocation) |
| `created_at` | TEXT | NOT NULL DEFAULT (datetime('now')) | Thời điểm tạo tài khoản |
| `updated_at` | TEXT | NOT NULL DEFAULT (datetime('now')) | Thời điểm cập nhật thông tin |

### 1.2. `categories` (Thể loại game)
| Cột | Kiểu | Ràng buộc | Mô tả |
| :--- | :--- | :--- | :--- |
| `id` | TEXT | PRIMARY KEY | Khóa chính (vd: `cat-rpg`, `cat-action`) |
| `name` | TEXT | NOT NULL | Tên thể loại (vd: Nhập vai, Hành động, Đua xe) |
| `slug` | TEXT | UNIQUE, NOT NULL | Slug URL thân thiện SEO |
| `description` | TEXT | NULL | Mô tả chi tiết thể loại |
| `sort_order` | INTEGER | NOT NULL DEFAULT 0 | Thứ tự hiển thị ưu tiên |
| `status` | TEXT | NOT NULL, CHECK (`ACTIVE`, `INACTIVE`) | Trạng thái hiển thị |

### 1.3. `game_assets` (Quản lý file trên R2 / Local Storage)
| Cột | Kiểu | Ràng buộc | Mô tả |
| :--- | :--- | :--- | :--- |
| `id` | TEXT | PRIMARY KEY | Khóa chính asset (UUID v4) |
| `owner_user_id` | TEXT | FK `users(id)` ON DELETE SET NULL | Người tải lên (NULL nếu là file hệ thống/admin) |
| `asset_type` | TEXT | NOT NULL, CHECK (`JAR`, `JAD`, `COVER`, `SCREENSHOT`) | Loại tệp tin |
| `storage_key` | TEXT | UNIQUE, NOT NULL | Khóa lưu trữ vật lý trên R2 hoặc thư mục uploads |
| `original_filename` | TEXT | NOT NULL | Tên file gốc ban đầu |
| `mime_type` | TEXT | NOT NULL | Định dạng MIME do server kiểm soát |
| `file_size` | INTEGER | NOT NULL DEFAULT 0 | Dung lượng tính theo byte |
| `sha256` | TEXT | NOT NULL | Mã băm toàn vẹn SHA-256 |
| `status` | TEXT | NOT NULL, CHECK (`UPLOADING`, `ACTIVE`, `QUARANTINED`, `DELETED`) | Trạng thái asset |
| `created_at` | TEXT | NOT NULL DEFAULT (datetime('now')) | Thời điểm tải lên |

### 1.4. `games` (Danh mục Catalog Game)
| Cột | Kiểu | Ràng buộc | Mô tả |
| :--- | :--- | :--- | :--- |
| `id` | TEXT | PRIMARY KEY | Khóa chính trò chơi (UUID v4) |
| `name` | TEXT | NOT NULL | Tên chính thức của game |
| `slug` | TEXT | UNIQUE, NOT NULL | Slug định danh duy nhất trên URL |
| `description` | TEXT | NULL | Bài viết / tóm tắt giới thiệu game |
| `developer` | TEXT | NULL | Nhà phát triển game (Gameloft, EA Mobile...) |
| `publisher` | TEXT | NULL | Nhà phát hành |
| `release_year` | INTEGER | NULL | Năm phát hành gốc |
| `category_id` | TEXT | FK `categories(id)` ON DELETE RESTRICT | Thể loại chính của game |
| `cover_asset_id` | TEXT | FK `game_assets(id)` ON DELETE SET NULL | Ảnh bìa đại diện |
| `status` | TEXT | NOT NULL, CHECK (`DRAFT`, `PUBLISHED`, `HIDDEN`, `ARCHIVED`) | Trạng thái vòng đời game (mặc định `DRAFT`) |
| `visibility` | TEXT | NOT NULL, CHECK (`PUBLIC`, `PRIVATE`) | Khả năng hiển thị (mặc định `PUBLIC`) |
| `is_featured` | INTEGER | NOT NULL DEFAULT 0, CHECK (`0`, `1`) | Admin đánh dấu ★ để chọn vào mục Game ưa thích trên trang chủ; không tự xuất bản game |
| `source_type` | TEXT | NOT NULL, CHECK (`ADMIN`, `USER_SUBMISSION`) | Nguồn gốc tạo game |
| `created_by` | TEXT | FK `users(id)` ON DELETE SET NULL | Quản trị viên khởi tạo |
| `published_at` | TEXT | NULL | Thời điểm chính thức xuất bản ra công chúng |
| `created_at` | TEXT | NOT NULL DEFAULT (datetime('now')) | Thời điểm tạo bản ghi |
| `updated_at` | TEXT | NOT NULL DEFAULT (datetime('now')) | Thời điểm cập nhật cuối cùng |

### 1.5. `game_versions` (Các phiên bản tệp JAR/JAD của game)
| Cột | Kiểu | Ràng buộc | Mô tả |
| :--- | :--- | :--- | :--- |
| `id` | TEXT | PRIMARY KEY | Khóa chính phiên bản (UUID v4) |
| `game_id` | TEXT | FK `games(id)` ON DELETE CASCADE | Thuộc game catalog nào |
| `version_name` | TEXT | NOT NULL | Tên phiên bản (vd: "Bản Chuẩn 240x320", "1.0.2") |
| `jar_asset_id` | TEXT | FK `game_assets(id)` ON DELETE RESTRICT | Tệp binary JAR chính thức |
| `jad_asset_id` | TEXT | FK `game_assets(id)` ON DELETE SET NULL | Tệp mô tả JAD (tùy chọn) |
| `jar_sha256` | TEXT | NOT NULL | Hash SHA-256 của file JAR (chống trùng lặp) |
| `jad_sha256` | TEXT | NULL | Hash SHA-256 của file JAD |
| `file_size` | INTEGER | NOT NULL DEFAULT 0 | Dung lượng file JAR tính bằng byte |
| `status` | TEXT | NOT NULL, CHECK (`ACTIVE`, `INACTIVE`) | Trạng thái phiên bản |
| `created_at` | TEXT | NOT NULL DEFAULT (datetime('now')) | Thời điểm tạo phiên bản |

### 1.6. `game_screenshots` (Ảnh chụp màn hình của game)
| Cột | Kiểu | Ràng buộc | Mô tả |
| :--- | :--- | :--- | :--- |
| `id` | TEXT | PRIMARY KEY | Khóa chính (UUID v4) |
| `game_id` | TEXT | FK `games(id)` ON DELETE CASCADE | Thuộc game nào |
| `asset_id` | TEXT | FK `game_assets(id)` ON DELETE CASCADE | Asset ảnh chụp màn hình |
| `sort_order` | INTEGER | NOT NULL DEFAULT 0 | Thứ tự sắp xếp hiển thị ảnh |

### 1.7. `user_library` (Thư viện game cá nhân của người dùng)
| Cột | Kiểu | Ràng buộc | Mô tả |
| :--- | :--- | :--- | :--- |
| `id` | TEXT | PRIMARY KEY | Khóa chính bản ghi thư viện |
| `user_id` | TEXT | FK `users(id)` ON DELETE CASCADE | Người sở hữu mục thư viện |
| `game_id` | TEXT | FK `games(id)` ON DELETE CASCADE | Game Catalog (nếu thêm từ catalog công khai) |
| `game_version_id` | TEXT | FK `game_versions(id)` ON DELETE SET NULL | Phiên bản game catalog được chọn |
| `custom_asset_id` | TEXT | FK `game_assets(id)` ON DELETE CASCADE | File JAR cá nhân người dùng tự import |
| `custom_name` | TEXT | NOT NULL | Tên hiển thị cá nhân hóa |
| `source_type` | TEXT | NOT NULL, CHECK (`CATALOG`, `IMPORT`) | Nguồn gốc game trong thư viện |
| `created_at` | TEXT | NOT NULL DEFAULT (datetime('now')) | Ngày thêm vào thư viện |

- **Ràng buộc duy nhất:**
  * `uq_user_catalog_game`: `UNIQUE(user_id, game_id) WHERE source_type = 'CATALOG'` (không thêm trùng game catalog).
  * `uq_user_import_asset`: `UNIQUE(user_id, custom_asset_id) WHERE source_type = 'IMPORT'` (không thêm trùng file import).

### 1.8. `user_game_activity` (Lịch sử chơi & Yêu thích)
| Cột | Kiểu | Ràng buộc | Mô tả |
| :--- | :--- | :--- | :--- |
| `id` | TEXT | PRIMARY KEY | Khóa chính hoạt động |
| `user_id` | TEXT | FK `users(id)` ON DELETE CASCADE | Người dùng thực hiện |
| `game_id` | TEXT | FK `games(id)` ON DELETE CASCADE | Game catalog (nếu có) |
| `user_library_id` | TEXT | FK `user_library(id)` ON DELETE CASCADE | Mục thư viện cá nhân (nếu là import) |
| `activity_type` | TEXT | NOT NULL, CHECK (`PLAY`, `FAVORITE`) | Loại hoạt động ghi nhận |
| `last_played_at` | TEXT | NOT NULL DEFAULT (datetime('now')) | Thời điểm chơi gần nhất |
| `play_count` | INTEGER | NOT NULL DEFAULT 1 | Số lượt đã chơi |

### 1.9. `upload_jobs` (Theo dõi tiến trình & hạn mức upload)
| Cột | Kiểu | Ràng buộc | Mô tả |
| :--- | :--- | :--- | :--- |
| `id` | TEXT | PRIMARY KEY | Khóa chính công việc tải lên |
| `user_id` | TEXT | FK `users(id)` ON DELETE CASCADE | Người thực hiện tải lên |
| `asset_id` | TEXT | FK `game_assets(id)` ON DELETE CASCADE | Asset tương ứng được tạo |
| `status` | TEXT | NOT NULL, CHECK (`PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`) | Tiến trình xử lý |
| `error_message` | TEXT | NULL | Chi tiết lỗi nếu kiểm thực thất bại |
| `created_at` | TEXT | NOT NULL DEFAULT (datetime('now')) | Thời điểm bắt đầu tải |
| `updated_at` | TEXT | NOT NULL DEFAULT (datetime('now')) | Thời điểm cập nhật trạng thái |

### 1.10. `audit_logs` (Nhật ký kiểm toán quản trị)
| Cột | Kiểu | Ràng buộc | Mô tả |
| :--- | :--- | :--- | :--- |
| `id` | TEXT | PRIMARY KEY | Khóa chính nhật ký |
| `user_id` | TEXT | FK `users(id)` ON DELETE CASCADE | Quản trị viên thực hiện thao tác |
| `action` | TEXT | NOT NULL | Hành động (DELETE_GAME, PUBLISH_GAME, BULK_DELETE...) |
| `target_type` | TEXT | NOT NULL | Loại đối tượng tác động (GAME, ASSET, USER...) |
| `target_id` | TEXT | NULL | ID đối tượng bị tác động |
| `details` | TEXT | NULL | Dữ liệu chi tiết bổ sung dạng JSON |
| `ip_address` | TEXT | NULL | Địa chỉ IP của client gọi API |
| `created_at` | TEXT | NOT NULL DEFAULT (datetime('now')) | Thời điểm ghi nhận thao tác |

### 1.11. `game_crash_reports` (Báo cáo lỗi emulator & runtime)
| Cột | Kiểu | Ràng buộc | Mô tả |
| :--- | :--- | :--- | :--- |
| `id` | TEXT | PRIMARY KEY | Khóa chính báo cáo |
| `game_id` | TEXT | FK `games(id)` ON DELETE SET NULL | Game xảy ra lỗi (nếu có) |
| `game_version_id` | TEXT | NULL | Phiên bản game |
| `game_slug` | TEXT | NULL | Slug của game |
| `game_name` | TEXT | NOT NULL | Tên trò chơi |
| `user_id` | TEXT | FK `users(id)` ON DELETE SET NULL | Người dùng báo cáo (nếu đã đăng nhập) |
| `error_type` | TEXT | NOT NULL, CHECK (`LOAD_FAILED`, `CRASH`, `EMULATOR_ERROR`, `CORRUPT_JAR`, `USER_REPORT`) | Phân loại lỗi |
| `error_message` | TEXT | NOT NULL | Thông điệp lỗi |
| `stack_trace` | TEXT | NULL | Call stack trace từ CheerpJ / runtime |
| `user_agent` | TEXT | NULL | Thông tin trình duyệt client |
| `status` | TEXT | NOT NULL DEFAULT 'OPEN' CHECK (`OPEN`, `INVESTIGATING`, `RESOLVED`, `IGNORED`) | Trạng thái xử lý |
| `admin_notes` | TEXT | NULL | Ghi chú của quản trị viên |
| `created_at` | TEXT | NOT NULL DEFAULT (datetime('now')) | Thời điểm gửi báo cáo |
| `updated_at` | TEXT | NOT NULL DEFAULT (datetime('now')) | Thời điểm xử lý báo cáo |

### 1.12. `schema_migrations` (Bảng quản lý phiên bản migration)
| Cột | Kiểu | Ràng buộc | Mô tả |
| :--- | :--- | :--- | :--- |
| `name` | TEXT | PRIMARY KEY | Tên file migration (vd: `0001_initial_schema.sql`) |
| `applied_at` | TEXT | NOT NULL DEFAULT (datetime('now')) | Thời điểm áp dụng migration vào DB |

---

## 2. Quy Tắc Lưu Trữ File (Storage Keys)

Tuân thủ nghiêm ngặt **PLAN.md Section 4.4**:
- **Game Catalog (Công khai do Admin quản lý):**
  ```text
  games/{game_id}/versions/{version_id}/game.jar
  games/{game_id}/versions/{version_id}/game.jad
  games/{game_id}/covers/cover.{ext}
  games/{game_id}/screenshots/{screenshot_id}.{ext}
  ```
- **User Import (Riêng tư của người dùng):**
  ```text
  users/{user_id}/imports/{asset_id}/game.{ext}
  ```
- **Quarantined (File lỗi / cách ly):**
  ```text
  quarantined/{asset_id}
  ```

---

## 3. Quản Lý Migration & Cách Thức Thực Thi

Hệ thống quản lý schema qua các file SQL đánh số thứ tự trong thư mục `database/migrations/`:
1. `0001_initial_schema.sql`: Khởi tạo 10 bảng cốt lõi (users, categories, game_assets, games, game_versions, game_screenshots, user_library, user_game_activity, upload_jobs, audit_logs).
2. `0002_crash_reports.sql`: Bổ sung bảng `game_crash_reports` theo dõi lỗi runtime.
3. `0003_token_version.sql`: Thêm cột `token_version` vào bảng `users` phục vụ thu hồi phiên.
4. `0004_library_constraints.sql`: Thêm chỉ mục duy nhất `uq_user_import_asset` chống trùng lặp import.
5. `0005_game_featured.sql`: Thêm cờ `games.is_featured` và chỉ mục lọc danh sách Game ưa thích công khai. Game hiện có mặc định chưa được đánh dấu.

### Thực thi trên môi trường Node.js / SQLite cục bộ:
Module [`apps/api/src/repositories/migrationRunner.ts`](file:///D:/Link%20tink/gametuoitho/apps/api/src/repositories/migrationRunner.ts) tự động kiểm tra `schema_migrations`, phát hiện các bảng hiện hữu và thực thi các file migration mới chưa áp dụng theo thứ tự bảng chữ cái. Hàm `runMigrations(dbClient, migrationsDir)` được gọi tự động khi khởi động `server.ts`, `dev-server.ts` hoặc bộ kiểm thử tự động.

### Thực thi trên môi trường Cloudflare D1 (Production):
Thực thi tuần tự các file migration qua công cụ Wrangler:
```bash
wrangler d1 execute gametuoitho-d1 --file=./database/migrations/0001_initial_schema.sql --remote
wrangler d1 execute gametuoitho-d1 --file=./database/migrations/0002_crash_reports.sql --remote
wrangler d1 execute gametuoitho-d1 --file=./database/migrations/0003_token_version.sql --remote
wrangler d1 execute gametuoitho-d1 --file=./database/migrations/0004_library_constraints.sql --remote
wrangler d1 execute gametuoitho-d1 --file=./database/migrations/0005_game_featured.sql --remote
```
*(Tuyệt đối không chạy file seed data mẫu lên môi trường Cloudflare D1 Production).*
