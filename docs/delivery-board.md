# Bảng điều phối hoàn thành Web MVP

Ngày rà soát: 09/11/2026 (Asia/Saigon).

Nguồn yêu cầu: [plan.md](../plan.md) và [AGENTS.md](../AGENTS.md).

## 1. Phạm vi và người phụ trách

- Agent code/build: Antigravity CLI (`agy`), conversation `51cc8bdc-59b0-4855-bb5f-e6cca0b6e184`. Agent đã phản hồi xác nhận vai trò và nhận gói đầu tiên qua luồng CLI `--conversation`.
- Coordinator trong phiên chat này: lập backlog, giao việc, review, theo dõi bằng chứng nghiệm thu và tổng hợp kết quả. File do coordinator phụ trách: `docs/delivery-board.md`, `scripts/anty-bridge.ps1`.
- `backend_audit`: chỉ đọc Backend/Database, đối chiếu bảo mật và API với plan.
- `web_emulator_audit`: chỉ đọc Web/Admin/Emulator, đối chiếu chức năng và bằng chứng POC.

Hai agent audit đã hoàn tất rà soát chỉ đọc. Agent Antigravity đã nhận phần S5 của T01 và được giao triển khai qua CLI. Các gói còn lại giữ TODO cho đến khi được giao và xác nhận riêng.

Trong khi chưa thống nhất lại ownership, coordinator và các agent audit không sửa source, migration, package/lockfile; không chạy build, cài dependency hoặc khởi động server song song với agent code/build. Nếu bổ sung agent triển khai, phải chia thư mục/file cụ thể trước; các file dùng chung chỉ có một người sửa mỗi lượt.

## 2. Trạng thái ban đầu

Đây là kết quả đọc nguồn, không phải kết quả chạy test/build. Repo đang được agent khác cập nhật nên cần kiểm tra lại những nhận xét này trước mỗi lượt sửa. Chưa nghiệm thu phase nào chỉ dựa vào việc có file hoặc tài liệu.

| Phase theo plan | Quan sát tại thời điểm rà soát | Bằng chứng/việc cần xác minh |
| --- | --- | --- |
| 0 — Emulator POC | Có upstream emulator và báo cáo lựa chọn; chưa đủ bằng chứng nghiệm thu | Báo cáo có 7 dòng game, chưa đủ ít nhất 10 game; thiếu phiên bản JAR/emulator, browser/device và log kết quả. |
| 1 — Nền tảng | Có workspace, cấu hình Web/API, D1/R2 và migration; chưa nghiệm thu môi trường | Lint đang là `echo ok`; API test có nhánh che lỗi; chưa thấy workflow CI. Cấu hình production còn giá trị mẫu và secret khai báo trực tiếp. |
| 2 — Backend Core | Có nhiều route/service/repository, schema và test nguồn; còn các lỗi quyền truy cập | Xem danh sách P0 bên dưới. Chưa chạy test hoặc chứng minh tương thích Workers/D1/R2. |
| 3 — Web | Chưa thấy source các trang | `apps/web` hiện có package/config và dependencies, chưa thấy `src`. |
| 4 — Admin | Chưa thấy source giao diện | Chưa có pages/layout/features Admin trong Web. |
| 5 — Player | Có thành phần upstream; chưa thấy adapter và host integration | Interface mới nằm trong tài liệu. Cần chứng minh tải JAR/JAD từ URL API và chơi game import riêng tư. |
| 6 — Kiểm thử/tối ưu | Chưa đủ bằng chứng | Có `tests/api.test.ts`, nhưng chưa có báo cáo lần chạy hay coverage nghiệm thu. |
| 7 — Production | Chưa có bằng chứng triển khai | Cần staging/production, domain, secrets, migration, smoke test, logs và quy trình backup/restore. |

