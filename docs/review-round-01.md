# PM review round 01 — Bảo mật và tính đúng của dữ liệu

Trạng thái khởi tạo: giao Gemini triển khai, Codex review độc lập trước nghiệm thu.

## Quyền và phạm vi

Người dùng yêu cầu project manager kiểm tra và yêu cầu Gemini sửa lại đến khi hợp lý. Đọc `plan.md`, `AGENTS.md` và `docs/delivery-board.md`. Giữ lại công việc đang có; không reset, revert, commit hoặc thay đổi nhánh trong lượt này. Không tự mở rộng tính năng và không đánh dấu MVP hoàn thành.

Bạn là agent triển khai duy nhất trong lượt này. Codex và hai reviewer chỉ đọc source; Codex sở hữu `scripts/anty-bridge.ps1`, tài liệu điều phối/review và test xác minh riêng nếu được bổ sung. Không sửa các file coordinator sở hữu. Không tạo thêm agent sửa code.

Phạm vi được sửa:

- Asset delivery routes/service/repository/storage và truy vấn versions cần thiết trong `apps/api/src`.
- `apps/api/src/server.ts` để bỏ tái tạo JAR giả khi startup.
- `apps/web/src/pages/admin/user-imports.astro`, `apps/web/src/pages/admin/storage.astro` và helper render an toàn nhỏ nếu cần.
- Các test hồi quy API trong `tests/api.test.ts` hoặc test mới được runner hiện tại thực sự gọi; cấu hình runner tối thiểu nếu cần.
- `docs/anty-status.md` để bàn giao đúng kết quả.

Không sửa logic auth/session toàn hệ thống, schema, UI khác, emulator hoặc cài dependency ở round này. Nếu cần mở rộng phạm vi để bảo đảm đúng, nêu lý do cụ thể và dừng phần phụ thuộc để PM quyết định; vẫn hoàn tất phần độc lập.

## R01-A — Đóng lỗ hổng phát asset (S1)

Source hiện tại: `routes/upload.ts` đọc object qua `uploadService.getFile(key)` mà không kiểm tra metadata/quyền và cache public. Cả Workers, dev server và unified server dùng cùng route.

Contract bắt buộc:

1. Tra asset metadata trước mọi lần đọc storage; object mồ côi, ID/key không tồn tại hoặc không hợp lệ không được phát bytes.
2. Chỉ asset `ACTIVE` được phát qua route playback bình thường; UPLOADING/QUARANTINED/DELETED bị từ chối cho mọi người, kể cả admin tại route này.
3. Chỉ cho khách đọc asset có tham chiếu Catalog hợp lệ: game `PUBLISHED + PUBLIC`; JAR/JAD còn yêu cầu đúng version ACTIVE, đúng asset type và asset ACTIVE. Cover/screenshot cũng cần quan hệ Catalog hợp lệ. Không suy quyền từ prefix `games/`.
4. User import mặc định riêng tư. Chỉ chủ sở hữu hoặc admin được phép theo trạng thái tài khoản/quyền hiện hành đọc riêng tư. Không tin role cũ trong JWT để cấp quyền admin cho asset; tái kiểm tra user/role/status từ DB ở đường cấp quyền này nếu middleware chưa làm. Chưa có luồng phê duyệt quyền phân phối thì tham chiếu Catalog không được làm công khai một import của user thường.
5. Denial phải diễn ra trước đọc object, không lộ private size/Content-Range/storage key qua lỗi. Dùng `Cache-Control: private, no-store` hoặc chặt hơn cho mọi denial và response riêng tư. Có thể dùng no-store cho toàn route ở round đầu; chưa có chính sách invalidation thì không cache public game có thể bị hide.
6. GET, HEAD, request có Range phải cùng policy. Không đặt JWT đăng nhập vào URL, iframe hoặc postMessage. Không tạo cơ chế token mới phức tạp trong round này: parent/browser native có thể dùng request đã xác thực; khả năng truyền bytes vào emulator thuộc T07, phải ghi chưa kiểm chứng.
7. Không trả HTML/SVG chủ động ở same-origin như tài liệu có thể chạy script chỉ vì client tự nhận MIME: tài nguyên game là download/data. Thêm headers phù hợp theo loại asset và policy hiện có; không làm hỏng ảnh cover an toàn. Không xử lý JAR như mã server.

Range contract: hỗ trợ single bytes range đóng, mở và suffix; clamp end vượt EOF; range không thỏa trả 416 sau authorization; malformed/multiple range phải được xử lý nhất quán, không tạo NaN/Content-Range sai. HEAD không có body. Không đọc storage hoặc lộ tổng size khi user chưa được phép.

Local storage: từ chối key có traversal, drive/absolute path, separator không hợp lệ hoặc encoding dùng để alias key. Kiểm tra resolved path nằm trong baseDir. Không đổi key bằng cách xóa `..` rồi đọc một object khác. Không sửa hoặc xóa dữ liệu người dùng sẵn có để làm test pass.

