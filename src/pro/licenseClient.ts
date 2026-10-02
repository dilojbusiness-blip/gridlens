import { request } from 'node:https';
import { assessLicense, LicenseDecision, ProductIdentity } from './license';

type Operation = 'activate' | 'validate' | 'deactivate';
export type LicenseTransport = (operation: Operation, fields: Record<string, string>) => Promise<unknown>;
export interface SecretStore {
  get(key: string): PromiseLike<string | undefined>;
  store(key: string, value: string): PromiseLike<void>;
  delete(key: string): PromiseLike<void>;
}
export type ClientResult = { allowed: true } | { allowed: false; reason: 'configuration' | 'missing' | 'rejected' | 'activation_limit' | 'different_key' | 'forgotten' | 'unavailable' | 'storage' };
const SECRET = 'gridlens.pro.activation';
const MAX_FIELD_LENGTH = 256;
const MAX_REQUEST_SIZE = 2048;
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
const validKey = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\x00-\x1f]/.test(value);
const validField = (value: unknown): value is string => typeof value === 'string' && value.length <= MAX_FIELD_LENGTH && !/[\x00-\x1f]/.test(value);

export const requestLicense: LicenseTransport = (operation, fields) => new Promise((resolve, reject) => {
  const entries = object(fields) ? Object.entries(fields) : [];
  if (!['activate', 'validate', 'deactivate'].includes(operation) || !object(fields) || entries.length > 8 || !entries.every(([name, value]) => name.length <= 64 && validField(value))) {
    reject(new Error('Invalid license request.'));
    return;
  }
  const rawSize = entries.reduce((size, [name, value]) => size + name.length + value.length, 0);
  if (rawSize > MAX_REQUEST_SIZE) {
    reject(new Error('Invalid license request.'));
    return;
  }
  const body = new URLSearchParams(fields as Record<string, string>).toString();
  if (Buffer.byteLength(body) > MAX_REQUEST_SIZE) {
    reject(new Error('Invalid license request.'));
    return;
  }
  const req = request({ hostname: 'api.lemonsqueezy.com', path: `/v1/licenses/${operation}`, method: 'POST', port: 443, headers: {
    Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body),
  } }, res => {
    const chunks: Buffer[] = [];
    let size = 0;
    res.on('data', chunk => {
      size += chunk.length;
      if (size > 65536) { req.destroy(new Error('License service unavailable.')); return; }
      chunks.push(Buffer.from(chunk));
    });
    res.on('error', () => { clearTimeout(deadline); reject(new Error('License service unavailable.')); });
    res.on('aborted', () => { clearTimeout(deadline); reject(new Error('License service unavailable.')); });
    res.on('end', () => {
      clearTimeout(deadline);
      const status = res.statusCode ?? 0;
      if (status < 200 || status >= 500 || (status >= 300 && status < 400) || status === 429) { reject(new Error('License service unavailable.')); return; }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('Invalid license service response.')); }
    });
  });
  const deadline = setTimeout(() => req.destroy(new Error('License service unavailable.')), 10000);
  req.on('error', () => { clearTimeout(deadline); reject(new Error('License service unavailable.')); });
  req.end(body);
});

interface SavedActivation { key: string; instanceId: string }
export class LicenseClient {
  private queue: Promise<unknown> = Promise.resolve();
  private checkedUntil = 0;
  private checkedAt = 0;
  constructor(private readonly product: ProductIdentity | null, private readonly secrets: SecretStore, private readonly transport: LicenseTransport = requestLicense, private readonly now: () => number = Date.now) {}

