import { AwsClient } from 'aws4fetch';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { StorageDriver, StoredObjectInfo } from './storage';

export interface TigrisOptions {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  /** Only for a local S3 simulator; never enabled in production. */
  allowLocalHttp?: boolean;
  requestTimeoutMs?: number;
}

/** Private S3-compatible storage. Browser URLs always pass through our authenticated asset API. */
export class TigrisStorageDriver implements StorageDriver {
  private readonly client: AwsClient;
  private readonly bucketUrl: string;
  private readonly timeoutMs: number;
  private readonly parser = new XMLParser({
    parseTagValue: false,
    trimValues: false,
    removeNSPrefix: true,
    isArray: (name) => name === 'Contents',
  });

  constructor(options: TigrisOptions) {
    const endpoint = new URL(options.endpoint);
    const localHttp = options.allowLocalHttp && endpoint.protocol === 'http:' &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname);
    if ((!localHttp && endpoint.protocol !== 'https:') || endpoint.username || endpoint.password ||
      endpoint.search || endpoint.hash || endpoint.pathname !== '/') {
      throw new Error('TIGRIS_ENDPOINT phải là HTTPS origin, không có đường dẫn, query hoặc thông tin đăng nhập');
    }
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(options.bucket)) {
      throw new Error('TIGRIS_BUCKET không hợp lệ (3–63 ký tự chữ thường, số, dấu chấm hoặc gạch ngang)');
    }
    if (!options.accessKeyId?.trim() || !options.secretAccessKey?.trim()) {
      throw new Error('Cần cấu hình TIGRIS_ACCESS_KEY_ID và TIGRIS_SECRET_ACCESS_KEY');
    }
    this.bucketUrl = `${endpoint.origin}/${options.bucket}`;
    this.timeoutMs = options.requestTimeoutMs ?? 15000;
    this.client = new AwsClient({
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
      service: 's3',
      region: options.region || 'auto',
      retries: 0,
    });
  }

  private validateKey(key: string): void {
    if (!key || /[\x00-\x1f\x7f\\]/.test(key) || key.split('/').some(part => !part || part === '.' || part === '..')) {
      throw new Error('Invalid storage key');
    }
  }

  private objectUrl(key: string): string {
    this.validateKey(key);
    return `${this.bucketUrl}/${key.split('/').map(part => encodeURIComponent(part)).join('/')}`;
  }

  private async request(url: string, method: string, body?: ArrayBuffer, contentType?: string): Promise<Response> {
    // Sign once, then use native fetch: bounded timeout, no automatic replay of writes or redirects.
    const signed = await this.client.sign(url, {
      method,
      body,
      headers: contentType ? { 'Content-Type': contentType } : {},
      // Workers supports manual/follow only. Reject 3xx through check(), without forwarding credentials.
      redirect: 'manual',
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    try {
      return await fetch(signed);
    } catch {
      // Do not expose signed URLs, access keys or upstream response bodies to API clients/logs.
      throw new Error(`Tigris ${method}: không kết nối được hoặc đã hết thời gian chờ`);
    }
  }

  private check(response: Response, operation: string): void {
    if (!response.ok) throw new Error(`Tigris ${operation}: HTTP ${response.status}`);
  }

  async put(key: string, data: Uint8Array | ArrayBuffer, contentType: string): Promise<void> {
    const body = data instanceof Uint8Array ? new Uint8Array(data).buffer : data;
    const response = await this.request(this.objectUrl(key), 'PUT', body, contentType);
    this.check(response, 'PUT');
    await response.body?.cancel();
  }

  async get(key: string): Promise<{ data: ArrayBuffer; contentType: string } | null> {
    const response = await this.request(this.objectUrl(key), 'GET');
    if (response.status === 404) {
      // A missing bucket is a configuration error, not a missing game.
      if ((await response.text()).includes('NoSuchBucket')) this.check(response, 'GET bucket');
      return null;
    }
    this.check(response, 'GET');
    return { data: await response.arrayBuffer(), contentType: response.headers.get('Content-Type') || 'application/octet-stream' };
  }

  async delete(key: string): Promise<void> {
    const response = await this.request(this.objectUrl(key), 'DELETE');
    this.check(response, 'DELETE');
    await response.body?.cancel();
  }

  getUrl(key: string): string {
    this.validateKey(key);
    return `/api/v1/assets/raw/${encodeURIComponent(key)}`;
  }

  async list(): Promise<StoredObjectInfo[]> {
    const objects: StoredObjectInfo[] = [];
    const seenTokens = new Set<string>();
    let token: string | undefined;
    do {
      const query = new URLSearchParams({ 'list-type': '2', 'max-keys': '1000', 'encoding-type': 'url' });
      if (token) query.set('continuation-token', token);
      const response = await this.request(`${this.bucketUrl}?${query}`, 'GET');
      this.check(response, 'LIST');
      const xml = await response.text();
      if (xml.length > 4 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) {
        throw new Error('Tigris LIST: XML không hợp lệ');
      }
      const page = this.parser.parse(xml).ListBucketResult;
      if (!page || !['true', 'false'].includes(page.IsTruncated) || page.EncodingType !== 'url') {
        throw new Error('Tigris LIST: phản hồi không hợp lệ');
      }
      for (const item of page.Contents || []) {
        const key = decodeURIComponent(item.Key);
        const size = Number(item.Size);
        const mtimeMs = Date.parse(item.LastModified);
        this.validateKey(key);
        if (!/^\d+$/.test(item.Size) || !Number.isSafeInteger(size) || !Number.isFinite(mtimeMs)) {
          throw new Error('Tigris LIST: metadata file không hợp lệ');
        }
        objects.push({ key, size, mtimeMs });
      }
      token = page.IsTruncated === 'true' ? page.NextContinuationToken : undefined;
      if (page.IsTruncated === 'true' && (typeof token !== 'string' || !token || seenTokens.has(token))) {
        throw new Error('Tigris LIST: continuation token không hợp lệ');
      }
      if (token) seenTokens.add(token);
    } while (token);
    return objects;
  }
}