## R01-B — Public versions và detail chỉ trả asset được xuất bản (S2)

- `GET /api/v1/games/:id/versions` phải kiểm tra game cha trước khi truy vấn/trả version. Game không tồn tại, DRAFT/HIDDEN/ARCHIVED hoặc PRIVATE trả 404, không lộ versions/URL.
- Public game chỉ trả version ACTIVE có JAR ACTIVE và JAD ACTIVE nếu version tham chiếu JAD; không phát link asset không hợp lệ. Kiểm tra cùng điều kiện ở public detail, không chỉ endpoint versions.
- Khi PUBLISHED chuyển HIDDEN hoặc asset ACTIVE chuyển QUARANTINED, request sau phải bị chặn và URL cũ không vượt policy.
- Admin preview là luồng riêng, không nới public API để test game draft.

## R01-C — Stored XSS trong Admin

`admin/user-imports.astro` ghép `custom_name`, filename, username/email, id/hash vào `innerHTML` và thuộc tính `data-name`; `admin/storage.astro` làm tương tự với asset metadata và URL. Đây là dữ liệu không đáng tin cậy.

- Dựng DOM bằng `createElement`/`textContent`, `dataset` và `addEventListener` hoặc component escape mặc định. Không ghép dữ liệu API vào HTML, event attribute hoặc JavaScript.
- URL link chỉ chấp nhận protocol/đích an toàn theo policy; không cho javascript:/data: hay HTML điều khiển attributes. Link `_blank` có rel phù hợp.
- Giữ chức năng và layout. Lỗi API không được hiển thị như danh sách rỗng thành công; thao tác xóa thất bại phải báo đúng, không giả đã xóa.
- Tên chứa `<img src=x onerror=...>`, dấu nháy và thẻ script phải hiển thị như text. Không coi test grep không còn `innerHTML` là bằng chứng DOM an toàn; PM sẽ xác minh riêng.

## R01-D — Không tái tạo game đã mất bằng JAR giả

`apps/api/src/server.ts` hiện tạo archive chỉ có manifest khi bất kỳ asset JAR nào trong DB thiếu file, gồm cả user import. Archive không có MIDlet class được khai báo và không khớp hash/size metadata.

- Bỏ toàn bộ việc tự tạo/thay thế JAR ở startup bình thường. Thiếu object thì báo không tìm thấy, không giả game có thể chơi.
- Fixture bytes chỉ được tạo trong test riêng. Không tải/rehost game hay sửa JAR người dùng để lấp dữ liệu.
- Không in password/token từ server startup log. Không thêm credential mặc định mới.
- Không đổi stack Cloudflare/Workers/D1/R2 thành Node production. Node unified server chỉ là adapter local đang có, không là bằng chứng production đã đạt plan.

## Kiểm thử bắt buộc

Tạo fixture riêng trong database/storage tạm, không dùng hoặc xóa uploads thật; không thực thi JAR.

- User A, user B, admin hiện hành, admin bị hạ quyền/blocked và khách.
- Private ACTIVE: owner được; user khác/khách bị chặn; admin hợp lệ theo policy; owner blocked bị chặn.
- Public ACTIVE đúng quan hệ được đọc; key dạng Catalog nhưng không có quan hệ không được public.
- Game draft/hidden/archived/private, version INACTIVE, JAR/JAD không ACTIVE, orphan/missing object đều không lộ bytes/URL theo contract.
- GET, HEAD, Range hợp lệ/không thỏa, suffix/open-ended/malformed/multiple; chính xác bytes/status/headers; spy xác nhận denial không đọc storage.
- Sau publish→hide hoặc ACTIVE→QUARANTINED, request URL đã có trước đó bị chặn.
- Key encoded, double encoded, traversal và path ngoài root bị từ chối, không alias sang file khác.
- Giữ 10 nhóm smoke test hiện tại chạy thật. Test mới phải được root `pnpm test` gọi; test thất bại phải trả non-zero, không bỏ assertions để lấy pass.

## Bàn giao

Chạy từng lệnh riêng: `pnpm test`, `pnpm lint`, `pnpm --filter @gametuoitho/api build`, `pnpm --filter @gametuoitho/web build`, `git diff --check`, `git status --short`.

Hai lỗi frontend đã biết ở `PlayGameClient.tsx` và `src/lib/api.ts` nằm ngoài scope round này: báo trung thực nếu lint còn lỗi, không tắt check hay thêm kiểu giả. Test/browser chưa chạy phải ghi rõ. API/build pass không chứng minh emulator chạy hoặc MVP hoàn tất.

Trong `docs/anty-status.md`, ghi issue đã sửa, file đã sửa, hành vi trước/sau, testcase thực sự chạy với exit code, phần chưa kiểm chứng và rủi ro còn lại. Sau đó dừng, chờ PM review. PM có thể trả lại các lỗi chưa đạt để sửa trong cùng round.
