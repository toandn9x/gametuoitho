# Kế hoạch Game Tuổi Thơ: đóng Web MVP, phát triển Android APK

Cập nhật: **12/11/2026**.

| Hạng mục | Trạng thái |
| --- | --- |
| Kế hoạch xây dựng Web MVP cũ | **ĐÃ ĐÓNG** theo yêu cầu người dùng; chuyển sang bảo trì |
| Mốc mã nguồn web để đối chiếu | `2da7eee`; working tree sạch tại thời điểm lập kế hoạch |
| Kế hoạch Android APK | **ĐÃ LẬP KẾ HOẠCH — CHƯA TRIỂN KHAI** |
| Công việc tiếp theo | A0: chốt baseline, môi trường và ứng viên emulator |
| Phạm vi lần cập nhật này | Tài liệu; không build APK, sửa ứng dụng hay deploy |

## 1. Chốt kế hoạch web cũ

Web đã có catalog, tài khoản, thư viện/import riêng tư, yêu thích, lịch sử,
admin, player và quy trình deploy. Backend dùng Hono; local dùng SQLite và
thư mục uploads; production dùng Cloudflare Worker, D1 và Tigris.

Đợt sửa và kiểm tra trước khi đóng kế hoạch đã bao gồm:

- Lỗi save RMS của các game trùng tên; giữ bản save cũ khi xác định được JAR khớp.
- Dữ liệu tài khoản cũ ở header/thư viện/import; phản hồi cũ trả muộn.
- Xóa nhiều import liên tiếp; thông báo import thất bại.
- Hiển thị lỗi API, thử lại, bộ lọc và phân trang admin.
- `pnpm lint`, `pnpm cf:build`, `pnpm test`; luồng UI Chrome/WebKit.
- 11 ca RMS thực trên Chrome, 16 kịch bản player, kiểm tra input/cache/crash
  và Ninja School khởi động lại 6 lần với runtime local.

Đóng milestone phát triển không đồng nghĩa mọi game/thiết bị đều tương thích.
Không xác nhận các bản vá mới nhất đã được deploy chỉ dựa vào kết quả local.
Việc deploy/bảo trì web tiếp tục theo [README](README.md).

Các giới hạn giữ lại cho công việc riêng: emulator web cùng origin chưa cô lập
hoàn toàn; chưa đồng bộ save giữa thiết bị; save từng bị ghi đè không tự phục hồi;
WebKit test không thay thế kiểm thử toàn bộ thiết bị iPhone/Android thật.
Không đưa các việc này vào thay đổi bắt buộc của APK.

Bản kế hoạch web cũ được giữ trong lịch sử Git:
`git show 2da7eee:plan.md`. Tài liệu này thay thế danh sách phase/checklist web
mang tính dự kiến trước đây; không đánh dấu toàn bộ checklist cũ là đã nghiệm thu.

## 2. Mục tiêu và ranh giới APK

Tạo ứng dụng Android riêng trong cùng repo, cài bằng file `.apk`, tận dụng
catalog, định danh, hợp đồng API, quy tắc nghiệp vụ và thiết kế của web.
Ứng dụng có UI, emulator, dữ liệu cục bộ, build và phát hành riêng.

| Tái sử dụng | Phần Android phát triển riêng |
| --- | --- |
| Game ID, Version ID, Asset ID, SHA-256, trạng thái và quyền truy cập | Kotlin model/DTO theo hợp đồng hiện có |
| REST `/api/v1/*`, logic backend hiện có | API client cấu hình theo môi trường |
| Bố cục card, màu sắc, icon và cách điều khiển của web | UI native, touch/key mapping, vòng đời Android |
| Các ca kiểm thử và bài học RMS, đa điểm, xoay màn hình | Adapter emulator Android, kiểm thử trên thiết bị |
| Backend Hono và storage abstraction | Instance local/staging và cache riêng khi cần |

