export class TTLCache<TValue> {
  private readonly store = new Map<string, { value: TValue; expiresAt: number }>();

  constructor(private readonly ttlMs: number) {}

  set(key: string, value: TValue): void {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  get(key: string): TValue | null {
    const entry = this.store.get(key);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  delete(key: string): void {
    this.store.delete(key);
  }
}
