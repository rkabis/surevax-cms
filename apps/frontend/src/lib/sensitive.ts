/**
 * Canonical sensitive-key patterns. A JSONB key whose name matches any of
 * these regexes is masked when rendered in detail drawers.
 *
 * Per .claude/rules/patterns.md the project's masking allowlist is:
 *   api_key, secret, token, password, auth, credential
 *
 * Substring matching is used for most patterns so that common variants like
 * "client_secret", "access_token", "authToken", and "external_api_key" are
 * all caught. The `auth` pattern uses a negative lookahead to avoid masking
 * "author".
 */
export const SENSITIVE_KEY_PATTERNS: ReadonlyArray<RegExp> = [
  // api_key, apiKey, api-key, external_api_key
  /api[_-]?key/i,
  // secret, client_secret, clientSecret — substring match is intentional
  /secret/i,
  // token, access_token, authToken, refresh_token — substring match is intentional
  /token/i,
  // password, passwordHash
  /password/i,
  // auth, authToken, authorization — but NOT author (negative lookahead)
  /auth(?!or)/i,
  // credential, credentials
  /credential/i,
]

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((re) => re.test(key))
}

/** Standard mask string for sensitive values. */
export const SENSITIVE_MASK = '••••'

/**
 * Recursively walk a value, masking any sub-value whose property key matches
 * SENSITIVE_KEY_PATTERNS. Arrays preserved structurally; primitives at non-
 * sensitive keys returned as-is. Null/undefined values at sensitive keys are
 * left as-is (no need to mask the absence of a value).
 */
export function maskSensitive<T = unknown>(value: T, parentKey?: string): T {
  if (parentKey && isSensitiveKey(parentKey) && value !== null && value !== undefined) {
    return SENSITIVE_MASK as unknown as T
  }
  if (Array.isArray(value)) {
    return value.map((v) => maskSensitive(v)) as unknown as T
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = maskSensitive(v, k)
    }
    return out as unknown as T
  }
  return value
}
