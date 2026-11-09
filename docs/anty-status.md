# Antigravity Status & Verification Report (T01 / S5)

**Thời gian:** 09/11/2026 (Asia/Saigon)  
**Phạm vi phụ trách:** Source code & build runner, test/lint harness, check configuration, `docs/anty-status.md`.  
*(Điều phối và delivery board do Codex phụ trách tại `docs/delivery-board.md`)*

---

## 1. Công việc đã thực hiện trong T01 / S5

1. **Loại bỏ cơ chế che lỗi (Failure Masking) trong Test Runner:**
   - Cập nhật [`apps/api/package.json`](file:///D:/Link%20tink/gametuoitho/apps/api/package.json) thay thế `node --test dist/**/*.test.js || echo 'Tests run with tsx/vitest'` bằng `tsx ../../tests/api.test.ts`.
   - Cập nhật [`tests/api.test.ts`](file:///D:/Link%20tink/gametuoitho/tests/api.test.ts) để đường dẫn test upload directory (`testUploadDir`) được xác định tuyệt đối qua `path.resolve(__dirname, '../uploads_test')` và bọc trong khối `try ... finally` để luôn dọn dẹp file tạm kể cả khi assertion thất bại.
   - Khi có bất kỳ assertion nào thất bại, `tests/api.test.ts` gọi `process.exit(1)`, trả mã lỗi non-zero và lan truyền trực tiếp lên `pnpm test`.

2. **Thay thế Placeholder Lint Scripts bằng kiểm tra thực tế:**
   - Thay thế toàn bộ `"lint": "echo ok"` bằng `"lint": "tsc --noEmit"` tại:
     - [`packages/api-contracts/package.json`](file:///D:/Link%20tink/gametuoitho/packages/api-contracts/package.json)
     - [`packages/shared-types/package.json`](file:///D:/Link%20tink/gametuoitho/packages/shared-types/package.json)
     - [`packages/shared-utils/package.json`](file:///D:/Link%20tink/gametuoitho/packages/shared-utils/package.json)
     - [`apps/api/package.json`](file:///D:/Link%20tink/gametuoitho/apps/api/package.json)
     - [`apps/web/package.json`](file:///D:/Link%20tink/gametuoitho/apps/web/package.json)
   - Bổ sung cấu hình tối thiểu [`apps/web/tsconfig.json`](file:///D:/Link%20tink/gametuoitho/apps/web/tsconfig.json) kế thừa root `tsconfig.json` và hỗ trợ React 19 JSX để `tsc` có thể phân tích cú pháp tĩnh thực tế trên frontend.

---

## 2. Kết quả kiểm tra xác minh thực tế

| Lệnh thực hiện | Exit Code | Kết quả thực tế & Ghi chú |
| --- | --- | --- |
| `pnpm test` | **0** | Thực thi trọn vẹn 10 bộ test tích hợp API (Health check, Public games list, Game detail slug, Categories, Auth register, Admin login, Admin stats, 403 Forbidden check, User library addition, History recording). Không còn che giấu hay nuốt lỗi. |
| `pnpm --filter @gametuoitho/api build` | **0** | `tsc --noEmit` hoàn tất không có lỗi trên toàn bộ API src. |
| `pnpm --filter @gametuoitho/web build` | **0** | `astro build` hoàn tất biên dịch 33 static pages và 57 modules client vite. |
| `pnpm lint` | **1** | **Báo cáo trung thực lỗi ứng dụng hiện có:** `packages/shared-types`, `packages/shared-utils`, `packages/api-contracts` vượt qua (exit 0). `apps/web` phát hiện 2 lỗi TypeScript thực tế trong code frontend hiện hữu:<br>1. `src/components/PlayGameClient.tsx(111,9)`: Lỗi TS2322 do truyền prop `game` vào component `<EmulatorPlayer />` trong khi interface `EmulatorPlayerProps` không định nghĩa prop này.<br>2. `src/lib/api.ts(6,5)`: Lỗi TS2580 do tham chiếu `process.env` mà chưa có type definition `@types/node` trong môi trường web/browser. |
| `git status --short` | **0** | Hiển thị các file đã sửa/tạo mới trong phạm vi T01 mà không làm gián đoạn các file frontend đang được phát triển song song. |
| `git diff --check` | **0** | Không có lỗi whitespace hoặc conflict markers. |

---

## 3. Danh sách các file sở hữu / chỉnh sửa trong đợt này

- [`apps/api/package.json`](file:///D:/Link%20tink/gametuoitho/apps/api/package.json) (sửa `test` và `lint` script)
- [`apps/web/package.json`](file:///D:/Link%20tink/gametuoitho/apps/web/package.json) (sửa `lint` script)
- [`apps/web/tsconfig.json`](file:///D:/Link%20tink/gametuoitho/apps/web/tsconfig.json) (tạo file cấu hình TS cho web)
- [`packages/api-contracts/package.json`](file:///D:/Link%20tink/gametuoitho/packages/api-contracts/package.json) (sửa `lint` script)
- [`packages/shared-types/package.json`](file:///D:/Link%20tink/gametuoitho/packages/shared-types/package.json) (sửa `lint` script)
- [`packages/shared-utils/package.json`](file:///D:/Link%20tink/gametuoitho/packages/shared-utils/package.json) (sửa `lint` script)
- [`tests/api.test.ts`](file:///D:/Link%20tink/gametuoitho/tests/api.test.ts) (chuẩn hóa đường dẫn test uploads và bọc try/finally)
- [`docs/anty-status.md`](file:///D:/Link%20tink/gametuoitho/docs/anty-status.md) (tài liệu trạng thái kỹ thuật)

*(Ghi chú: Không chạm vào logic nghiệp vụ backend, không sửa frontend components/pages, không sửa `docs/delivery-board.md` hoặc `scripts/anty-bridge.ps1`).*

---

## 4. Giới hạn & Vấn đề tồn tại (Limitations)

- Lỗi lint ở `apps/web` thuộc phạm vi code frontend hiện hữu (cần sửa `EmulatorPlayerProps` hoặc lời gọi component tại `PlayGameClient.tsx`, và chuẩn hóa biến môi trường `import.meta.env` thay vì `process.env` trong `apps/web/src/lib/api.ts`). Theo đúng yêu cầu đợt này không sửa frontend pages/business logic, lỗi này được giữ nguyên và báo cáo trung thực.
- Không cài đặt thêm dependency mới trong đợt này; toàn bộ test/lint dùng `tsx` và `typescript` đã có sẵn.

---

## 5. Đề xuất công việc tiếp theo (S1 & S2)

Sau khi Coordinator hoàn tất review nghiệm thu đợt T01/S5, sẵn sàng triển khai gói T02 xử lý **S1** và **S2**:
1. **S1 (Asset Delivery Authorization & Caching):**
   - Vị trí: `apps/api/src/routes/upload.ts` và `apps/api/src/services/uploadService.ts`.
   - Xử lý: Kiểm tra quyền sở hữu asset trước khi phát trực tiếp. Asset thuộc game private hoặc user import chỉ cấp quyền cho chính chủ (User A đọc được import của mình, User B và khách bị từ chối 403/404 kể cả khi có storage key). Loại bỏ header public cache trên các asset riêng tư.
2. **S2 (Public Game Versions Guard):**
   - Vị trí: `apps/api/src/services/gameService.ts`.
   - Xử lý: Endpoint lấy versions công khai (`GET /api/v1/games/:id/versions`) phải kiểm tra trạng thái game cha (`status === 'PUBLISHED' && visibility === 'PUBLIC'`). Game ẩn/draft/archived/private không được lộ danh sách phiên bản hay link tải JAR/JAD.
3. **Regression Tests:**
   - Bổ sung các case kiểm thử tự động vào test suite xác nhận chính xác hành vi từ chối khách/user khác và cho phép chính chủ.
