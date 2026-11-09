# Chính Sách Bảo Mật & An Toàn File (Security Guidelines)

## 1. Nguyên Tắc An Toàn File Upload & Untrusted Binaries (Round 06 & Fix 01)
1. **Không Thực Thi Trên Máy Chủ**: File JAR tuyệt đối không bao giờ được khởi chạy hay thực thi trên backend server (Node.js hay Cloudflare Workers). File được đối xử thuần túy như blob nhị phân tĩnh lưu trên Cloudflare R2 hoặc Local Storage.
2. **Kiểm Tra Dung Lượng Trước Khi Đọc Vào Bộ Nhớ (Early Rejection)**:
   - Kiểm tra tiêu đề `Content-Length` ngay khi request đến; từ chối ngay lập tức với HTTP 413 (Payload Too Large) nếu vượt quá 50MB mà không đọc body.
   - Kiểm tra `file.size` trước khi gọi `file.arrayBuffer()`, từ chối ngay với HTTP 413 nếu vượt quá giới hạn.
3. **Xác Định Định Dạng Dựa Trên Nội Dung Thực Tế (Content-Based Detection)**:
   - Server hoàn toàn không tin tưởng `assetType` hay `file.type` / extension do client gửi lên.
   - **Tệp JAR:** Bắt đầu bằng magic bytes ZIP `0x50 0x4B 0x03 0x04`. Quét tìm End of Central Directory (EOCD), duyệt Central Directory records. Giới hạn số lượng entries tối đa 10,000 tệp. Giới hạn tổng kích thước giải nén tối đa 200MB. Kiểm tra tỷ lệ nén (chống ZIP bomb). Chặn path traversal `..`, đường dẫn tuyệt đối bắt đầu bằng `/` hoặc `\`, chứa ký tự ổ đĩa `C:`. Bắt buộc phải có `META-INF/MANIFEST.MF` và chứa thuộc tính `MIDlet-1` hoặc `MIDlet-Name`.
   - **Giải nén Manifest An Toàn (Deflate Inspection):** Với manifest nén bằng Deflate (method 8), luồng giải nén truyền thể hiện `Uint8Array` chuẩn vào `DecompressionStream`, await đầy đủ `write` và `close`. Giới hạn kích thước giải nén manifest tối đa 64KB (chống mini ZIP bomb manifest). Mọi ngoại lệ giải nén đều được bọc trả về lỗi, không làm chết tiến trình server.
   - **Tệp JAD:** Dung lượng $\le 100\text{KB}$, bắt buộc chứa đầy đủ các trường `MIDlet-Name`, `MIDlet-Version`, `MIDlet-Jar-URL`.
   - **Ảnh Bìa & Screenshot:** Xác thực bằng magic bytes nhị phân thực sự (PNG `\x89PNG`, JPEG `\xFF\xD8\xFF`, WebP `RIFF....WEBP`, GIF `GIF87a`/`GIF89a`), dung lượng $\le 5\text{MB}$.
   - Phần mở rộng và MIME type lưu trong Database và storage driver hoàn toàn do server ấn định (`game.jar`, `game.jad`, `cover.png`, `cover.jpg`), loại bỏ hoàn toàn phần mở rộng client gửi lên.
4. **Hạn Mức (Quota) & Giới Hạn Tần Suất (Rate Limit) Cho Người Dùng**:
   - Người dùng thông thường: Hạn mức lưu trữ tối đa 200MB và 50 tệp (tính trên các asset `ACTIVE`). Vượt hạn mức sẽ trả về HTTP 413.
   - Giới hạn tần suất: Tối đa 10 tệp tải lên / phút cho mỗi người dùng (trả về HTTP 429 Too Many Requests).
   - Quản trị viên tải asset vào Catalog không bị giới hạn quota người dùng thường.
5. **Vòng Đời `upload_jobs` & Cách Ly Tệp Lỗi `QUARANTINED`**:
   - Quản lý tiến trình upload qua bảng `upload_jobs`: `PENDING` $\to$ `PROCESSING` $\to$ `COMPLETED` / `FAILED`.
   - Khi có lỗi kiểm thực (ZIP bomb, traversal, file hỏng...): Asset được đánh dấu trạng thái `QUARANTINED`, `upload_jobs` ghi nhận `FAILED` kèm lý do lỗi. Tuyệt đối không lưu file lỗi vào storage driver và không kích hoạt asset `ACTIVE`.
6. **Chống Path Traversal**:
   - Tên file gốc của người dùng bị loại bỏ khi lưu trữ.
   - Storage key được sinh ngẫu nhiên theo khuôn mẫu chuẩn: `games/{id}/versions/{version_id}/game.jar` hoặc `users/{user_id}/imports/{asset_id}/game.jar`.

---

## 2. Quản Lý Phiên & Bí Mật Hệ Thống (Session & Secret Security)
1. **Chính Sách JWT_SECRET Không Khoan Nhượng**:
   - Trong môi trường Production (`NODE_ENV === 'production'` hoặc `ENVIRONMENT === 'production'`), bắt buộc cấu hình biến môi trường `JWT_SECRET` với độ dài tối thiểu 32 ký tự.
   - Server lập tức dừng khởi động (fail-fast exit 1) nếu thiếu hoặc không đủ 32 ký tự.
   - Tuyệt đối không hardcode secret key dự phòng trong mã nguồn. Trong môi trường dev/test, secret được sinh ngẫu nhiên động (ephemeral random UUID).
2. **Tái Xác Thực Dữ Liệu Từ Database (DB Re-verification)**:
   - Trên mỗi request gửi token, middleware thực hiện truy vấn DB để kiểm tra trạng thái thực tế của tài khoản (`user.status === 'ACTIVE'`).
   - Sử dụng quyền hạn (`role`) trực tiếp từ DB thay vì tin tưởng mù quáng vào payload JWT cũ. Người dùng bị hạ quyền từ ADMIN xuống USER sẽ bị tước quyền ngay lập tức.
3. **Cơ Chế Thu Hồi Phiên (Session Revocation)**:
   - Bảng `users` quản lý phiên bằng trường `token_version` (mặc định 0).
   - Payload JWT chứa claim `tokenVersion`.
   - Khi người dùng đăng xuất (`/api/v1/auth/logout`), đổi mật khẩu, hoặc bị quản trị viên khóa tài khoản/đổi quyền: `token_version` được tăng lên 1, làm vô hiệu hóa tức thì mọi token cũ.
4. **Phân Tích Cookie Chuẩn Xác**:
   - Regex phân tích cookie yêu cầu khớp chính xác tên `token` (`(?:^|;\s*)token=([^;]+)`).
   - Không bị nhầm lẫn bởi các cookie tương tự như `csrftoken=`, `xtoken=`.

---

## 3. Chính Sách Xuất Bản Game Duy Nhất (Single Publish Policy)
1. **Kiểm Tra Điều Kiện Tiên Quyết Trước Khi Xuất Bản**:
   - Mọi luồng xuất bản (Publish API, Update Status sang PUBLISHED) đều thông qua hàm chính sách tập trung `validatePublishPolicy(gameId)`.
   - Game chỉ được phép mang trạng thái `PUBLISHED` khi và chỉ khi:
     * Đã có ít nhất 1 phiên bản (version) hoạt động (`status = 'ACTIVE'`).
     * Phiên bản đó phải gắn với file JAR hợp lệ trong kho Catalog (`games/{gameId}/versions/...`), có `asset_type = 'JAR'`, và trạng thái asset là `ACTIVE`.
   - Nghiêm cấm tạo game mới với trạng thái `PUBLISHED` khi chưa nạp phiên bản và asset.
2. **Ngăn Chặn Sử Dụng Asset Riêng Tư Cho Catalog**:
   - Khi nạp phiên bản mới cho game Catalog (`addVersion`), hệ thống kiểm tra và từ chối nếu asset thuộc thư mục import cá nhân của người dùng (`users/...`).

---

## 4. Chống Tấn Công XSS & DoS Báo Cáo Lỗi (Crash Reports Security)
1. **An Toàn Kết Xuất DOM (Safe DOM Rendering)**:
   - Giao diện Admin Reports sử dụng API DOM an toàn (`createElement`, `textContent`, `replaceChildren`) thay thế hoàn toàn cho `innerHTML`, ngăn chặn triệt để Stored XSS từ stack trace, user-agent hoặc mã độc do client gửi lên.
2. **Kiểm Tra & Giới Hạn Báo Cáo Lỗi**:
   - Dữ liệu crash report được xác thực qua Zod (`CreateCrashReportSchema`).
   - Giới hạn kích thước payload tối đa 32KB (trả về HTTP 413 Payload Too Large nếu vượt quá).
   - Giới hạn tần suất gửi báo cáo: tối đa 10 yêu cầu / phút trên mỗi IP/User (trả về HTTP 429 Too Many Requests).
   - Khi gửi kèm `game_id` hoặc `game_slug`, hệ thống bắt buộc kiểm tra sự tồn tại trong DB và trích xuất tên game chính thức từ cơ sở dữ liệu.

---

## 5. Cấu Hình Web Emulator Sandbox & Hạn Chế F3
- Trình giả lập chạy bên trong thẻ `<iframe>` với các thuộc tính sandbox:
  `sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-forms"`
