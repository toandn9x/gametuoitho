# Chính Sách Bảo Mật & An Toàn File (Security Guidelines)

## 1. Nguyên Tắc An Toàn File JAR (Untrusted Binaries)
1. **Không Thực Thi Trên Máy Chủ**: File JAR tuyệt đối không bao giờ được khởi chạy hay thực thi trên backend server (Node.js hay Cloudflare Workers). File được đối xử thuần túy như blob nhị phân tĩnh lưu trên Cloudflare R2.
2. **Kiểm Tra Chữ Ký Tệp (Magic Bytes)**:
   - File upload phải bắt đầu bằng chữ ký ZIP hợp lệ: `0x50, 0x4B, 0x03, 0x04` (`PK\x03\x04`).
   - Kiểm tra mã băm SHA-256 để đảm bảo toàn vẹn dữ liệu.
3. **Phòng Chống ZIP Bomb & DoS**:
   - Giới hạn dung lượng upload tối đa là 50MB (thông thường game J2ME dưới 3MB).
   - Kiểm tra kích thước trước khi lưu trữ vào R2.
4. **Chống Path Traversal**:
   - Tên file gốc của người dùng bị loại bỏ khi lưu trữ.
   - Storage key được sinh ngẫu nhiên theo khuôn mẫu chuẩn: `games/{id}/versions/{version_id}/game.jar` hoặc `users/{user_id}/imports/{asset_id}/game.jar`.

---

## 2. Phân Quyền & Kiểm Soát Truy Cập (Access Control)
1. **Role-Based Authorization (RBAC)**:
   - Toàn bộ endpoint `/api/v1/admin/*` bắt buộc kiểm tra `user.role === 'ADMIN'`. Trả về mã lỗi `403 Forbidden` nếu là user thường.
   - Không dựa vào việc ẩn nút hay ẩn giao diện trên Frontend để bảo vệ tính năng quản trị.
2. **Quyền Riêng Tư User Imports**:
   - File và bản ghi import của người dùng luôn gán `owner_user_id`.
   - Người dùng chỉ được xem, chơi và xóa các file do chính họ sở hữu (`WHERE user_id = ?`).
   - Game người dùng import mặc định là `visibility = PRIVATE`. Không bao giờ tự động chuyển game của user sang Catalog công khai nếu chưa có thỏa thuận phân phối.

---

## 3. Bảo Vệ Dữ Liệu & Mật Khẩu
1. **Mật Khẩu**:
   - Hash bằng thuật toán chuẩn công nghiệp **PBKDF2-SHA256** với 100.000 vòng lặp và Salt ngẫu nhiên 16 bytes thông qua WebCrypto API tiêu chuẩn (`crypto.subtle`).
   - Tuyệt đối không lưu mật khẩu dạng bản rõ (plaintext).
2. **Xác Thực (Authentication)**:
   - Sử dụng JWT (JSON Web Token) được ký bằng thuật toán HMAC-SHA256 với secret key được quản lý an toàn trong biến môi trường.
   - Token có thời hạn hợp lệ cụ thể (TTL).

---

## 4. Cô Lập Web Emulator Sandbox
- Trình giả lập chạy bên trong thẻ `<iframe>` với các thuộc tính sandbox tối thiểu:
  `sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-forms"`
- Không truyền Auth Token hay Admin Session Cookie vào context iframe emulator.
- Emulator không có quyền truy cập trực tiếp vào Database D1 hay API Admin.
