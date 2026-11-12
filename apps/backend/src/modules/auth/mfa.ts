/**
 * TOTP MFA helpers for platform admins.
 *
 * Thin wrapper around `speakeasy` (TOTP) + `qrcode` (data-URL renderer).
 * Used by the /operator login + enrollment flow. NOT wired into regular
 * tenant auth — that's a separate, future change.
 */

import speakeasy from 'speakeasy'
import QRCode from 'qrcode'

const ISSUER = 'SureVax Platform'

export function generateSecret(email: string): {
  base32: string
  otpauthUrl: string
} {
  const secret = speakeasy.generateSecret({
    length: 20,
    name: `${ISSUER} (${email})`,
    issuer: ISSUER,
  })
  // speakeasy types omit otpauth_url on the wider Secret shape; cast.
  return {
    base32: secret.base32,
    otpauthUrl: secret.otpauth_url ?? '',
  }
}

/**
 * Verify a 6-digit TOTP token against the stored base32 secret.
 * `window: 1` permits ±30s clock skew (one period either side).
 */
export function verifyToken(secret: string, token: string): boolean {
  if (!/^\d{6}$/.test(token)) return false
  return speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token,
    window: 1,
  })
}

export async function qrCodeDataUrl(otpauthUrl: string): Promise<string> {
  return QRCode.toDataURL(otpauthUrl)
}
