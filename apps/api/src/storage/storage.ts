import * as fs from 'fs';
import * as path from 'path';

export interface StorageDriver {
  put(key: string, data: Uint8Array | ArrayBuffer, contentType: string): Promise<void>;
  get(key: string): Promise<{ data: ArrayBuffer; contentType: string } | null>;
  delete(key: string): Promise<void>;
  getUrl(key: string): string;
}

// Cloudflare R2 driver
export class R2StorageDriver implements StorageDriver {
  constructor(private r2: any, private publicUrlPrefix = '/api/v1/assets/raw/') {}

  async put(key: string, data: Uint8Array | ArrayBuffer, contentType: string): Promise<void> {
    await this.r2.put(key, data, {
      httpMetadata: { contentType },
    });
  }

  async get(key: string): Promise<{ data: ArrayBuffer; contentType: string } | null> {
    const object = await this.r2.get(key);
    if (!object) return null;
    const data = await object.arrayBuffer();
    const contentType = object.httpMetadata?.contentType || 'application/octet-stream';
    return { data, contentType };
  }

  async delete(key: string): Promise<void> {
    await this.r2.delete(key);
  }

  getUrl(key: string): string {
    return `${this.publicUrlPrefix}${encodeURIComponent(key)}`;
  }
}

// Local filesystem storage driver (for local development and testing)
export class LocalStorageDriver implements StorageDriver {
  private baseDir: string;

  constructor(baseDir = './uploads', private publicUrlPrefix = '/api/v1/assets/raw/') {
    this.baseDir = path.resolve(baseDir);
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  getBaseDir(): string {
    return this.baseDir;
  }

  private getSafeFilePath(key: string): string | null {
    if (!key || typeof key !== 'string') return null;
    if (key.includes('\0') || key.includes('\\')) return null;
    if (path.isAbsolute(key) || /^[a-zA-Z]:/.test(key) || key.startsWith('/')) return null;
    const parts = key.split('/');
    for (const p of parts) {
      if (p === '..' || p === '.') return null;
    }
    const resolvedPath = path.resolve(this.baseDir, key);
    const rel = path.relative(this.baseDir, resolvedPath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return null;
    }
    return resolvedPath;
  }

  async put(key: string, data: Uint8Array | ArrayBuffer, _contentType: string): Promise<void> {
    const filePath = this.getSafeFilePath(key);
    if (!filePath) {
      throw new Error('Invalid storage key: path traversal or invalid path detected');
    }
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const buffer = data instanceof Uint8Array ? data : new Uint8Array(data);
    fs.writeFileSync(filePath, buffer);
  }

  async get(key: string): Promise<{ data: ArrayBuffer; contentType: string } | null> {
    const filePath = this.getSafeFilePath(key);
    if (!filePath || !fs.existsSync(filePath)) return null;
    const file = fs.readFileSync(filePath);
    const contentType = key.endsWith('.jar')
      ? 'application/java-archive'
      : key.endsWith('.jad')
      ? 'text/vnd.sun.j2me.app-descriptor'
      : key.endsWith('.webp')
      ? 'image/webp'
      : key.endsWith('.png')
      ? 'image/png'
      : 'application/octet-stream';

    const arrayBuffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
    return { data: arrayBuffer, contentType };
  }

  async delete(key: string): Promise<void> {
    const filePath = this.getSafeFilePath(key);
    if (!filePath) {
      throw new Error('Invalid storage key: path traversal or invalid path detected');
    }
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  getUrl(key: string): string {
    return `${this.publicUrlPrefix}${encodeURIComponent(key)}`;
  }
}