- Không truyền Auth Token hay Admin Session Cookie vào context iframe emulator.
- Emulator không có quyền truy cập trực tiếp vào Database D1 hay API Admin.
> [!WARNING]
> **Giới hạn an toàn (Hạn chế F3 - Người dùng đã tạm hoãn):** Trên thực tế, do emulator hiện chạy trên **cùng origin** với website chính (`allow-scripts` kết hợp với `allow-same-origin`), sandbox này không cô lập được `localStorage`, IndexedDB hoặc cookie của trang web chính. Đây là hạn chế bảo mật đã được ghi nhận trong Phase 0; người dùng đã quyết định tạm hoãn tách domain riêng cho iframe sang giai đoạn sau. Không tuyên bố cấu hình hiện tại là an toàn tuyệt đối.

---

## 6. Chính Sách Xóa Asset An Toàn (Safe Asset Deletion & Cleanup Window)
1. **Bảo Vệ Tính Toàn Vẹn Tham Chiếu (Reference Integrity)**:
   - Từ chối xóa (HTTP 409 Conflict) nếu asset đang được Catalog version tham chiếu (`jar_asset_id` hoặc `jad_asset_id`).
   - Từ chối xóa (HTTP 409 Conflict) nếu ảnh đang được Game Catalog tham chiếu làm ảnh bìa (`cover_asset_id`).