Trong khi thiết lập liên lạc, agent đã bổ sung `apps/web/src`, `public`, cấu hình Tailwind, build output và các tài liệu architecture/database/deployment/security. Các hàng phía trên lưu ảnh chụp rà soát ban đầu; chưa nghiệm thu các phần bổ sung này hoặc coi build output là bằng chứng chức năng.

Không mở rộng Android/iOS trước khi Web MVP đạt tiêu chí tại mục 12 và 16 của plan.

## 3. Những vấn đề P0 đã thấy trong source

| ID | Vấn đề cần xử lý | Vị trí quan sát | Tiêu chí xác nhận đã sửa |
| --- | --- | --- | --- |
| S1 | Đường tải asset nhận storage key và đọc object mà chưa kiểm tra metadata/quyền; response đặt cache public | `apps/api/src/routes/upload.ts:59`, `apps/api/src/services/uploadService.ts:83` | User A đọc được import của mình; user B và khách bị từ chối kể cả khi biết URL/key. Asset private, quarantine/deleted và game chưa công khai không bị phát như nội dung public. Kiểm tra cả GET/HEAD/Range và cache. |
| S2 | Public versions API chưa kiểm tra game cha có `PUBLISHED + PUBLIC` | `apps/api/src/services/gameService.ts:65` | Draft/hidden/archived/private không lộ versions hoặc URL file ở endpoint public; public game hợp lệ vẫn hoạt động. |
| S3 | Middleware dựng trạng thái ACTIVE từ JWT; logout chỉ trả thành công | `apps/api/src/middleware/auth.ts:24`, `apps/api/src/routes/auth.ts:79` | User bị block, bị đổi role hoặc session bị revoke không tiếp tục dùng quyền cũ. Logout vô hiệu hóa phiên theo cơ chế đã chọn. Production không có secret mặc định. |
| S4 | Validation upload hiện chưa đáp ứng kiểm tra archive/JAD và quota theo plan | `packages/shared-utils/src/index.ts:185`, `apps/api/src/services/uploadService.ts:21` | Có test file sai nội dung/MIME, archive lỗi, traversal/ZIP bomb, quá dung lượng/quota, trạng thái lỗi và dọn file thất bại. Không thực thi JAR trên server. |
| S5 | Script có thể che lỗi test, lint chưa thực sự kiểm tra | `apps/api/package.json:8`, `apps/api/package.json:9`, `apps/web/package.json:9` | Root test gọi đúng test và trả mã lỗi khi assertion thất bại; lint kiểm tra thật; CI thất bại khi check thất bại. |
| S6 | Library/activity chưa kiểm tra đầy đủ tài nguyên đích và quyền sở hữu; history có thể join thư viện của user khác | `apps/api/src/services/libraryService.ts:32`, `apps/api/src/services/libraryService.ts:92`, `apps/api/src/repositories/libraryRepository.ts:110` | User A không ghi activity tham chiếu library của B và không đọc được tên riêng của B qua history. Catalog entry chỉ nhận game được phép truy cập, version phải thuộc game; IMPORT không đồng thời chứa version Catalog. |
| S7 | Create/update game có thể đặt PUBLISHED bỏ qua publish guard; addVersion mới kiểm tra asset tồn tại | `apps/api/src/services/adminService.ts:68`, `apps/api/src/services/adminService.ts:90`, `apps/api/src/services/adminService.ts:123` | Mọi đường publish dùng cùng policy. Version chỉ nhận asset đúng loại, ACTIVE và được phép sử dụng; không đưa private import vào Catalog nếu chưa đáp ứng đồng ý/quyền phân phối theo plan. |
| E1 | README mô tả `jar=URL_TO_JAR`, runner lại ghép tham số vào đường dẫn `/jar/` nội bộ | `apps/emulator-web/README.md:13`, `apps/emulator-web/src/main.js:356` | Chạy được JAR qua URL do API cấp, JAD nếu có, và file local; có log lỗi tải/timeout rõ ràng. |

Các vị trí dòng chỉ áp dụng cho ảnh chụp source lúc rà soát. Không ghi giá trị password, token hoặc secret vào báo cáo.

