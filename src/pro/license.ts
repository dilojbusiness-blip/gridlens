export interface ProductIdentity { storeId: number; productId: number; variantId: number }
export interface LicenseExpectation {
  product: ProductIdentity;
  key: string;
  operation: 'activate' | 'validate';
  instanceId?: string;
  now?: number;
}
export type LicenseDecision = { allowed: false; reason: 'configuration' | 'invalid' | 'expired' | 'product' | 'instance' } | { allowed: true; instanceId: string; expiresAt: number | null };

const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const positiveId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const instance = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);

export function assessLicense(response: unknown, expected: LicenseExpectation): LicenseDecision {
  // This checks a response shape, not its authenticity or freshness.
  const now = expected.now ?? Date.now();
  if (!expected.product || ![expected.product.storeId, expected.product.productId, expected.product.variantId].every(positiveId) || !Number.isFinite(now) || typeof expected.key !== 'string' || !expected.key || expected.key.length > 256 || /[\x00-\x1f]/.test(expected.key) || !['activate', 'validate'].includes(expected.operation)) return { allowed: false, reason: 'configuration' };
  if (expected.operation === 'validate' && !instance(expected.instanceId)) return { allowed: false, reason: 'configuration' };
  const body = record(response), key = record(body?.license_key), meta = record(body?.meta), activatedInstance = record(body?.instance);
  const success = expected.operation === 'activate' ? body?.activated : body?.valid;
  if (success !== true || body?.error !== null || !key || key.status !== 'active' || key.key !== expected.key) return { allowed: false, reason: 'invalid' };
  if (!meta || meta.store_id !== expected.product.storeId || meta.product_id !== expected.product.productId || meta.variant_id !== expected.product.variantId) return { allowed: false, reason: 'product' };
  if (!activatedInstance || !instance(activatedInstance.id) || (expected.instanceId !== undefined && activatedInstance.id !== expected.instanceId)) return { allowed: false, reason: 'instance' };
  let expiresAt: number | null = null;
  if (key.expires_at !== null) {
    if (typeof key.expires_at !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(key.expires_at)) return { allowed: false, reason: 'invalid' };
    expiresAt = Date.parse(key.expires_at);
    if (!Number.isFinite(expiresAt) || new Date(expiresAt).toISOString().slice(0, 19) !== key.expires_at.slice(0, 19)) return { allowed: false, reason: 'invalid' };
    if (expiresAt <= now) return { allowed: false, reason: 'expired' };
  }
  return { allowed: true, instanceId: activatedInstance.id, expiresAt };
}