2. **Thứ Tự Xóa Nguyên Tử (Database-First Deletion)**:
   - Bản ghi trong Database luôn được xóa trước; nếu thành công mới tiến hành xóa file vật lý trên Storage Driver (R2 hoặc Local Storage).
   - Nếu Storage Driver xóa thất bại, hệ thống không gây lỗi giao dịch mà file mồ côi sẽ được dọn dẹp ở chu kỳ cleanup định kỳ.
3. **Dọn Dẹp User Import & Thông Báo Người Dùng**:
   - Khi xóa asset do người dùng tải lên (User Import), hệ thống tự động gỡ bỏ mục tương ứng khỏi `user_library` và trả về danh sách `affectedUsers` để hiển thị cảnh báo minh bạch trên giao diện quản trị.
4. **Xử Lý Xóa Hàng Loạt Độc Lập (Bulk Delete Isolation)**:
   - Giới hạn tối đa 100 ID / lần gọi để ngăn chặn DoS.
   - Xử lý từng asset độc lập trong vòng lặp; một asset gặp lỗi (409 Conflict, 404 Not Found) không làm hủy bỏ việc xóa các asset hợp lệ khác. Trả về kết quả chi tiết từng ID `{ id, ok, status, reason }`.
5. **Cửa Sổ An Toàn Khi Quét Dọn File Mồ Côi (15-Minute Safety Window)**:
   - Khi chạy chức năng quét và dọn file mồ côi (`/admin/storage/cleanup`), hệ thống bỏ qua toàn bộ các file có thời gian sửa đổi (mtime) trong vòng 15 phút gần nhất.
   - Cơ chế này bảo vệ an toàn cho các tệp vừa được tải lên nhưng đang chờ giao dịch DB hoàn tất, tránh việc xóa nhầm tệp đang trong tiến trình tải lên.

---

## 7. Chính Sách Nguồn Game & Nhập Dữ Liệu Crawler An Toàn
Theo quyết định của người dùng ngày 09/11/2026:
1. **Chỉ Cho Phép Nguồn Được Ủy Thác**:
   - Crawler chỉ được phép kết nối và tải tài nguyên từ nguồn duy nhất: `https://gametuoitho.cc`.
   - Cơ chế `safeFetchFromSource` kiểm tra URL, chặn mọi redirect sang hostname khác (`currentUrl.hostname !== 'gametuoitho.cc'`), tối đa 3 lần chuyển hướng.
2. **Nguyên Tắc DRAFT Bắt Buộc**:
   - Toàn bộ game nhập từ crawler **chỉ được tạo ở trạng thái `DRAFT`** (`visibility = 'PUBLIC'`).
   - Tuyệt đối không tự động xuất bản (publish) game lên Catalog công khai.
3. **Quản Trị Viên Tự Duyệt & Xuất Bản**:
   - Quản trị viên phải kiểm tra game trong danh sách Quản trị, xác nhận tệp JAR và thông tin trước khi chủ động bấm "Xuất bản" (Publish) theo đúng Single Publish Policy.
4. **Kiểm Thực Tệp Nhị Phân & Chống Trùng Lặp**:
   - File JAR tải về phải vượt qua toàn bộ bước kiểm tra chuyên sâu (`validateJarFile`).
   - Tính toán SHA-256; nếu Catalog đã có game chứa cùng hash JAR thì lập tức từ chối với HTTP 409 Conflict, ngăn ngừa trùng lặp dữ liệu.
   - Định danh nguồn ổn định bằng `source_key` (`${id}_${hash(filename)}`), bảo đảm không xung đột giữa các phiên bản game trùng tên nguồn.
