import { TTLCache } from "./cache.js";

export class IdempotencyStore<TValue> {
  private readonly cache: TTLCache<TValue>;

  constructor(ttlMs: number) {
    this.cache = new TTLCache<TValue>(ttlMs);
  }

  get(key: string): TValue | null {
    return this.cache.get(key);
  }

  set(key: string, value: TValue): void {
    this.cache.set(key, value);
  }
}
