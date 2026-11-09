-- 0001_seed_data.sql: Dữ liệu khởi tạo cho Nền tảng Game Tuổi Thơ

-- 1. Insert Initial Users
INSERT OR IGNORE INTO users (id, username, email, password_hash, role, status, created_at, updated_at)
VALUES
  ('usr-admin-01', 'admin', 'admin@gametuoitho.vn', 'd235387e13a1a21a05c3867631bb0fa9:5c884feed68a8a5d86f04788dcac236e177adddb49b3f4cf9ea8f7ddd3b8c606', 'ADMIN', 'ACTIVE', datetime('now'), datetime('now')),
  ('usr-player-01', 'gamer9x', 'gamer9x@gametuoitho.vn', 'd235387e13a1a21a05c3867631bb0fa9:f7540cd2d2f00bfa15b15b1d5464f502550d958a2b8e6797269fa6241efbd8ca', 'USER', 'ACTIVE', datetime('now'), datetime('now'));

-- 2. Insert Categories
INSERT OR IGNORE INTO categories (id, name, slug, description, sort_order, status)
VALUES
  ('cat-rpg', 'Nhập vai (RPG)', 'nhap-vai', 'Các tựa game luyện cấp, làm nhiệm vụ, săn quái huyền thoại', 1, 'ACTIVE'),
  ('cat-action', 'Hành động', 'hanh-dong', 'Phiêu lưu, vượt ải và chiến đấu kịch tính', 2, 'ACTIVE'),
  ('cat-puzzle', 'Trí tuệ & Giải đố', 'tri-tue', 'Thử thách tư duy, tìm đường và xếp ngọc', 3, 'ACTIVE'),
  ('cat-racing', 'Đua xe & Thể thao', 'the-thao-dua-xe', 'Tốc độ đỉnh cao và thể thao sôi động', 4, 'ACTIVE'),
  ('cat-casual', 'Đời sống & Nông trại', 'doi-song', 'Câu cá, trồng trọt, kết bạn ảo thời kỳ 2G', 5, 'ACTIVE'),
  ('cat-shooter', 'Bắn súng & Arcade', 'ban-sung', 'Bắn gà, bắn phi thuyền kinh điển', 6, 'ACTIVE');