TypeScript trong `packages/` là nguồn tham chiếu hợp đồng; Kotlin không import
trực tiếp các package TypeScript. Không sao chép backend rồi phát triển lệch API.
Một catalog quản trị chính; cache/snapshot Android chỉ là bản đọc có nguồn gốc.

Các nguyên tắc `AGENTS.md` do người dùng cung cấp tiếp tục áp dụng: không viết emulator từ đầu;
không chạy game JAR trên server; không lưu binary/Base64 game trong database;
game import riêng tư; mọi API nhạy cảm kiểm tra JWT và quyền ở server.

## 3. Quy tắc không tăng tải website

**APK dùng chung API production sẽ tạo thêm tải lên Worker/D1/storage, dù UI
chạy native. Cache chỉ giảm tải; không thể cam kết tải bằng 0 khi vẫn gọi chung
hạ tầng.** Vì yêu cầu hiện tại là không tăng tải, chốt các chế độ sau:

| Chế độ | Nguồn dữ liệu | Kết nối hạ tầng web production |
| --- | --- | --- |
| APK MVP offline | JAR người dùng chọn, metadata/save/file trong thiết bị | **0 request**, không đồng bộ nền |
| Phát triển và test online | API local/staging, DB và storage kiểm thử riêng | **0 request**, không fallback production |
| Online khi phát hành | Chưa bật; cần thiết kế phục vụ riêng và đo tải | Chưa được coi là đáp ứng yêu cầu hiện tại |

- Bản APK đầu có thể cài, import và chơi offline; không cần tài khoản.
- Vẫn phát triển catalog, đăng nhập và thư viện theo API hiện có trên môi trường
  riêng. Chưa bật đăng nhập/sync trực tiếp với hệ thống web production.
- Nếu cần catalog online mà vẫn giữ tải web bằng 0: phục vụ từ tài nguyên riêng,
  dùng bản đọc catalog và bản sao asset công khai có nguồn gốc. Không dùng chung
  Worker/D1/bucket hoặc quota tài khoản đang phục vụ web rồi gọi đó là độc lập.
- Việc tạo/cập nhật bản đọc phải có nguồn và ngân sách riêng; không crawl/poll
  website, không mirror theo từng lượt mở app. Chưa có cơ chế xuất dữ liệu
  không ảnh hưởng web thì tiếp tục dùng fixture/import local.
- Không sao chép users, password hash, token hoặc file import riêng tư sang bản
  đọc catalog. Tài khoản/thư viện chung cần đánh giá riêng: dùng backend web để
  xác thực hoặc đồng bộ sẽ phát sinh tải, nên nằm ngoài cam kết tải bằng 0.
- Chưa triển khai thêm cloud, mirror hay dịch vụ tài khoản ở bước lập plan này.

