// Helper to convert ArrayBuffer to Hex string
export function bufferToHex(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Compute SHA-256 using standard WebCrypto (works in Cloudflare Workers and Node 18+)
export async function computeSha256(data: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  return bufferToHex(hashBuffer);
}

// UUID generator
export function generateId(): string {
  return crypto.randomUUID();
}

// Slugify function with Vietnamese accent stripping
export function slugify(text: string): string {
  return text
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

// Password hashing using PBKDF2 with WebCrypto
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const keyBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );

  const saltHex = bufferToHex(salt);
  const hashHex = bufferToHex(keyBits);
  return `${saltHex}:${hashHex}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [saltHex, expectedHashHex] = parts;

  // Convert hex salt back to Uint8Array
  const salt = new Uint8Array(
    saltHex.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || []
  );

  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const keyBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );

  const actualHashHex = bufferToHex(keyBits);
  return actualHashHex === expectedHashHex;
}

// Lightweight JWT (JSON Web Token) implementation using WebCrypto HMAC-SHA256
function base64UrlEncode(str: string): string {
  const base64 = btoa(str);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return atob(base64);
}

export async function createJwt(payload: Record<string, any>, secret: string, expiresInSeconds = 86400 * 7): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
  };

  const encHeader = base64UrlEncode(JSON.stringify(header));
  const encPayload = base64UrlEncode(JSON.stringify(fullPayload));
  const dataToSign = `${encHeader}.${encPayload}`;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(dataToSign));
  const signatureBytes = new Uint8Array(signature);
  let binary = '';
  for (let i = 0; i < signatureBytes.byteLength; i++) {
    binary += String.fromCharCode(signatureBytes[i]);
  }
  const encSignature = base64UrlEncode(binary);

  return `${dataToSign}.${encSignature}`;
}

export async function verifyJwt(token: string, secret: string): Promise<Record<string, any> | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [encHeader, encPayload, encSignature] = parts;
    const dataToSign = `${encHeader}.${encPayload}`;

    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const rawSig = base64UrlDecode(encSignature);
    const sigBytes = new Uint8Array(rawSig.length);
    for (let i = 0; i < rawSig.length; i++) {
      sigBytes[i] = rawSig.charCodeAt(i);
    }

    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(dataToSign));
    if (!valid) return null;

    const payload = JSON.parse(base64UrlDecode(encPayload));
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return null; // Expired
    }

    return payload;
  } catch {
    return null;
  }
}

// Decompress raw deflate bytes using standard DecompressionStream (Web Standard, Node 18+, Cloudflare Workers)
async function inflateRawBytes(
  compressedBytes: Uint8Array,
  maxOutputBytes = 64 * 1024
): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    return new Uint8Array(0);
  }

  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();

  // Defensive: ensure chunk is a Uint8Array instance (never raw ArrayBuffer)
  const chunk = new Uint8Array(
    compressedBytes.buffer,
    compressedBytes.byteOffset,
    compressedBytes.byteLength
  );

  let writeError: unknown = null;
  // Write and close inside a promise with local catch to avoid any floating unhandled rejections
  const writePromise = (async () => {
    try {
      await writer.write(chunk as unknown as BufferSource);
      await writer.close();
    } catch (err) {
      writeError = err;
    }
  })();

  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  let readError: unknown = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalLength += value.length;
        if (totalLength > maxOutputBytes) {
          readError = new Error(`Dung lượng manifest giải nén vượt quá giới hạn an toàn (${maxOutputBytes} bytes)`);
          try {
            await reader.cancel('Manifest size limit exceeded');
          } catch {
            // ignore cancel error
          }
          break;
        }
        chunks.push(value);
      }
    }
  } catch (err) {
    readError = err;
  }

  // Always await writer completion so no unhandled rejections escape
  await writePromise;

  if (readError) {
    throw readError;
  }
  if (writeError) {
    throw writeError;
  }

  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const c of chunks) {
    result.set(c, offset);
    offset += c.length;
  }
  return result;
}

// Security: Validate JAR/ZIP file format and anti-ZIP bomb / path traversal checks
export async function validateJarFile(bytes: Uint8Array): Promise<{ valid: boolean; error?: string }> {
  try {
    // Max size limit: 50MB (normal J2ME games are usually 100KB - 5MB)
    const MAX_SIZE = 50 * 1024 * 1024;
  if (bytes.length > MAX_SIZE) {
    return { valid: false, error: 'Dung lượng file vượt quá giới hạn 50MB cho phép' };
  }

  // Minimum ZIP file size is 22 bytes (empty End of Central Directory record)
  if (bytes.length < 22) {
    return { valid: false, error: 'File JAR không hợp lệ (kích thước quá nhỏ)' };
  }

  // Check if standard ZIP magic header exists
  const hasLocalHeader = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  const isEmptyZipHeader = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x05 && bytes[3] === 0x06;

  // Empty 22-byte ZIP or empty archive header with no files
  if (bytes.length === 22 || isEmptyZipHeader) {
    return { valid: false, error: 'File JAR rỗng hoặc không có tệp nào' };
  }

  if (!hasLocalHeader) {
    return { valid: false, error: 'File không đúng định dạng ZIP/JAR hợp lệ' };
  }

  // 1. Locate End of Central Directory (EOCD) record (starts with PK\x05\x06)
  let eocdOffset = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (
      bytes[i] === 0x50 &&
      bytes[i + 1] === 0x4b &&
      bytes[i + 2] === 0x05 &&
      bytes[i + 3] === 0x06
    ) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    return { valid: false, error: 'File không đúng định dạng ZIP/JAR hợp lệ (không tìm thấy End of Central Directory)' };
  }

  const totalEntries = bytes[eocdOffset + 10] | (bytes[eocdOffset + 11] << 8);
  const cdSize = (bytes[eocdOffset + 12] | (bytes[eocdOffset + 13] << 8) | (bytes[eocdOffset + 14] << 16) | (bytes[eocdOffset + 15] << 24)) >>> 0;
  const cdOffset = (bytes[eocdOffset + 16] | (bytes[eocdOffset + 17] << 8) | (bytes[eocdOffset + 18] << 16) | (bytes[eocdOffset + 19] << 24)) >>> 0;

  if (totalEntries === 0) {
    return { valid: false, error: 'File JAR rỗng hoặc không có tệp nào' };
  }

  if (totalEntries > 10000) {
    return { valid: false, error: 'File JAR chứa quá nhiều tệp (vượt quá 10,000 entries)' };
  }

  if (cdOffset + cdSize > bytes.length) {
    return { valid: false, error: 'Cấu trúc Central Directory trong file JAR bị lỗi' };
  }

  // 2. Parse Central Directory headers (PK\x01\x02)
  let ptr = cdOffset;
  let entryCount = 0;
  let totalUncompressedSize = 0;
  let manifestEntry: { localHeaderOffset: number; compMethod: number; compSize: number; uncompSize: number } | null = null;
  const dec = new TextDecoder('utf-8', { fatal: false });

  while (ptr + 46 <= cdOffset + cdSize && entryCount < totalEntries) {
    if (bytes[ptr] !== 0x50 || bytes[ptr + 1] !== 0x4b || bytes[ptr + 2] !== 0x01 || bytes[ptr + 3] !== 0x02) {
      break;
    }

    entryCount++;
    if (entryCount > 10000) {
      return { valid: false, error: 'File JAR chứa quá nhiều tệp (vượt quá 10,000 entries)' };
    }

    const compMethod = bytes[ptr + 10] | (bytes[ptr + 11] << 8);
    const compSize = (bytes[ptr + 20] | (bytes[ptr + 21] << 8) | (bytes[ptr + 22] << 16) | (bytes[ptr + 23] << 24)) >>> 0;
    const uncompSize = (bytes[ptr + 24] | (bytes[ptr + 25] << 8) | (bytes[ptr + 26] << 16) | (bytes[ptr + 27] << 24)) >>> 0;
    const nameLen = bytes[ptr + 28] | (bytes[ptr + 29] << 8);
    const extraLen = bytes[ptr + 30] | (bytes[ptr + 31] << 8);
    const commentLen = bytes[ptr + 32] | (bytes[ptr + 33] << 8);
    const localHeaderOffset = (bytes[ptr + 42] | (bytes[ptr + 43] << 8) | (bytes[ptr + 44] << 16) | (bytes[ptr + 45] << 24)) >>> 0;

    // Accumulate uncompressed size & detect ZIP bomb
    totalUncompressedSize += uncompSize;
    if (totalUncompressedSize > 200 * 1024 * 1024) {
      return { valid: false, error: 'Tổng dung lượng giải nén vượt quá giới hạn an toàn 200MB (phát hiện ZIP bomb)' };
    }

    if (uncompSize > 1024 * 1024 && compSize > 0 && (uncompSize / compSize) > 100) {
      return { valid: false, error: 'Tỉ lệ nén bất thường (phát hiện ZIP bomb)' };
    }

    const nameStart = ptr + 46;
    if (nameStart + nameLen > bytes.length) {
      return { valid: false, error: 'Tên tệp trong archive bị cắt ngang' };
    }

    const fileName = dec.decode(bytes.subarray(nameStart, nameStart + nameLen));

    // Entry name security validation
    if (fileName.includes('..')) {
      return { valid: false, error: 'Tên tệp trong archive không an toàn (chứa path traversal "..")' };
    }

    if (fileName.startsWith('/') || fileName.startsWith('\\')) {
      return { valid: false, error: 'Tên tệp trong archive không an toàn (đường dẫn tuyệt đối)' };
    }

    if (fileName.includes('\\') || /^[a-zA-Z]:/.test(fileName)) {
      return { valid: false, error: 'Tên tệp trong archive chứa ký tự đường dẫn không hợp lệ' };
    }

    if (fileName.toUpperCase() === 'META-INF/MANIFEST.MF') {
      manifestEntry = { localHeaderOffset, compMethod, compSize, uncompSize };
    }

    ptr += 46 + nameLen + extraLen + commentLen;
  }

  if (entryCount === 0) {
    return { valid: false, error: 'File JAR rỗng hoặc không có tệp nào' };
  }

  if (!manifestEntry) {
    return { valid: false, error: 'File JAR thiếu tệp META-INF/MANIFEST.MF bắt buộc' };
  }

  // Pre-check manifest uncompressed size limit (≤ 64KB)
  if (manifestEntry.uncompSize > 64 * 1024) {
    return { valid: false, error: 'Dung lượng manifest trong file JAR vượt quá giới hạn 64KB cho phép' };
  }

  // 3. Extract and check manifest content
  const loc = manifestEntry.localHeaderOffset;
  if (
    loc + 30 > bytes.length ||
    bytes[loc] !== 0x50 ||
    bytes[loc + 1] !== 0x4b ||
    bytes[loc + 2] !== 0x03 ||
    bytes[loc + 3] !== 0x04
  ) {
    return { valid: false, error: 'Header của tệp manifest trong archive không hợp lệ' };
  }

  const locNameLen = bytes[loc + 26] | (bytes[loc + 27] << 8);
  const locExtraLen = bytes[loc + 28] | (bytes[loc + 29] << 8);
  const dataStart = loc + 30 + locNameLen + locExtraLen;

  if (dataStart + manifestEntry.compSize > bytes.length) {
    return { valid: false, error: 'Dữ liệu manifest trong archive bị cắt ngang' };
  }

  let manifestText = '';
  if (manifestEntry.compMethod === 0) {
    manifestText = dec.decode(bytes.subarray(dataStart, dataStart + manifestEntry.uncompSize));
  } else if (manifestEntry.compMethod === 8) {
    try {
      const inflated = await inflateRawBytes(
        bytes.subarray(dataStart, dataStart + manifestEntry.compSize),
        64 * 1024
      );
      manifestText = dec.decode(inflated);
    } catch {
      return { valid: false, error: 'Không thể giải nén manifest trong file JAR' };
    }
  } else {
    return { valid: false, error: 'Phương thức nén manifest không được hỗ trợ' };
  }

  const hasMidlet =
    /(?:^|\r?\n)(?:MIDlet-1|MIDlet-Name)\s*:/i.test(manifestText) ||
    manifestText.includes('MIDlet-1') ||
    manifestText.includes('MIDlet-Name');

  if (!hasMidlet) {
    return { valid: false, error: 'File JAR thiếu thuộc tính MIDlet-1 hoặc MIDlet-Name trong MANIFEST.MF' };
  }

    return { valid: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { valid: false, error: `Lỗi kiểm tra file JAR: ${msg}` };
  }
}

// Security: Validate JAD text descriptor
export function validateJadFile(content: Uint8Array | string): { valid: boolean; error?: string } {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  const MAX_JAD_SIZE = 100 * 1024; // 100KB
  if (bytes.length > MAX_JAD_SIZE) {
    return { valid: false, error: 'Dung lượng file JAD vượt quá giới hạn 100KB cho phép' };
  }

  const text = typeof content === 'string' ? content : new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  if (!text || text.trim().length === 0) {
    return { valid: false, error: 'File JAD rỗng' };
  }

  const hasName = /(?:^|\r?\n)MIDlet-Name\s*:/i.test(text);
  const hasVersion = /(?:^|\r?\n)MIDlet-Version\s*:/i.test(text);
  const hasJarUrl = /(?:^|\r?\n)MIDlet-Jar-URL\s*:/i.test(text);

  if (!hasName || !hasVersion || !hasJarUrl) {
    return { valid: false, error: 'File JAD thiếu các trường bắt buộc (MIDlet-Name, MIDlet-Version, MIDlet-Jar-URL)' };
  }

  return { valid: true };
}

// Security: Validate image format by magic bytes (PNG, JPEG, WebP, GIF)
export function detectImageFormat(bytes: Uint8Array): {
  valid: boolean;
  mimeType?: string;
  ext?: string;
  error?: string;
} {
  const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
  if (bytes.length > MAX_IMAGE_SIZE) {
    return { valid: false, error: 'Dung lượng ảnh vượt quá giới hạn 5MB cho phép' };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { valid: true, mimeType: 'image/png', ext: 'png' };
  }

  // JPEG: FF D8 FF
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { valid: true, mimeType: 'image/jpeg', ext: 'jpg' };
  }

  // GIF: GIF87a or GIF89a
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return { valid: true, mimeType: 'image/gif', ext: 'gif' };
  }

  // WebP: RIFF .... WEBP
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { valid: true, mimeType: 'image/webp', ext: 'webp' };
  }

  return { valid: false, error: 'Định dạng ảnh không hợp lệ (chỉ hỗ trợ PNG, JPEG, WebP, GIF)' };
}