-- 3. Insert Assets (Covers & JAR files)
INSERT OR IGNORE INTO game_assets (id, owner_user_id, asset_type, storage_key, original_filename, mime_type, file_size, sha256, status, created_at)
VALUES
  ('ast-cov-ninja', 'usr-admin-01', 'COVER', 'games/ninja-school/covers/cover.webp', 'cover_ninja.webp', 'image/webp', 45000, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'ACTIVE', datetime('now')),
  ('ast-jar-ninja', 'usr-admin-01', 'JAR', 'games/ninja-school/versions/1.0.0/game.jar', 'NinjaSchool.jar', 'application/java-archive', 354890, 'f2ca1bb6c7e907d06dafe4687e579fce76b37e4e93b7605022da52e6ccc26fd2', 'ACTIVE', datetime('now')),
  
  ('ast-cov-diamond', 'usr-admin-01', 'COVER', 'games/diamond-rush/covers/cover.webp', 'cover_diamond.webp', 'image/webp', 52000, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b856', 'ACTIVE', datetime('now')),
  ('ast-jar-diamond', 'usr-admin-01', 'JAR', 'games/diamond-rush/versions/1.0.0/game.jar', 'DiamondRush.jar', 'application/java-archive', 421000, 'a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0', 'ACTIVE', datetime('now')),

  ('ast-cov-bounce', 'usr-admin-01', 'COVER', 'games/bounce-tales/covers/cover.webp', 'cover_bounce.webp', 'image/webp', 38000, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b857', 'ACTIVE', datetime('now')),
  ('ast-jar-bounce', 'usr-admin-01', 'JAR', 'games/bounce-tales/versions/1.0.0/game.jar', 'BounceTales.jar', 'application/java-archive', 298000, 'b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef01', 'ACTIVE', datetime('now')),

  ('ast-cov-avatar', 'usr-admin-01', 'COVER', 'games/avatar/covers/cover.webp', 'cover_avatar.webp', 'image/webp', 49000, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b858', 'ACTIVE', datetime('now')),
  ('ast-jar-avatar', 'usr-admin-01', 'JAR', 'games/avatar/versions/2.5.0/game.jar', 'Avatar250.jar', 'application/java-archive', 512000, 'c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef012', 'ACTIVE', datetime('now')),

  ('ast-cov-asphalt', 'usr-admin-01', 'COVER', 'games/asphalt-3/covers/cover.webp', 'cover_asphalt.webp', 'image/webp', 61000, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b859', 'ACTIVE', datetime('now')),
  ('ast-jar-asphalt', 'usr-admin-01', 'JAR', 'games/asphalt-3/versions/1.0.0/game.jar', 'Asphalt3.jar', 'application/java-archive', 680000, 'd4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0123', 'ACTIVE', datetime('now')),

  ('ast-cov-space', 'usr-admin-01', 'COVER', 'games/space-impact/covers/cover.webp', 'cover_space.webp', 'image/webp', 25000, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b860', 'ACTIVE', datetime('now')),
  ('ast-jar-space', 'usr-admin-01', 'JAR', 'games/space-impact/versions/1.0.0/game.jar', 'SpaceImpact.jar', 'application/java-archive', 154000, 'e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef01234', 'ACTIVE', datetime('now'));

-- 4. Insert Games Catalog
INSERT OR IGNORE INTO games (id, name, slug, description, developer, publisher, release_year, category_id, cover_asset_id, status, visibility, source_type, created_by, published_at, created_at, updated_at)
VALUES
  ('gam-ninja', 'Ninja School 1: Tiêu Diệt Sơn Tặc', 'ninja-school', 'Tựa game nhập vai hành động huyền thoại gắn liền với tuổi thơ thế hệ 9x. Hóa thân thành học viên ninja trẻ tuổi tham gia rèn luyện võ nghệ, tiêu diệt ác tặc bảo vệ ngôi làng.', 'Teamobi', 'Teamobi', 2008, 'cat-rpg', 'ast-cov-ninja', 'PUBLISHED', 'PUBLIC', 'ADMIN', 'usr-admin-01', datetime('now'), datetime('now'), datetime('now')),
  
  ('gam-diamond', 'Diamond Rush', 'diamond-rush', 'Game giải đố vượt ải kinh điển cài sẵn trên hàng triệu điện thoại Nokia. Người chơi điều khiển nhân vật thám hiểm các lăng mộ cổ đại Angkor Wat, Bavaria và Tây Tạng để thu thập kim cương quý giá.', 'Gameloft', 'Gameloft', 2006, 'cat-puzzle', 'ast-cov-diamond', 'PUBLISHED', 'PUBLIC', 'ADMIN', 'usr-admin-01', datetime('now'), datetime('now'), datetime('now')),

  ('gam-bounce', 'Bounce Tales', 'bounce-tales', 'Hành trình của quả bóng đỏ nảy vui nhộn cứu lấy vùng đất màu sắc khỏi cỗ máy thôi miên của khối lập phương đen độc ác. Vật lý nảy bóng cuốn hút và âm nhạc tuổi thơ.', 'Nokia', 'Rovio / Nokia', 2008, 'cat-action', 'ast-cov-bounce', 'PUBLISHED', 'PUBLIC', 'ADMIN', 'usr-admin-01', datetime('now'), datetime('now'), datetime('now')),

  ('gam-avatar', 'Avatar: Thành Phố Diệu Kỳ', 'avatar', 'Xã hội ảo thu nhỏ trên điện thoại 2G. Nơi người chơi trồng cây, nuôi cá, giao lưu kết bạn, chơi cờ tướng, caro và thể hiện phong cách thời trang pixel cá tính.', 'Teamobi', 'Teamobi', 2009, 'cat-casual', 'ast-cov-avatar', 'PUBLISHED', 'PUBLIC', 'ADMIN', 'usr-admin-01', datetime('now'), datetime('now'), datetime('now')),

  ('gam-asphalt', 'Asphalt 3: Street Rules', 'asphalt-3', 'Đỉnh cao của game đua xe 3D trên nền tảng J2ME. Trải nghiệm cảm giác lạng lách qua các góc phố Tokyo, New York, né tránh cảnh sát và giành danh hiệu vua tốc độ.', 'Gameloft', 'Gameloft', 2006, 'cat-racing', 'ast-cov-asphalt', 'PUBLISHED', 'PUBLIC', 'ADMIN', 'usr-admin-01', datetime('now'), datetime('now'), datetime('now')),

  ('gam-space', 'Space Impact', 'space-impact', 'Biểu tượng game bắn phi thuyền không gian trên điện thoại đen trắng Nokia 3310 kinh điển. Bắn hạ người ngoài hành tinh và quái vật vũ trụ.', 'Nokia', 'Nokia', 2000, 'cat-shooter', 'ast-cov-space', 'PUBLISHED', 'PUBLIC', 'ADMIN', 'usr-admin-01', datetime('now'), datetime('now'), datetime('now'));

-- 5. Insert Game Versions
INSERT OR IGNORE INTO game_versions (id, game_id, version_name, jar_asset_id, jad_asset_id, jar_sha256, jad_sha256, file_size, status, created_at)
VALUES
  ('ver-ninja-100', 'gam-ninja', '1.0.0 (Bản Chuẩn 240x320)', 'ast-jar-ninja', NULL, 'f2ca1bb6c7e907d06dafe4687e579fce76b37e4e93b7605022da52e6ccc26fd2', NULL, 354890, 'ACTIVE', datetime('now')),
  ('ver-diamond-100', 'gam-diamond', '1.0.0 (Bản Tiếng Việt)', 'ast-jar-diamond', NULL, 'a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0', NULL, 421000, 'ACTIVE', datetime('now')),
  ('ver-bounce-100', 'gam-bounce', '1.0.0 (Bản Gốc Nokia)', 'ast-jar-bounce', NULL, 'b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef01', NULL, 298000, 'ACTIVE', datetime('now')),
  ('ver-avatar-250', 'gam-avatar', '2.5.0 (Bản Nông Trại Vui Vẻ)', 'ast-jar-avatar', NULL, 'c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef012', NULL, 512000, 'ACTIVE', datetime('now')),
  ('ver-asphalt-100', 'gam-asphalt', '1.0.0 (3D M3G Edition)', 'ast-jar-asphalt', NULL, 'd4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0123', NULL, 680000, 'ACTIVE', datetime('now')),
  ('ver-space-100', 'gam-space', '1.0.0 (Monochrome Edition)', 'ast-jar-space', NULL, 'e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef01234', NULL, 154000, 'ACTIVE', datetime('now'));

-- 6. Insert User Library item for test user
INSERT OR IGNORE INTO user_library (id, user_id, game_id, game_version_id, custom_asset_id, custom_name, source_type, created_at)
VALUES
  ('lib-item-01', 'usr-player-01', 'gam-ninja', 'ver-ninja-100', NULL, 'Ninja School 1', 'CATALOG', datetime('now')),
  ('lib-item-02', 'usr-player-01', 'gam-diamond', 'ver-diamond-100', NULL, 'Diamond Rush Tuổi Thơ', 'CATALOG', datetime('now'));

-- 7. Insert Initial Activity
INSERT OR IGNORE INTO user_game_activity (id, user_id, game_id, user_library_id, activity_type, last_played_at, play_count)
VALUES
  ('act-01', 'usr-player-01', 'gam-ninja', 'lib-item-01', 'PLAY', datetime('now'), 12),
  ('act-02', 'usr-player-01', 'gam-ninja', NULL, 'FAVORITE', datetime('now'), 1),
  ('act-03', 'usr-player-01', 'gam-diamond', 'lib-item-02', 'PLAY', datetime('now'), 8);