UI đọc dữ liệu đã lưu trên máy qua repository; network là nguồn cập nhật có kiểm
soát. Đây là hướng [offline-first của Android](https://developer.android.com/topic/architecture/data-layer/offline-first).

## 4. Cấu trúc và cách bảo vệ bản web

Cấu trúc dự kiến, chưa tạo trong lần cập nhật này:

```text
apps/
  web/                    # Đang chạy, giữ nguyên
  api/                    # Backend chung, giữ hợp đồng hiện tại
  emulator-web/           # Runtime web, giữ nguyên
  android/                # Gradle project riêng
    app/                  # UI, điều hướng và cấu hình build
    core/                 # Model, repository, database/file local, API client
    emulator/             # Adapter và nguồn emulator được pin
    tests/                # Unit/instrumented test và fixture Android
```

- Làm trên nhánh riêng, commit theo phase. Lỗi web phát hiện trong lúc làm APK
  được ghi nhận thành việc bảo trì riêng; tránh sửa chồng cùng thay đổi Android.
- Phạm vi mặc định: `apps/android/**`, test/tài liệu Android và ignore build output.
- Không đổi `apps/web/**`, `apps/emulator-web/**`, entrypoint API, migration,
  `wrangler.toml`, `deploy.bat`, lệnh pnpm hay lockfile web để phục vụ APK.
- Nếu thiếu hợp đồng API, ghi rõ thiếu gì và kiểm tra fixture trước. Thay đổi
  shared/backend là việc riêng, phải tương thích ngược và qua test web trước khi dùng.
- Gradle chạy từ `apps/android`; build/deploy web không gọi Gradle hoặc SDK Android.
- Build APK không chạy `deploy.bat`, migration, seed, lệnh admin hoặc crawler.
- Không đưa APK vào `apps/web/public`. File phát hành nằm trong artifact Android,
  không khiến web build/deploy phải mang thêm binary.
- Local/staging dùng DB_PATH, UPLOADS_DIR, port và tài khoản test riêng; không dùng
  database/uploads đang chạy của người dùng hoặc bindings production.
- APK không chứa Cloudflare/Tigris key, JWT secret, keystore hay nội dung
  `.env.deploy.local`. Keystore release và cấu hình máy nằm ngoài Git.
- Trước khi tích hợp, đối chiếu diff với baseline web. Không có thay đổi runtime
  web/API ngoài phạm vi đã được tách riêng.

## 5. Hướng kỹ thuật và phạm vi phiên bản đầu

- Kotlin, UI Jetpack Compose; Room cho metadata; DataStore cho tùy chọn.
- File JAR/JAD, ảnh và save nằm trong app storage, không ghi binary vào Room.
- API client dùng Retrofit/OkHttp khi bật chế độ local/staging.
- Gradle Wrapper, JDK, AGP, Kotlin, SDK và ABI được chốt theo môi trường thực tế
  và emulator ở A0; pin phiên bản tương thích, không tự nâng toolchain web.
- [J2ME-Loader](https://github.com/nikita36078/J2ME-Loader) là ứng viên emulator,
  chưa phải quyết định đã tích hợp. Kiểm tra nguồn, dependency, LICENSE/NOTICE,
  cách build và các yêu cầu native; pin commit sau POC.
- Adapter tách thao tác load/start/pause/resume/stop, input và save khỏi UI/API.
  Không tự viết lại VM, không phụ thuộc player/CheerpJ của web.
- Chốt minSdk/targetSdk và thiết bị hỗ trợ sau khảo sát; không hứa tương thích
  chỉ dựa trên yêu cầu của upstream.

APK MVP gồm import local, danh sách game trên máy, chơi offline, lưu/mở lại save,
cấu hình phím/FPS, ngang/dọc và xóa game rõ ràng. Catalog/download/tài khoản được
kiểm thử trên local/staging; chế độ online production chưa bật.

Chưa gồm multiplayer/Bluetooth networking, iOS, tự đồng bộ RMS web–Android,
tự upload game local, admin native, quảng cáo, thanh toán hoặc phát hành store.

## 6. Các phase triển khai

Tất cả A0–A6 dưới đây **chưa bắt đầu**. Chỉ đánh dấu đạt khi có artifact và
kết quả kiểm tra; không dùng kết quả của web để thay cho test Android.

### A0 — Baseline và khảo sát

- [ ] Ghi baseline Git, phạm vi file được sửa, cấu hình môi trường riêng.
- [ ] Kiểm tra Android Studio/SDK/JDK/Gradle, dung lượng và thiết bị test hiện có.
- [ ] Khảo sát emulator, cách tích hợp, dependency và khả năng kiểm soát network.
- [ ] Chốt phiên bản toolchain, ABI, minSdk/targetSdk và adapter.
- [ ] Chốt cấu hình offline/local/staging; production mặc định không có endpoint.
- **Đầu ra:** quyết định kỹ thuật trong plan, nguồn/commit emulator và cách build.
- **Điều kiện đạt:** có phương án build độc lập, không cần sửa/deploy web.

### A1 — Khởi tạo APK độc lập

- [ ] Tạo `apps/android`, Gradle Wrapper và app shell, application ID riêng.
- [ ] Tách bản offline và bản dev local/staging; resource/icon/font đóng gói local.
- [ ] Bản offline không yêu cầu quyền INTERNET; kiểm tra manifest sau merge dependency.
- [ ] Bản dev chỉ cho phép môi trường test đã cấu hình, không fallback sang web.
- [ ] Build/cài debug APK và chạy unit test; xác nhận lệnh pnpm/deploy web không đổi.
- **Đầu ra:** APK shell cài được; chưa tuyên bố chạy được game.

### A2 — Emulator POC trước khi xây đủ UI

- [ ] Tích hợp engine qua adapter; JAR chỉ chạy trong Android/client.
- [ ] Import bằng system file picker, không yêu cầu truy cập toàn bộ bộ nhớ.
- [ ] Kiểm tra Ninja School 1/2/3 đúng phiên bản/hash và các game đại diện:
  game 2D, MIDI, ngang/dọc, đa phím, có RMS; 3D chỉ khi nằm trong phạm vi engine.
- [ ] Thử giữ/nhả phím, đa điểm, di chuyển ngón tay, hủy touch và focus.
- [ ] Thử Home/Back, khóa màn hình, nền/foreground, xoay màn hình, process bị hệ điều hành dừng.
- [ ] Dùng lại save khi mở lại; hai game trùng MIDlet-Name phải có save riêng.
- **Điều kiện đạt:** game thật chạy trên ít nhất một Android thật và Android
  Emulator; ghi thiết bị/API level, engine commit, JAR hash và lỗi còn lại.
  Nếu chưa đạt, tiếp tục POC; chưa mở rộng thành toàn bộ app.

### A3 — Thư viện offline và player native

- [ ] Card/icon gọn theo thiết kế web; danh sách, tìm kiếm, chi tiết đọc từ local repository.
- [ ] Import JAR/JAD có giới hạn kích thước, cấu trúc archive, path và SHA-256.
- [ ] Namespace save: nguồn catalog theo Version ID; import theo local UUID,
  tách profile/tài khoản khi có đăng nhập; không dùng riêng tên MIDlet.
- [ ] Tải/copy file qua file tạm, kiểm tra xong mới công nhận sẵn sàng.
- [ ] Xóa game và xóa save là lựa chọn rõ ràng; xóa cache không xóa RMS.
- [ ] Cấu hình phím/FPS, điều khiển hai bên, ngang/dọc; đổi bố cục không khởi động lại game.
- [ ] Đóng app, mở lại, khởi động lại máy vẫn đọc đúng thư viện/save trên máy.
- **Đầu ra:** APK offline dùng được mà không cần website, tài khoản hay mạng.

### A4 — Tận dụng API trên môi trường riêng

- [ ] DTO/contract test theo `packages/api-contracts`, `shared-types` và response thực.
- [ ] Catalog, lọc/tìm kiếm/phân trang, chi tiết và phiên bản qua `/api/v1/*`.
- [ ] Resolve URL asset tương đối theo API origin; không hardcode URL từng game.
- [ ] Download theo thao tác người dùng; kiểm tra size/hash, thiếu dung lượng,
  file lỗi, mất mạng và tải dang dở.
- [ ] Đăng nhập, thư viện, yêu thích và lịch sử với tài khoản test; backend hiện có
  tiếp tục kiểm tra quyền. Nhận 401 thì kết thúc phiên, không lặp đăng nhập tự động.
- [ ] Đổi tài khoản xóa trạng thái riêng tư khỏi UI/cache đang hoạt động; response
  và download cũ không ghi dữ liệu vào tài khoản mới.
- [ ] Game local vẫn riêng tư; upload là thao tác riêng của người dùng, không tự public.
- **Điều kiện đạt:** các luồng chạy qua API local/staging có dữ liệu riêng;
  chưa bật online của web production trong APK.

### A5 — Hồi quy, network và cách ly tải

- [ ] Unit/contract test: mapping, identity/save, file integrity, account isolation,
  callback cũ, retry, xóa song song và lỗi API.
- [ ] Instrumented test: input, audio, lifecycle, lưu/đọc RMS và permission.
- [ ] Chạy lại catalog/admin/auth/import/player web theo phạm vi diff; nếu có
  shared/backend thay đổi thì bắt buộc toàn bộ bộ test web liên quan.
- [ ] Đo network trên thiết bị trong các luồng cold start, browse, search, import,
  play, nền/foreground, tắt/mở mạng, logout và lỗi server.
- [ ] Test chặn mọi kết nối tới domain production; kiểm cả redirect, request của
  engine, ảnh/font, telemetry và tác vụ nền, không chỉ API client.
- [ ] Cài/nâng cấp APK không làm mất dữ liệu/save; app lỗi không sửa dữ liệu web.
- **Điều kiện đạt:** offline chơi được khi tắt mạng; số request tới hạ tầng web
  production **bằng 0**; diff web/deploy sạch; không phát sinh lỗi hồi quy đã biết.

### A6 — Build và bàn giao APK

- [ ] Build release offline, ký bằng keystore riêng được giữ ngoài Git.
- [ ] Kiểm tra manifest offline không có INTERNET, hash APK, versionCode/versionName.
- [ ] Cài mới và nâng cấp bản đã ký trên thiết bị thật; chạy lại smoke test game/save.
- [ ] Bàn giao file APK, SHA-256, cách cài/nâng cấp, phạm vi thiết bị/game đã test
  và giới hạn; cập nhật README với đúng lệnh build đã chạy được.
- [ ] Xác nhận không deploy web, không upload APK lên Worker và không đổi bindings.
- **Đầu ra:** APK có thể cài thủ công, phát triển/phát hành độc lập với web.
- **Online sau MVP:** chỉ đưa vào phase mới khi đã giải quyết nguồn phục vụ,
  dữ liệu tài khoản và phép đo tải; không tự bật endpoint production.

## 7. Ngân sách request cho API local/staging và online tương lai

Đây là mục tiêu thiết kế để kiểm thử, không phải khả năng sẵn có của backend.

| Tình huống | Nguyên tắc |
| --- | --- |
| Bản offline | 0 request, không lịch đồng bộ |
| Chơi lại game đã lưu | 0 lượt tải lại JAR; không gửi heartbeat trong lúc chơi |
| Duyệt catalog | 20 game/trang; không tải toàn bộ catalog hoặc preload JAR |
| Tìm kiếm | Debounce 400 ms; bỏ kết quả request cũ, không gửi khi chuỗi không đổi |
| Request song song | Tối đa 2 request metadata và 1 download; gộp request trùng |
| Cache metadata | Public catalog 15 phút, category 24 giờ; không refetch chỉ vì xoay/recompose |
| Refresh | Chủ động; không polling, không tự quét tất cả game lúc mở app |
| Retry | GET tối đa 1 lần tự thử lại với backoff; tôn trọng Retry-After |
| Ghi/xóa/upload | Không tự retry mù; không gửi trùng lịch sử khi xoay màn hình |
| 429/5xx/timeout | Dừng vòng lặp, hiện lỗi và dùng dữ liệu local phù hợp |

Các ngân sách này không biến việc gọi API web thành tải bằng 0. Không cache dữ
liệu riêng tư vào kho public; thông tin xác thực chỉ gửi tới origin API đã cấu hình,
không chuyển token theo redirect sang host khác.

## 8. Cách cập nhật kế hoạch

Sau mỗi phase, cập nhật ngay trong file này: trạng thái, file thay đổi, phiên bản
engine/toolchain, lệnh đã chạy, artifact, thiết bị/game/hash đã thử, kết quả,
giới hạn và bước tiếp theo. Không tạo chuỗi file Markdown test/review trùng lặp;
log, ảnh và APK nằm trong thư mục output được ignore.

Không cần chạy lại test ứng dụng chỉ vì sửa tài liệu. Khi bắt đầu viết code,
dùng baseline và kiểm tra phù hợp với phần thay đổi; không đánh dấu đạt bằng
fixture thay cho chạy game thật, hoặc tự triển khai cloud để hoàn thành phase.
