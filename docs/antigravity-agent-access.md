# Tiếp tục làm việc với agent Antigravity của dự án

Đã kiểm chứng trên máy này ngày **09/11/2026**. Tài liệu ghi lại cách đã dùng thành công để phiên sau tiếp tục ngay, không phải dò lại tiến trình/CLI.

## 1. Thông tin cần giữ

| Mục | Giá trị đã dùng |
| --- | --- |
| Workspace | `D:\Link tink\gametuoitho` |
| Tên CLI thực tế | `agy.exe` — không phải lệnh `anty` |
| Binary script sử dụng | `%USERPROFILE%\.gemini\bin\agy.exe` |
| Binary cài đặt khác đã thấy | `%USERPROFILE%\AppData\Local\agy\bin\agy.exe` |
| Conversation agent code/build | `51cc8bdc-59b0-4855-bb5f-e6cca0b6e184` |
| Script điều phối | [scripts/anty-bridge.ps1](../scripts/anty-bridge.ps1) |
| Kế hoạch và quy tắc | [plan.md](../plan.md), [AGENTS.md](../AGENTS.md) |
| Tiến độ do PM quản lý | [delivery-board.md](delivery-board.md) |
| Bàn giao của Gemini | [anty-status.md](anty-status.md) |

Script mở một lượt **headless vào conversation ID đã có** bằng `--conversation ... --print ...`. Đây là luồng CLI đã trả phản hồi đúng conversation và đã thực hiện đợt sửa test/typecheck; không phải gửi phím vào terminal đang mở.

CLI tự dùng hồ sơ đăng nhập hiện có. Không ghi access token, CSRF token, password hoặc nội dung credential vào tài liệu, task hay Git.

## 2. Bắt đầu lại ở phiên sau

Đọc file này và `docs/delivery-board.md` trước. Kiểm tra có lượt triển khai nào còn đang chạy; mỗi lượt chỉ giao một packet hữu hạn và chờ bàn giao, tránh sửa chồng cùng file.

```powershell
Set-Location -LiteralPath 'D:\Link tink\gametuoitho'

# Kiểm tra CLI và script; chưa gửi task
Test-Path -LiteralPath "$env:USERPROFILE\.gemini\bin\agy.exe"
Test-Path -LiteralPath 'scripts\anty-bridge.ps1'

# Hỏi lại agent về phạm vi và tình trạng; lượt này chỉ đọc và phản hồi
powershell.exe -NoProfile -File scripts\anty-bridge.ps1 -DirectConversation
```

Đọc JSON trả về, đặc biệt `conversation_id`, `status`, `response` và `denied_actions`. ID phải khớp bảng trên. Script báo lỗi khi CLI trả sai conversation, có thao tác bị từ chối hoặc không nhận được kết quả cuối.

`status: SUCCESS` chỉ xác nhận lượt CLI kết thúc thành công. PM vẫn phải đọc thay đổi và xác minh test trước khi nghiệm thu task hoặc phase.

Lượt hỏi trạng thái có timeout khoảng 120 giây. Lượt triển khai packet được chờ đến khi xong; không tự dừng agent giữa lúc đang sửa file.

## 3. Giao việc và yêu cầu sửa lại

Tạo packet dưới `docs/`, dùng tên đúng định dạng mà script chấp nhận:

- `review-round-02.md`: một đợt mới.
- `review-round-01-fix-01.md`: trả lại lỗi của đợt 01 để sửa tiếp.

Packet cần ghi rõ vấn đề, bằng chứng `file:line`, hành vi đúng, file được sửa, file thuộc người khác, test cần chạy và điều kiện nghiệm thu. Yêu cầu giữ nguyên các thay đổi không liên quan, không commit/reset, không tự đổi stack hoặc mở rộng tính năng.

Ví dụ packet đã có: [review-round-01.md](review-round-01.md). **Đọc trạng thái hiện tại trước khi chạy lại; đây là ví dụ lệnh, không phải yêu cầu chạy lặp một task đang làm.**

```powershell
powershell.exe -NoProfile -File scripts\anty-bridge.ps1 -TaskFile docs\review-round-01.md
```

Khi cần review lại bản sửa, tạo file `review-round-01-fix-01.md` rồi dùng cùng lệnh với đường dẫn file đó. Không cần dựng agent mới hoặc tìm conversation khác.

`-TaskFile` chỉ nhận file `review-round-NN.md` hoặc `review-round-NN-fix-NN.md` nằm trong thư mục `docs` của repo này. Nó đọc packet rồi giao vào conversation trên, ở mode `accept-edits` với quyền kiểm tra theo phiên.

Các lệnh shell được allowlist hiện tại:

```text
pnpm test
pnpm lint
pnpm --filter @gametuoitho/api build
pnpm --filter @gametuoitho/web build
pnpm --filter @gametuoitho/api exec tsx ../../tests/pm/asset-review.ts
node tests/pm/admin-render-review.cjs
git diff --check
git status --short
```

