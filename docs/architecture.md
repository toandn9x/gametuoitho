# Kiến Trúc Nền Tảng Game Tuổi Thơ (Architecture Design)

## 1. Nguyên Tắc Cốt Lõi
- **Một Game Catalog --- Một Backend --- Nhiều Client --- Emulator Độc Lập Theo Nền Tảng**.
- Hệ thống trung lập với emulator: Backend và Database không lưu cấu trúc phụ thuộc vào trình duyệt hay Web Player.
- Client chịu trách nhiệm lấy metadata và file JAR/JAD từ API để khởi chạy trên emulator tương ứng:
  - **Web Client (MVP)**: FreeJ2ME Web + CheerpJ 4.x (chạy trong sandbox iframe).
  - **Android APK (Giai đoạn 2)**: J2ME Loader fork hoặc native Kotlin + Jetpack Compose.
  - **iOS (Giai đoạn 3)**: iOS native runner hoặc Web Player wrapper.

---

## 2. Sơ Đồ Kiến Trúc

```mermaid
flowchart TB
    U[Người dùng Web / Mobile Browser]
    A[Quản trị viên (Admin Portal)]
    
    subgraph Frontend["Apps / Web (Astro + React + Tailwind)"]
        W[User Website & Catalog]
        AD[Admin Dashboard & Management]
        EMU[Sandboxed Web Emulator Iframe]
    end

    subgraph Backend["Apps / API (Hono + TypeScript)"]
        API[Hono REST API /api/v1]
        AUTH[Auth & JWT Service]
        GAME[Game Catalog Service]
        LIB[User Library & Import Service]
        UPLOAD[File Upload & Checksum Service]
    end

    subgraph Storage["Data and Asset Storage"]
        D1[(Cloudflare D1 / SQLite Database)]
        R2[(Tigris private / R2 / Local Storage)]
        CDN[Cloudflare CDN with Range Headers]
    end

    U --> W
    A --> AD
    W --> EMU
    W --> API
    AD --> API
    API --> AUTH
    API --> GAME
    API --> LIB
    API --> UPLOAD
    GAME --> D1
    LIB --> D1
    UPLOAD --> D1
    UPLOAD --> R2
    EMU -->|Range Request 206| CDN
    CDN --> R2
```

---

## 3. Cấu Trúc Định Tuyến & Giới Hạn Sandbox Hiện Tại
- Website người dùng: `/`
- Trang quản trị: `/admin` (kiểm tra `role = ADMIN` ở cả Client UI và Server Middleware)
- API endpoint: `/api/v1/*`
- Raw Asset Streaming: `/api/v1/assets/raw/:key` hỗ trợ tiêu đề `Range` (`Accept-Ranges: bytes`, `206 Partial Content`) phục vụ CheerpJ.
- Web Emulator iframe: Được nhúng qua thẻ `<iframe>` với các thuộc tính sandbox:
  `sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-forms"`
  Không bao giờ truyền Auth Token hay Admin Session Cookie vào context iframe.
  > [!NOTE]
  > **Giới hạn bảo mật (F3 - Người dùng đã tạm hoãn):** Trên thực tế, do emulator hiện chạy **cùng origin** với website chính, sự kết hợp giữa `allow-scripts` và `allow-same-origin` không thể cô lập hoàn toàn `localStorage`, IndexedDB hoặc cookie của site chính. Đây là hạn chế đã được ghi nhận trong Phase 0; việc tách sang origin/domain riêng biệt được hoãn lại theo lựa chọn của người dùng. Không coi cấu hình hiện tại là đã hoàn toàn an toàn về mặt cô lập origin.

## 4. Storage driver

Node local dùng SQLite và `LocalStorageDriver`; Worker production dùng D1 và `TigrisStorageDriver`. `storage/factory.ts` hỗ trợ Tigris và adapter R2 cho deployment có sẵn. Cấu hình và thao tác triển khai nằm trong [README](../README.md#cloudflare).

Tigris dùng HTTPS, SigV4 qua `aws4fetch`, path-style `/{bucket}/{key}` và region `auto`. PUT/GET giữ nguyên bytes và Content-Type; DELETE chỉ thành công khi dịch vụ xác nhận. LIST dùng ListObjectsV2 với `encoding-type=url`, đọc hết các trang và giữ continuation token dạng chuỗi.

Parser kiểm tra XML, cấm DTD/entity, kiểm tra key/size/date và từ chối token thiếu/lặp. Không coi response lỗi là storage trống để dọn file. Request có timeout 15 giây, không tự retry ghi/xóa, dùng `redirect: manual` và từ chối 3xx để không chuyển credentials sang nơi khác. Workers không hỗ trợ `redirect: error`.

URL asset luôn qua `/api/v1/assets/raw/{encoded-key}`; API kiểm tra metadata/quyền trong database trước khi đọc object. Không đưa key storage về browser hoặc lưu binary/Base64 vào database. Thay provider không tự chuyển object và metadata.
