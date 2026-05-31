import { pathToSlug } from '@/services/docs/logDrain';

describe('pathToSlug', () => {
  it('maps locale-prefixed paths to slugs', () => {
    expect(pathToSlug('/en/concepts/graph-rag')).toBe('en/concepts/graph-rag');
    expect(pathToSlug('es/guides/quickstart')).toBe('es/guides/quickstart');
  });

  it('extracts pathname from full URLs', () => {
    expect(pathToSlug('https://docs.example.com/pt/reference/api')).toBe(
      'pt/reference/api'
    );
  });

  it('returns null for non-content paths', () => {
    expect(pathToSlug('/_next/static/chunk.js')).toBeNull();
    expect(pathToSlug('/api/pages/snapshot')).toBeNull();
    expect(pathToSlug('/favicon.ico')).toBeNull();
    expect(pathToSlug('/en')).toBeNull();
  });

  it('returns null for paths without locale prefix', () => {
    expect(pathToSlug('/concepts/foo')).toBeNull();
  });
});
