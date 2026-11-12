import { describe, it, expect } from 'vitest'
import { isSensitiveKey, maskSensitive, SENSITIVE_MASK } from './sensitive'

describe('isSensitiveKey', () => {
  it('matches api_key', () => {
    expect(isSensitiveKey('api_key')).toBe(true)
  })
  it('matches apiKey (camelCase)', () => {
    expect(isSensitiveKey('apiKey')).toBe(true)
  })
  it('matches api-key (hyphen)', () => {
    expect(isSensitiveKey('api-key')).toBe(true)
  })
  it('matches external_api_key (prefix)', () => {
    expect(isSensitiveKey('external_api_key')).toBe(true)
  })
  it('matches secret', () => {
    expect(isSensitiveKey('secret')).toBe(true)
  })
  it('matches client_secret', () => {
    expect(isSensitiveKey('client_secret')).toBe(true)
  })
  it('matches token', () => {
    expect(isSensitiveKey('token')).toBe(true)
  })
  it('matches access_token', () => {
    expect(isSensitiveKey('access_token')).toBe(true)
  })
  it('matches password', () => {
    expect(isSensitiveKey('password')).toBe(true)
  })
  it('matches auth', () => {
    expect(isSensitiveKey('auth')).toBe(true)
  })
  it('matches authToken', () => {
    expect(isSensitiveKey('authToken')).toBe(true)
  })
  it('matches credential', () => {
    expect(isSensitiveKey('credential')).toBe(true)
  })
  it('matches credentials (plural)', () => {
    expect(isSensitiveKey('credentials')).toBe(true)
  })
  // Negative cases
  it('does NOT match author (auth false-positive guard)', () => {
    expect(isSensitiveKey('author')).toBe(false)
  })
  it('does NOT match name', () => {
    expect(isSensitiveKey('name')).toBe(false)
  })
  it('does NOT match email', () => {
    expect(isSensitiveKey('email')).toBe(false)
  })
  it('does NOT match label', () => {
    expect(isSensitiveKey('label')).toBe(false)
  })
})

describe('maskSensitive', () => {
  it('masks api_key value', () => {
    const result = maskSensitive({ api_key: 'abc123' }) as Record<string, unknown>
    expect(result.api_key).toBe(SENSITIVE_MASK)
  })
  it('masks apiKey (camelCase)', () => {
    const result = maskSensitive({ apiKey: 'abc123' }) as Record<string, unknown>
    expect(result.apiKey).toBe(SENSITIVE_MASK)
  })
  it('does NOT mask null value at sensitive key', () => {
    const result = maskSensitive({ api_key: null }) as Record<string, unknown>
    expect(result.api_key).toBeNull()
  })
  it('does NOT mask undefined value at sensitive key', () => {
    const result = maskSensitive({ api_key: undefined }) as Record<string, unknown>
    expect(result.api_key).toBeUndefined()
  })
  it('does NOT mask author key (false-positive guard)', () => {
    const result = maskSensitive({ author: 'John' }) as Record<string, unknown>
    expect(result.author).toBe('John')
  })
  it('masks nested token', () => {
    const result = maskSensitive({ nested: { token: 'x' } }) as Record<string, unknown>
    expect((result.nested as Record<string, unknown>).token).toBe(SENSITIVE_MASK)
  })
  it('masks items inside arrays', () => {
    const result = maskSensitive([{ secret: 'x' }, { secret: 'y' }]) as Array<
      Record<string, unknown>
    >
    expect(result[0]!.secret).toBe(SENSITIVE_MASK)
    expect(result[1]!.secret).toBe(SENSITIVE_MASK)
  })
  it('preserves non-sensitive keys', () => {
    const result = maskSensitive({
      name: 'Lab X',
      api_key: 'k',
      url: 'http://example.com',
    }) as Record<string, unknown>
    expect(result.name).toBe('Lab X')
    expect(result.url).toBe('http://example.com')
    expect(result.api_key).toBe(SENSITIVE_MASK)
  })
  it('returns primitives unchanged', () => {
    expect(maskSensitive('hello')).toBe('hello')
    expect(maskSensitive(42)).toBe(42)
    expect(maskSensitive(null)).toBeNull()
  })
})
