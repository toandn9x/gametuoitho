import * as fs from 'fs';
import * as path from 'path';

export interface StoredObjectInfo {
  key: string;
  size: number;
  /** Last write / upload time in ms (used by the cleanup safety window). */
  mtimeMs: number;
}

export interface StorageDriver {
  put(key: string, data: Uint8Array | ArrayBuffer, contentType: string): Promise<void>;
  get(key: string): Promise<{ data: ArrayBuffer; contentType: string } | null>;
  delete(key: string): Promise<void>;
  getUrl(key: string): string;
  /** Every stored object (storage analysis / orphan cleanup). Optional for test doubles. */
  list?(): Promise<StoredObjectInfo[]>;
  /** Housekeeping after cleanup (local disk only). */
  pruneEmptyDirs?(): Promise<void>;
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

  async list(): Promise<StoredObjectInfo[]> {
    const results: StoredObjectInfo[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.r2.list({ cursor, limit: 1000 });
      for (const obj of page.objects) {
        results.push({ key: obj.key, size: obj.size, mtimeMs: new Date(obj.uploaded).getTime() });
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    return results;
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

  async list(): Promise<StoredObjectInfo[]> {
    const results: StoredObjectInfo[] = [];
    const scan = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scan(fullPath);
        } else if (entry.isFile()) {
          const stats = fs.statSync(fullPath);
          results.push({
            // Normalize key with forward slashes
            key: path.relative(this.baseDir, fullPath).replace(/\\/g, '/'),
            size: stats.size,
            mtimeMs: stats.mtimeMs,
          });
        }
      }
    };
    scan(this.baseDir);
    return results;
  }

  async pruneEmptyDirs(): Promise<void> {
    const prune = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          const subDir = path.join(dir, entry.name);
          prune(subDir);
          try {
            if (fs.readdirSync(subDir).length === 0) fs.rmdirSync(subDir);
          } catch {}
        }
      }
    };
    prune(this.baseDir);
  }
}
