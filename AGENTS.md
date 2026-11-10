# AGENTS.md --- Nguyên Tắc Phát Triển Cho AI Coding Agent

Tài liệu này quy định các nguyên tắc bất biến mà mọi Agent phải tuân thủ nghiêm ngặt trong suốt quá trình phát triển dự án **Game Tuổi Thơ**.

## 1. Nguyên Tắc Cốt Lõi
1. **Kiến Trúc Độc Lập:**
   - Game Catalog, Asset Storage và Backend API là trung lập (Platform-Agnostic). Không thiết kế schema hay API phụ thuộc vào Web Emulator.
   - Android APK (Giai đoạn 2) và iOS (Giai đoạn 3) sẽ dùng chung Game ID, Version ID, Asset URL và Auth API.
2. **Bảo Mật Tối Đa:**
   - File JAR là dữ liệu không đáng tin cậy (Untrusted Binary). Tuyệt đối **không thực thi file JAR trên server**.
   - Không lưu nội dung nhị phân (Binary) hoặc Base64 của game vào Database (D1/SQLite). File luôn lưu trên Cloudflare R2 / Object Storage.
   - Mọi API nhạy cảm (`/admin/*`, `/me/*`) phải kiểm tra JWT Token và phân quyền (Role-Based Authorization) ở phía server.
3. **Phân Định Rõ Ràng Catalog và Thư Viện Cá Nhân:**
   - Game Catalog do Admin kiểm duyệt và xuất bản (`status = PUBLISHED`, `visibility = PUBLIC`).
   - Game do User import mặc định là `visibility = PRIVATE`. Không bao giờ tự động public game của user lên Catalog.
4. **Không Tạo Giả Lập Từ Đầu:**
   - Tận dụng Web Emulator mã nguồn mở đã được kiểm chứng (FreeJ2ME Web / J2ME Player qua CheerpJ 4.x).
   - Đóng gói emulator độc lập trong iframe sandbox, kết nối qua adapter interface.
5. **Không Hardcode Dữ Liệu:**
   - Mọi dữ liệu game hiển thị trên Web Frontend phải được truy xuất qua REST API `/api/v1/*`.

## 2. Tiếp Tục Điều Phối Agent

Khi cần trao đổi hoặc giao việc cho agent Antigravity hiện có, đọc [docs/antigravity-agent-access.md](docs/antigravity-agent-access.md) trước để dùng lại CLI, conversation ID và script đã kiểm chứng. Đối chiếu yêu cầu hiện tại, working tree và phản hồi trực tiếp của agent để chốt phạm vi file, tránh sửa chồng. Hướng dẫn setup/deploy và kết quả kiểm chứng được tổng hợp trong [README.md](README.md).