  private configured(): boolean {
    return !!this.product && [this.product.storeId, this.product.productId, this.product.variantId].every(n => Number.isSafeInteger(n) && n > 0);
  }
  private serialized<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }
  private async read(): Promise<SavedActivation | null> {
    const text = await this.secrets.get(SECRET);
    if (!text) return null;
    try {
      const parsed = object(JSON.parse(text));
      return parsed && validKey(parsed.key) && uuid(parsed.instanceId) ? { key: parsed.key, instanceId: parsed.instanceId } : null;
    } catch { return null; }
  }
  private assess(response: unknown, saved: SavedActivation, operation: 'activate' | 'validate'): LicenseDecision {
    return assessLicense(response, { product: this.product!, key: saved.key, instanceId: saved.instanceId, operation, now: this.now() });
  }
  private accept(decision: LicenseDecision): ClientResult {
    if (!decision.allowed) { this.checkedUntil = 0; this.checkedAt = 0; return { allowed: false, reason: 'rejected' }; }
    const checkedAt = this.now();
    this.checkedAt = checkedAt;
    this.checkedUntil = Math.min(checkedAt + 5 * 60 * 1000, decision.expiresAt ?? Infinity);
    return { allowed: true };
  }

  private clearCache(): void {
    this.checkedUntil = 0;
    this.checkedAt = 0;
  }

  private activationLimit(response: unknown): boolean {
    const body = object(response);
    return typeof body?.activation_limit === 'number' && Number.isSafeInteger(body.activation_limit) && body.activation_limit > 0
      && typeof body.activation_usage === 'number' && Number.isSafeInteger(body.activation_usage) && body.activation_usage >= body.activation_limit;
  }

  activate(key: string): Promise<ClientResult> {
    return this.serialized(async () => {
      this.clearCache();
      if (!this.configured() || !validKey(key)) return { allowed: false, reason: 'configuration' };
      let existing: SavedActivation | null;
      try { existing = await this.read(); } catch { return { allowed: false, reason: 'storage' }; }
      if (existing && existing.key !== key) return { allowed: false, reason: 'different_key' };
      try {
        if (existing) return this.accept(this.assess(await this.transport('validate', { license_key: key, instance_id: existing.instanceId }), existing, 'validate'));
        // Verify product ownership before consuming an activation slot.
        const preflight = object(await this.transport('validate', { license_key: key }));
        const license = object(preflight?.license_key), meta = object(preflight?.meta);
        if (preflight?.valid !== true || preflight.error !== null || license?.key !== key || !['active', 'inactive'].includes(String(license?.status)) || meta?.store_id !== this.product!.storeId || meta?.product_id !== this.product!.productId || meta?.variant_id !== this.product!.variantId) return { allowed: false, reason: 'rejected' };
        if (this.activationLimit(license)) return { allowed: false, reason: 'activation_limit' };
        const activated = await this.transport('activate', { license_key: key, instance_name: 'GridLens desktop' });
        const info = object(object(activated)?.instance);
        if (!info || !uuid(info.id)) return { allowed: false, reason: 'rejected' };
        const saved = { key, instanceId: info.id };
        const checked = this.assess(activated, saved, 'activate');
        if (!checked.allowed) return { allowed: false, reason: 'rejected' };
        try { await this.secrets.store(SECRET, JSON.stringify(saved)); }
        catch {
          try { await this.transport('deactivate', { license_key: key, instance_id: saved.instanceId }); } catch { /* Remote cleanup can be retried from the merchant dashboard. */ }
          return { allowed: false, reason: 'storage' };
        }
        return this.accept(checked);
      } catch { return { allowed: false, reason: 'unavailable' }; }
    });
  }

  validate(): Promise<ClientResult> {
    return this.serialized(async () => {
      if (!this.configured()) return { allowed: false, reason: 'configuration' };
      const current = this.now();
      if (current < this.checkedAt) this.clearCache();
      if (this.checkedUntil > current) return { allowed: true };
      this.clearCache();
      let saved: SavedActivation | null;
      try { saved = await this.read(); } catch { return { allowed: false, reason: 'storage' }; }
      if (!saved) return { allowed: false, reason: 'missing' };
      try { return this.accept(this.assess(await this.transport('validate', { license_key: saved.key, instance_id: saved.instanceId }), saved, 'validate')); }
      catch { return { allowed: false, reason: 'unavailable' }; }
    });
  }

  deactivate(): Promise<ClientResult> {
    return this.serialized(async () => {
      this.clearCache();
      if (!this.configured()) return { allowed: false, reason: 'configuration' };
      let saved: SavedActivation | null;
      try { saved = await this.read(); } catch { return { allowed: false, reason: 'storage' }; }
      if (!saved) return { allowed: false, reason: 'missing' };
      try {
        const before = this.assess(await this.transport('validate', { license_key: saved.key, instance_id: saved.instanceId }), saved, 'validate');
        if (!before.allowed) return { allowed: false, reason: 'rejected' };
        const result = object(await this.transport('deactivate', { license_key: saved.key, instance_id: saved.instanceId }));
        if (result?.deactivated !== true || result.error !== null) return { allowed: false, reason: 'rejected' };
        await this.secrets.delete(SECRET);
        return { allowed: false, reason: 'missing' };
      } catch { return { allowed: false, reason: 'unavailable' }; }
    });
  }

  restore(key: string, instanceId: string): Promise<ClientResult> {
    return this.serialized(async () => {
      this.clearCache();
      if (!this.configured() || !validKey(key) || !uuid(instanceId)) return { allowed: false, reason: 'configuration' };
      let existing: SavedActivation | null;
      try { existing = await this.read(); } catch { return { allowed: false, reason: 'storage' }; }
      if (existing && existing.key !== key) return { allowed: false, reason: 'different_key' };
      const saved = { key, instanceId };
      try {
        const decision = this.assess(await this.transport('validate', { license_key: key, instance_id: instanceId }), saved, 'validate');
        if (!decision.allowed) return { allowed: false, reason: 'rejected' };
        try { await this.secrets.store(SECRET, JSON.stringify(saved)); }
        catch { return { allowed: false, reason: 'storage' }; }
        return this.accept(decision);
      } catch { return { allowed: false, reason: 'unavailable' }; }
    });
  }

  /** Removes only local state; it does not contact the service or free its remote slot. */
  forgetLocal(): Promise<ClientResult> {
    return this.serialized(async () => {
      this.clearCache();
      let saved: SavedActivation | null;
      try { saved = await this.read(); } catch { return { allowed: false, reason: 'storage' }; }
      if (!saved) return { allowed: false, reason: 'missing' };
      try {
        await this.secrets.delete(SECRET);
        return { allowed: false, reason: 'forgotten' };
      } catch { return { allowed: false, reason: 'storage' }; }
    });
  }
}