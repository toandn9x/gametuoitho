# Tìm kiếm và Game ưa thích trên trang chủ

Trang chủ có ô tìm kiếm và nút **Tìm game**. Nhập tên rồi nhấn nút hoặc Enter để
mở `/games?search=...`; kết quả lấy từ API catalog công khai.

Trong **Admin → Game Catalog**, cột **Ưa thích** có nút ☆/★ cho từng game.
Bấm ☆ để đưa game vào danh sách, bấm ★ để bỏ chọn. Trạng thái được lưu trong
database, chỉ đổi trên giao diện sau khi API xác nhận lưu thành công.

Trang chủ hiển thị tối đa 8 game đã đánh dấu trong mục **Game ưa thích**.
**Xem tất cả** mở `/games?featured=true`; có thể kết hợp tìm kiếm và thể loại.
Game nháp, đang ẩn, lưu trữ hoặc riêng tư không xuất hiện ở danh sách công khai,
kể cả khi Admin đã đánh dấu. Đánh dấu ★ không thay đổi trạng thái xuất bản.

Đây là danh sách do Admin chọn cho trang chủ. Danh sách yêu thích cá nhân của
người dùng tại `/me/favorites` vẫn hoạt động riêng.

API bổ sung:

- `GET /api/v1/games?featured=true`: chỉ các game được đánh dấu.
- `GET /api/v1/games?featured=false`: chỉ các game chưa được đánh dấu.
- `PUT /api/v1/admin/games/:id` với JSON `{ "is_featured": true }` hoặc `false`:
  yêu cầu JWT và quyền Admin.
- Trường `is_featured` trong JSON game là boolean; database lưu INTEGER 0/1.
  Migration `0005_game_featured.sql` giữ nguyên dữ liệu game, mặc định chưa chọn.

Sau khi cập nhật mã nguồn, chạy lại server Node local để migration runner áp dụng
migration mới. Với Cloudflare D1, chạy migration theo quy trình triển khai của dự án.
