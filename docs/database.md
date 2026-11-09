# Thiết Kế Cơ Sở Dữ Liệu (Database Schema Documentation)

Hệ thống sử dụng cơ sở dữ liệu **Cloudflare D1 (SQLite engine)** với tính nhất quán cao, tốc độ truy vấn mili-giây tại edge.

## 1. Danh Sách Các Bảng

### 1.1. `users`
| Cột | Kiểu | Mô tả |
| :--- | :--- | :--- |
| `id` | TEXT PK | Khóa chính (UUID v4) |
| `username` | TEXT UNIQUE | Tên tài khoản |
| `email` | TEXT UNIQUE | Địa chỉ email |
| `password_hash` | TEXT | Hash mật khẩu (PBKDF2-SHA256: 100.000 vòng) |
| `role` | TEXT | `USER` hoặc `ADMIN` |
| `status` | TEXT | `ACTIVE` hoặc `BLOCKED` |
| `created_at` | TEXT | Thời gian tạo |
| `updated_at` | TEXT | Thời gian cập nhật |

### 1.2. `categories`
| Cột | Kiểu | Mô tả |
| :--- | :--- | :--- |
| `id` | TEXT PK | Khóa chính |
| `name` | TEXT | Tên thể loại (vd: Nhập vai, Hành động) |
| `slug` | TEXT UNIQUE | Slug URL thân thiện SEO |
| `description` | TEXT | Mô tả thể loại |
| `sort_order` | INTEGER | Thứ tự sắp xếp hiển thị |
| `status` | TEXT | `ACTIVE` hoặc `INACTIVE` |

### 1.3. `game_assets` (Quản lý file trên R2)
| Cột | Kiểu | Mô tả |
| :--- | :--- | :--- |
| `id` | TEXT PK | Khóa chính |
| `owner_user_id`| TEXT FK | Người sở hữu (null nếu là file hệ thống) |
| `asset_type` | TEXT | `JAR`, `JAD`, `COVER`, `SCREENSHOT` |
| `storage_key` | TEXT UNIQUE | Khóa lưu trữ trên Cloudflare R2 |
| `original_filename`| TEXT | Tên file gốc ban đầu |
| `mime_type` | TEXT | Định dạng MIME |
| `file_size` | INTEGER | Kích thước file tính theo bytes |
| `sha256` | TEXT | Mã băm toàn vẹn SHA-256 |
| `status` | TEXT | `UPLOADING`, `ACTIVE`, `QUARANTINED`, `DELETED` |
| `created_at` | TEXT | Ngày tải lên |

### 1.4. `games` (Game Catalog)
| Cột | Kiểu | Mô tả |
| :--- | :--- | :--- |
| `id` | TEXT PK | Khóa chính |
| `name` | TEXT | Tên game |
| `slug` | TEXT UNIQUE | URL slug |
| `description` | TEXT | Mô tả chi tiết |
| `developer` | TEXT | Nhà phát triển |
| `publisher` | TEXT | Nhà phát hành |
| `release_year`| INTEGER | Năm phát hành |
| `category_id` | TEXT FK | Danh mục chính |
| `cover_asset_id`| TEXT FK | Ảnh bìa |
| `status` | TEXT | `DRAFT`, `PUBLISHED`, `HIDDEN`, `ARCHIVED` |
| `visibility` | TEXT | `PUBLIC`, `PRIVATE` |
| `source_type` | TEXT | `ADMIN`, `USER_SUBMISSION` |
| `created_by` | TEXT FK | Người tạo |
| `published_at`| TEXT | Thời gian xuất bản |
| `created_at` | TEXT | Ngày tạo |
| `updated_at` | TEXT | Ngày sửa |

### 1.5. `game_versions`
| Cột | Kiểu | Mô tả |
| :--- | :--- | :--- |
| `id` | TEXT PK | Khóa chính |
| `game_id` | TEXT FK | Game sở hữu |
| `version_name`| TEXT | Tên phiên bản (vd: 1.0.0 Bản Tiếng Việt) |
| `jar_asset_id`| TEXT FK | File JAR |
| `jad_asset_id`| TEXT FK | File JAD (tùy chọn) |
| `jar_sha256` | TEXT | SHA-256 file JAR |
| `file_size` | INTEGER | Dung lượng byte |
| `status` | TEXT | `ACTIVE`, `INACTIVE` |
| `created_at` | TEXT | Ngày tạo |

### 1.6. `user_library` (Thư viện người dùng)
| Cột | Kiểu | Mô tả |
| :--- | :--- | :--- |
| `id` | TEXT PK | Khóa chính |
| `user_id` | TEXT FK | Người dùng |
| `game_id` | TEXT FK | Game Catalog (nếu thêm từ catalog) |
| `game_version_id`| TEXT FK | Phiên bản (nếu từ catalog) |
| `custom_asset_id`| TEXT FK | File JAR do user import |
| `custom_name` | TEXT | Tên do người dùng đặt |
| `source_type` | TEXT | `CATALOG` hoặc `IMPORT` |
| `created_at` | TEXT | Ngày thêm |

---

## 2. Quy Tắc Lưu Trữ File R2 (Storage Keys)

Tuân thủ nghiêm ngặt **PLAN.md Section 4.4**:
- Game Catalog:
  ```text
  games/{game_id}/versions/{version_id}/game.jar
  games/{game_id}/versions/{version_id}/game.jad
  games/{game_id}/covers/cover.webp
  games/{game_id}/screenshots/{screenshot_id}.webp
  ```
- User import:
  ```text
  users/{user_id}/imports/{asset_id}/game.jar
  users/{user_id}/imports/{asset_id}/game.jad
  ```
