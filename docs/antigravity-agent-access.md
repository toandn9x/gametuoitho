# Kết nối lại agent Antigravity

Tài liệu này giữ thông tin kết nối CLI đã dùng cho workspace. Setup/deploy và lệnh kiểm tra nằm trong [README](../README.md).

## Thông tin kết nối

| Mục | Giá trị |
| --- | --- |
| Workspace | `D:\Link tink\gametuoitho` |
| CLI | `%USERPROFILE%\.gemini\bin\agy.exe` |
| Conversation đã dùng | `51cc8bdc-59b0-4855-bb5f-e6cca0b6e184` |
| Helper | [scripts/anty-bridge.ps1](../scripts/anty-bridge.ps1) |
| Quy tắc và kế hoạch | [AGENTS.md](../AGENTS.md), [plan.md](../plan.md) |

Xác minh conversation còn tồn tại và phạm vi đang làm trước khi giao việc. Dùng yêu cầu hiện tại, working tree và phản hồi trực tiếp của agent để xác định trạng thái; không suy ra từ báo cáo lịch sử.

## Hỏi trạng thái

Tại gốc repo:

```powershell
powershell.exe -NoProfile -File scripts/anty-bridge.ps1 -DirectConversation
```

Chế độ này chỉ đọc và trả lời, không giao sửa code. Helper dùng luồng CLI chính thức `--conversation ... --print ...`, giữ kiểm tra project/permission của CLI. Đọc `conversation_id`, `status`, `response` và `denied_actions`; CLI thành công chưa chứng minh task hoặc phase đã đạt.

## Giao một task hữu hạn

Chỉ giao việc khi người dùng đã yêu cầu hoặc cho phép. Chốt phạm vi file để tránh hai lượt sửa chồng nhau.

Helper `-TaskFile` nhận packet trong `docs/` với tên `review-round-NN.md` hoặc `review-round-NN-fix-NN.md`. Tạo packet mới trước khi gọi; packet phải nêu vấn đề, hành vi mong đợi, phạm vi file, kiểm tra cần chạy và điều kiện hoàn tất.

```powershell
powershell.exe -NoProfile -File scripts/anty-bridge.ps1 -TaskFile docs/review-round-08.md
```

Đường dẫn trên minh họa packet cần tạo, không phải file có sẵn. Agent trả kết quả, lệnh, exit code và giới hạn trong phản hồi CLI. Sau khi xử lý task, bỏ packet tạm thay vì tạo thêm báo cáo Markdown trùng lặp.

Mỗi lượt chỉ giao một packet và chờ xong. `-ExecuteFirstBatch` dành cho task S5 cũ; không dùng để giao task mới. Không sửa kỳ vọng kiểm thử chỉ để lấy pass.

## Quyền và xử lý lỗi

- Helper chỉ cấp allowlist lệnh kiểm tra theo phiên. Không mở quyền toàn cục hoặc dùng cờ bỏ qua permission.
- Khi lệnh bị từ chối, đọc `denied_actions` và báo thao tác chưa chạy; không coi exit 0 là đã hoàn thành mọi bước.
- Nếu `agentapi send-message` báo sai project boundary, giữ nguyên project ID/database và dùng luồng CLI được hỗ trợ.
- Nếu conversation đã mất, xác minh lại trước khi gửi task; không tự chọn conversation gần nhất của project khác.
- Không xóa lock, dừng tiến trình của người khác hoặc in command line/token nội bộ.
- CLI dùng hồ sơ đăng nhập hiện có; không ghi access token, CSRF token hoặc mật khẩu vào packet hay Git.
- Sandbox cần cấp quyền ngoài workspace phải đi qua cơ chế phê duyệt của môi trường, không chạy vòng qua ranh giới quyền.

Các giới hạn emulator và kết quả đã kiểm chứng được tổng hợp tại [README](../README.md#verification); kiểm tra quyền sở hữu file thực tế trước mỗi lượt làm việc.