### Review đợt S5

Agent đã bàn giao thay đổi tại [anty-status.md](anty-status.md). Coordinator đã đọc scripts/config/test runner và chạy lại độc lập:

- `pnpm test`: exit **0**, chạy 10 nhóm smoke test API.
- `pnpm lint`: exit **1**, trả lỗi thực tế từ Web: prop `game` không thuộc `EmulatorPlayerProps` tại `apps/web/src/components/PlayGameClient.tsx:111`; hai tham chiếu `process` chưa có kiểu tại `apps/web/src/lib/api.ts:6`.
- Đã xác minh đường dẫn cleanup test nằm trong workspace trước khi chạy. Runner gọi test nguồn qua `tsx`, không còn nhánh `|| echo` che lỗi; catch của test trả exit 1.
- Agent báo API build và Web build exit 0; coordinator không chạy lặp build trong lượt review này.

**Kết luận:** chấp nhận phần sửa test runner và thay placeholder bằng kiểm tra TypeScript. Chưa nghiệm thu toàn bộ S5/T01: cần xử lý hai vấn đề frontend, bổ sung CI và các phần nền tảng còn lại. `lint` hiện là `tsc --noEmit`, kiểm tra TS/TSX; chưa phải kiểm tra đầy đủ template `.astro`, style hoặc format. Chưa nghiệm thu các lỗi bảo mật S1–S4/S6–S7 từ bộ smoke test này.

## 4. Các gói việc triển khai

Trạng thái: **T01/S5 — phần scripts đã REVIEWED; T01 còn IN_PROGRESS**, các gói khác **TODO**. Đợt đầu chỉ sửa độ tin cậy của test/lint; các yêu cầu môi trường/CI còn lại của T01 chưa được nghiệm thu. Coordinator chỉ đổi sang DONE sau khi đã xem thay đổi và bằng chứng kiểm tra. Code đang tồn tại được review và sửa tại chỗ khi phù hợp, không yêu cầu viết lại toàn bộ.

