-- 0001_seed_data.sql: Danh mục chuẩn khởi tạo cho Nền tảng Game Tuổi Thơ (R05-E)
-- Catalog ban đầu rỗng, không chứa dữ liệu seed game, asset hoặc tài khoản mẫu.

INSERT OR IGNORE INTO categories (id, name, slug, description, sort_order, status)
VALUES
  ('cat-rpg', 'Nhập vai', 'nhap-vai', 'Các tựa game luyện cấp, làm nhiệm vụ, săn quái huyền thoại', 1, 'ACTIVE'),
  ('cat-action', 'Hành động', 'hanh-dong', 'Phiêu lưu, vượt ải và chiến đấu kịch tính', 2, 'ACTIVE'),
  ('cat-adventure', 'Phiêu lưu', 'phieu-luu', 'Thám hiểm thế giới kỳ bí và giải cứu vùng đất', 3, 'ACTIVE'),
  ('cat-strategy', 'Chiến thuật', 'chien-thuat', 'Tư duy chiến thuật, bài binh bố trận', 4, 'ACTIVE'),
  ('cat-puzzle', 'Trí tuệ', 'tri-tue', 'Thử thách tư duy, tìm đường và xếp ngọc', 5, 'ACTIVE'),
  ('cat-sports', 'Thể thao', 'the-thao', 'Bóng đá, quần vợt và thể thao đỉnh cao', 6, 'ACTIVE'),
  ('cat-racing', 'Đua xe', 'dua-xe', 'Tốc độ đỉnh cao và đường đua nghẹt thở', 7, 'ACTIVE'),
  ('cat-arcade', 'Arcade', 'arcade', 'Bắn máy bay, bắn gà, gắp thú kinh điển', 8, 'ACTIVE');
