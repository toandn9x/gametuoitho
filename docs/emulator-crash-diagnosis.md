# Chẩn đoán và sửa lỗi khởi động emulator — 09/11/2026

## Nguyên nhân đã tái hiện

Trên `/play/thachsanh`, JAR tải thành công nhưng trình duyệt báo:

```text
Problem with setCurrent(next)
java.lang.NullPointerException
    at pl.zb3.freej2me.bridge.graphics.CanvasGraphics.drawImage
    at javax.microedition.lcdui.List.renderScreen
    at javax.microedition.lcdui.Display.setCurrent
    ... MMidlet.<init>
```

FreeJ2ME tạo `ImageItem` khi game truyền mảng icon, kể cả phần tử null.
Renderer của `List` sau đó gọi `drawImage(null, ...)`. Menu khởi động của
Thạch Sanh dùng trường hợp này, dẫn tới màn hình trắng.

Java tự bắt lỗi trong `Display.setCurrent`, in stack ra console trình duyệt rồi
tiếp tục. Tương tự, `MobilePlatform.runJar` bắt exception, vẽ `Game crashed :(`
và không reject promise JavaScript. Vì vậy chỉ dùng `FreeJ2ME.main(...).catch(...)`
không phát hiện được những lỗi này. Backend không chạy game nên không tự nhận
exception Java của client.

## Thay đổi

- Vá đúng lớp `List` của emulator hiện có: bỏ qua icon null khi vẽ. Giữ source
  GPL, provenance và script tái build tại [patches](../apps/emulator-web/patches/README.md).
  So sánh archive xác nhận chỉ `javax/microedition/lcdui/List.class` thay đổi.
- Cài bộ thu console trước loader CheerpJ; nhận diện các marker lỗi Java bị bắt
  nội bộ, giữ nested stack tối đa 8000 ký tự và che thông tin credential phổ biến.
- Chuyển lỗi qua `EMULATOR_ERROR`; parent kiểm tra origin cùng đúng iframe,
  gửi game/version/stack tới `/api/v1/reports/crash` một lần mỗi lượt khởi động.
  Lỗi tải/khởi tạo cũng được báo cáo. Giao diện hiển thị gửi log thành công hay thất bại.
- Cache v2 tải mới bootstrap; bỏ qua API, JAR local, Range và request riêng tư.
  Chỉ dọn cache có prefix của emulator. Người đang mở bản cũ nên tải lại bằng
  `Ctrl+Shift+R` để nhận bản vá ngay.

## Bằng chứng kiểm tra

- Game/version: `28627096-f0fd-44f7-8275-6e5eea3ec8cc` /
  `daeee313-6aa6-43f6-bd3e-0bd7dc2954e5`.
- JAR game: 125361 byte, SHA-256
  `c3bdeede16ac6a34da71e66cee3333e35a254ffc16a3b9983516ae9c14d7f4aa`;
  file game không bị sửa. Chỉ thực thi game trong Chrome, không trên server.
- Chrome headless `156.0.8078.80`, CheerpJ 4.1, profile mới, bypass SW/HTTP cache.
  Sau sửa: menu đầu tiên hiển thị; phím Enter đưa tới menu game có đồ họa và
  màn hình tạo nhân vật. Sau khi nhập tên thử nghiệm và dùng F1 xác nhận, đã vào
  bản đồ chơi thực tế; canvas 240×320 có 125–126 màu lấy mẫu, nhận input bàn phím.
  Không còn NPE ở `List.renderScreen` hay báo cáo crash trong lượt sau sửa.
  [Ảnh màn chơi sau sửa](evidence/emulator/thachsanh-after-fix.png),
  [log trình duyệt](evidence/emulator/thachsanh-after-fix.json).
- Khi bắt đầu game mới, chính vòng lặp `h.run` của game còn in một dòng
  `Error at null: java.lang.NullPointerException`, tự bắt rồi tiếp tục tới bản đồ.
  Đây là log riêng trong game, chưa có stack chi tiết; không sửa binary game và
  không dùng kết quả này để khẳng định mọi tính năng hay mọi game đều tương thích.
- Trước khi thay JAR emulator, đã kiểm tra riêng đường báo lỗi mới bằng lỗi
  thật: POST trả HTTP 200; database có báo cáo `CRASH`, đúng version, stack 1166 ký tự.
  Có thể xem báo cáo trong `/admin/reports` với tài khoản Admin.
- `node tests/pm/emulator-crash-review.cjs`: 10/10 case đạt.
- `node tests/pm/emulator-cache-review.cjs`: 120/120 check đạt.
- `pnpm test`: 21 bộ đạt; `pnpm lint` và Web build đạt.

Chạy lại chẩn đoán:

```powershell
node scripts/diagnose-player.cjs --url http://127.0.0.1:4321/play/thachsanh --wait-ms 30000
```

Script dùng Chrome ẩn, profile riêng; in đường dẫn JSON log và screenshot tạm.
`--keys Enter,ArrowDown` có thể kiểm tra input, `--key-delay-ms` điều chỉnh nhịp phím.

Đây là bằng chứng cho lỗi khởi động đã sửa, chưa phải nghiệm thu toàn bộ emulator.
Gate nhiều game/thiết bị, âm thanh và RMS trong `plan.md` vẫn cần kiểm tra riêng.
