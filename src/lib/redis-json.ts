/**
 * Upstash Redis may return JSON strings already parsed as objects on lpop/rpop.
 * These helpers normalize values for parse/store regardless of wire format.
 */
export function parseRedisJson<T>(value: unknown): T {
  if (value === null || value === undefined) {
    throw new Error('Redis value is empty');
  }
  if (typeof value === 'string') {
    return JSON.parse(value) as T;
  }
  if (typeof value === 'object') {
    return value as T;
  }
  throw new Error(`Unexpected Redis value type: ${typeof value}`);
}

export function redisJsonToString(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value && typeof value === 'object') {
    return JSON.stringify(value);
  }
  throw new Error(`Cannot serialize Redis value of type: ${typeof value}`);
}