| Gói | Phạm vi file chính | Công việc và điều kiện nghiệm thu | Phụ thuộc |
| --- | --- | --- | --- |
| T00 — POC emulator | `apps/emulator-web/**`, `docs/emulator-integration.md` | Xử lý E1; chứng minh URL/local loading, audio/keypad/fullscreen/RMS và ít nhất 10 game đại diện. Ghi JAR version/hash, emulator revision, browser/device, kết quả, lỗi và bằng chứng. Kiểm tra license/dependency thực tế; thiếu điều kiện thử phải ghi chưa kiểm chứng. | Bộ game có quyền sử dụng và môi trường browser; phải đạt gate Phase 0 trước tích hợp chính thức. |
| T01 — Check và nền tảng | Root/package scripts, config TS, `.github/workflows/**`, config môi trường | Xử lý S5; lint/typecheck/test chạy thật, báo lỗi đúng; CI tái lập được. Tách secret khỏi config version control; chứng minh dev/staging và Worker/D1/R2 chạy được, không chỉ Node/SQLite local. | Có thể sửa lỗi nền tảng hiện tại trong khi hoàn tất bằng chứng T00. |
| T02 — Phân quyền và phát asset | Auth middleware/service/routes, game service/repository, asset delivery/storage, test tương ứng | Xử lý S1–S3. Đặt policy rõ cho public/private và URL asset riêng tư. Không truyền JWT đăng nhập vào emulator. Bổ sung regression test khách, user A/B, admin, user blocked và session revoked; kiểm tra mọi đường lấy URL/file. | T01 để kết quả test có ý nghĩa. |
| T03 — Upload/import an toàn | Upload routes/service/storage, validator, asset repository, upload jobs, test | Xử lý S4; xác minh dữ liệu từ storage thay vì tin client. Quota/rate limit, trạng thái upload/quarantine, chống ghi đè, cleanup có kiểm soát; chọn và tài liệu hóa cơ chế upload R2 phù hợp. Test lỗi giữa upload, DB và storage. | T02; dùng migration mới nếu cần thay đổi schema đã áp dụng. |
| T04 — Hoàn thiện Backend nghiệp vụ | API contracts/types, repositories/services/routes, migrations, test, tài liệu API | Ưu tiên S6–S7. Đối chiếu toàn bộ mục 5 của plan; hoàn thiện Catalog/category/version, library/import/favorite/history, Admin và audit log. Bổ sung JAD import và các endpoint xóa import/favorite, lấy Admin categories, xóa asset còn thiếu. Test source exclusivity, ownership, version thuộc đúng game, thêm trùng và xóa asset đang được tham chiếu. Dữ liệu mẫu tách production, admin đầu tiên được tạo an toàn. | T02–T03; chốt contract trước các màn hình phụ thuộc. |
| T05 — Web người dùng | Public/auth/library pages, shared layouts/components, API client trong `apps/web` | Duyệt/tìm/lọc/phân trang/chi tiết, đăng ký/đăng nhập, library/import/xóa. Dữ liệu game từ `/api/v1/*`; responsive, SEO phù hợp, loading/empty/error. Không dùng dữ liệu giả để nghiệm thu luồng thật. | T04 cho từng contract sử dụng. |
| T06 — Admin | `apps/web/src/pages/admin/**`, `features/admin/**`, Admin layout | Upload → draft → test → publish/hide; metadata, versions, categories, cover/screenshot, imports/assets. Layout riêng; server kiểm tra role; upload không tự publish; private import không tự chuyển public. | T04; T05 cung cấp UI/API client dùng chung nếu cần. |
| T07 — Adapter và Player | `apps/web/src/features/player/**`, player pages, cầu nối trong emulator | Adapter/iframe sandbox; kiểm tra origin, source và schema message. Ready/error/exit, timeout/retry, keyboard/keypad, fullscreen/audio, cleanup, history. Tính năng chưa hỗ trợ trả `NOT_SUPPORTED`. Chơi được catalog và private import mà không đưa JWT vào iframe. | T00 đạt gate, T02 asset access, T04 và các trang liên quan. |
| T08 — Kiểm thử và production | Acceptance/security tests, deploy/monitor config, tài liệu vận hành | Hoàn tất mục 12 và 16 của plan bằng bằng chứng thực tế. Browser/mobile compatibility, cache/Range/CDN, upload limits, migration, smoke test staging/production, logs không lộ bí mật, backup và restore được kiểm chứng. Ghi rõ giới hạn tương thích. | T00–T07; cần tài khoản/hạ tầng và cấu hình triển khai thực tế. |

Thứ tự ưu tiên hiện tại: đóng các lỗi S1–S7, chứng minh T00, rồi nghiệm thu từng phần Backend/Web/Admin/Player theo phụ thuộc. Chưa coi các phase sau là hoàn tất khi gate POC hoặc yêu cầu bảo mật còn thiếu bằng chứng.

## 5. Cách giao và báo cáo mỗi lượt

1. Agent code/build đọc `plan.md`, `AGENTS.md` và bảng này; báo gói đang làm cùng phạm vi file để tránh trùng việc đang chạy.
2. Mỗi lượt nhận một gói hoặc một phần rõ ràng; nêu acceptance cases trước khi sửa. Thay đổi contract, migration hoặc quyết định kiến trúc phải được chỉ rõ.
3. Agent triển khai và chạy check phù hợp; lưu lệnh, exit code, kết quả thực tế và giới hạn. Không tính placeholder, `echo ok` hay tài liệu tự tuyên bố là bằng chứng.
4. Coordinator đọc thay đổi, đối chiếu test và acceptance; có lỗi thì trả lại task cụ thể. Khi có quyền/môi trường, chạy xác minh độc lập phù hợp.
5. Báo cáo theo mẫu mục 14.1 của plan trước khi nghiệm thu phase. Chuyển phase có rủi ro lớn theo yêu cầu xác nhận của plan; chuẩn bị đầy đủ kết quả để review trước bước đó.