Agent phải chạy từng lệnh riêng. Quyền chỉ áp dụng cho lượt CLI, không sửa cấu hình quyền toàn cục và không dùng `--dangerously-skip-permissions`. Nếu thực sự cần thêm lệnh, PM review và thêm đúng lệnh hữu hạn; không mở `command(*)` để cho task chạy qua.

`-ExecuteFirstBatch` là lệnh cũ dành riêng cho đợt T01/S5 sửa runner/typecheck. Đợt đó đã có bàn giao; **không dùng flag này để giao công việc mới**. Dùng packet mới với `-TaskFile`.

## 4. Review độc lập sau bàn giao

Gemini ghi kết quả vào `docs/anty-status.md`; PM đọc source/diff và đối chiếu contract. Bản sửa chưa đạt phải trả lại bằng packet `fix`, kèm trường hợp thất bại cụ thể, rồi chạy lại cùng các kỳ vọng kiểm thử.

Các bộ QA do reviewer của PM viết, tách khỏi source và test Gemini sửa:

```powershell
# Quyền phát asset, trạng thái game/version, HEAD/Range/cache
pnpm --filter @gametuoitho/api exec tsx ../../tests/pm/asset-review.ts

# DOM của Admin bằng browser headless riêng; API được thay bằng fixture
node tests/pm/admin-render-review.cjs
```

Giới hạn và cách chạy bộ API nằm tại [tests/pm/README.md](../tests/pm/README.md). Bộ browser chạy client script thật và helper thật với dữ liệu thử; không chứng minh đầy đủ toàn bộ trang build, API thật hoặc emulator. Không sửa kỳ vọng test chỉ để lấy pass.

PM sở hữu tài liệu điều phối/review, script bridge và các file QA đã phân công; Gemini sở hữu các file ứng dụng trong packet. Không chạy hai lượt triển khai cùng lúc vào cùng conversation. Không xóa lock, dừng tiến trình khác hoặc sửa database phiên để ép tiếp tục.

## 5. Những lỗi đã gặp và cách xử lý

| Hiện tượng | Cách xử lý đã xác định |
| --- | --- |
| Không tìm thấy `anty` trên PATH | Dùng script; binary thực tế là `agy.exe` tại đường dẫn trong mục 1. |
| `ANTIGRAVITY_LS_ADDRESS is not set` khi chạy `agentapi` trực tiếp | Không cần tự lấy địa chỉ/token runtime. Dùng luồng `--conversation` qua script. |
| `agentapi send-message` bị `PermissionDenied` vì source project `default-cli-project` khác target project rỗng | Luồng này đã thất bại trên conversation hiện có. Dùng user-turn resume chính thức của CLI; không sửa project ID/database hay vượt kiểm tra quyền. |
| Headless tự từ chối một lệnh vì không hỏi quyền được | Đọc `denied_actions`, ghi nhận phần chưa chạy; chỉ cấp đúng thao tác đã được người dùng cho phép qua allowlist theo phiên. Không coi exit 0 của CLI là task đã đạt. |
| PowerShell báo `unexpected argument` với prompt có dấu ngoặc kép hoặc `--print` thiếu argument | Dùng script hiện có. Nó escape tham số theo Windows native command-line; không tự ghép prompt lớn vào shell hay truyền `--print` trống. |
| Sandbox chặn log/hồ sơ CLI, tiến trình con hoặc Chrome headless | Trong Codex, chạy lại đúng lệnh cần thiết với `sandbox_permissions: require_escalated`, giải thích mục đích. Quyền nằm ngoài workspace phải được xử lý qua cơ chế phê duyệt, không dùng công cụ khác để né chặn. |
| Có nhiều tiến trình `agy` | Không chọn theo PID đầu tiên; trong máy có cả hub của workspace khác. Dùng conversation ID đã xác minh. Không in toàn bộ command line vì có thể chứa token nội bộ. |

Nếu conversation đã bị xóa hoặc đổi, dừng lượt triển khai và xác minh lại. File `%USERPROFILE%\.gemini\antigravity-cli\cache\last_conversations.json` có ánh xạ workspace sang conversation gần nhất để hỗ trợ tìm ứng viên; “gần nhất” có thể là phiên cầu nối, nên không tự coi là agent code/build. Ưu tiên ID đã lưu, kết quả handshake và phạm vi dự án thực tế. Không dump lịch sử hoặc credential của project khác.

## 6. Trạng thái nghiệm thu cần giữ

Người dùng đã chọn: **tiếp tục sửa hệ thống, giữ emulator ở trạng thái chưa nghiệm thu** cho tới khi có bộ game thật và bằng chứng kiểm thử theo plan. Không coi JAR fixture/manifest, bảng compatibility tự ghi hay một lần build thành công là bằng chứng chơi được game hoặc MVP hoàn tất.

Kết quả và task đang chạy luôn lấy từ `delivery-board.md` và `anty-status.md`; file hướng dẫn này chỉ ghi quy trình truy cập để tái sử dụng.