Mẫu bàn giao:

```text
Gói/Phase:
Đã hoàn thành:
File đã tạo/sửa:
Database migration:
API/contract đã thay đổi:
Test/check (lệnh, exit code, kết quả):
Acceptance đã chứng minh:
Vấn đề còn tồn tại:
Rủi ro:
Việc tiếp theo:
```

## 6. Kênh trao đổi trực tiếp

- CLI thực tế trên máy là `agy.exe`. Script điều phối: [scripts/anty-bridge.ps1](../scripts/anty-bridge.ps1).
- `agentapi send-message` đã bị RPC từ chối vì source project `default-cli-project` và target project rỗng không khớp. Không sửa project ID, database phiên hoặc kiểm tra quyền để vượt ranh giới này.
- Luồng CLI được hỗ trợ `--conversation <id> --print <prompt>` đã trả phản hồi xác nhận từ đúng conversation đích. Coordinator dùng luồng này cho lượt giao việc, giữ nguyên project/permission checks của CLI.
- Agent được yêu cầu duy trì `docs/anty-status.md`: phạm vi file, task đang làm, lệnh kiểm tra, exit code, kết quả và blocker. File này thuộc agent code/build; coordinator cập nhật bảng này sau review.
- Mỗi lượt chỉ giao một gói hữu hạn và chờ kết quả; không khởi chạy nhiều lượt triển khai song song vào cùng conversation. Không coi việc tiến trình đã chạy là bằng chứng task đã xong.

Các lệnh trên máy hiện tại:

```powershell
# Hỏi/xác nhận phạm vi, chỉ đọc và phản hồi
powershell.exe -NoProfile -File scripts/anty-bridge.ps1 -DirectConversation

# Đợt S5 đã được giao: sửa scripts/checks và báo cáo, không sửa logic ứng dụng
powershell.exe -NoProfile -File scripts/anty-bridge.ps1 -ExecuteFirstBatch
```

Không chạy lại lệnh triển khai khi lượt trước còn đang chạy. Chế độ `-ExecuteFirstBatch` dùng quyền sửa file theo phiên và allowlist các lệnh kiểm tra cụ thể; không cài dependency, không thay cấu hình quyền toàn cục, không dùng cờ bỏ qua toàn bộ quyền. S1/S2 chờ coordinator review kết quả S5 trước khi giao lượt tiếp theo.

## 7. Nhật ký điều phối

- 09/11/2026: Người dùng xác nhận agent ở phiên khác giữ code/build. Hai agent phụ trong phiên coordinator nhận rà soát chỉ đọc Backend và Web/Emulator. Coordinator lập backlog và đề bài bàn giao; chưa chạy build/test, chưa nghiệm thu phase và chưa trực tiếp chuyển lệnh cho agent ở phiên khác.
- Hai agent audit đã hoàn tất báo cáo. Coordinator đối chiếu lại các lỗi S1–S3, S5–S7 và E1 với source; bổ sung các gói việc và acceptance vào bảng. S4 được xác định bằng rà soát tĩnh validator/upload, chưa có thử nghiệm file độc hại hay load test.
- Coordinator tìm được CLI, xác minh conversation của workspace và nhận phản hồi handshake: agent giữ source/build, nhận T01/S5 rồi tới S1/S2. Lệnh triển khai phần S5 đã được gửi; kết quả chưa được nghiệm thu.
- Agent bàn giao phần scripts S5 và tạo `docs/anty-status.md`. Coordinator chạy lại `pnpm test` (exit 0, 10 nhóm), `pnpm lint` (exit 1, hai vấn đề frontend) và chấp nhận phần sửa runner/typecheck. T01 còn việc, S1/S2 đã được thống nhất là gói bảo mật tiếp theo nhưng chưa có kết quả triển khai/nghiệm thu trong lượt này.
