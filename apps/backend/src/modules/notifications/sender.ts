/**
 * Notification Sender — pluggable interface + structured-logging stub.
 *
 * Phase-1 implementation: a single `LoggingSender` that writes the
 * outbound message via pino and returns success.  No real SMS / Email /
 * Push provider is called.  Future PRs swap in a Twilio / SES concrete
 * implementation without touching the dispatcher.
 *
 * Usage:
 *   const result = await defaultSender.send('SMS', '+63912345678', 'Hi …')
 *   if (!result.success) { … record failure … }
 */

import { logger } from '../../shared/utils/logger.js'

// ─── Interface ────────────────────────────────────────────────────────────────

export interface SendResult {
  success: boolean
  /** Provider-assigned message ID (undefined when success is false or logging stub). */
  externalMessageId?: string
  /** Human-readable error string when success is false. */
  error?: string
}

export interface NotificationSender {
  /**
   * Attempt to deliver a notification.
   *
   * @param channel   - 'SMS' | 'Email' | 'Push'
   * @param address   - Phone number, email address, or push token
   * @param body      - Final interpolated message body
   * @param subject   - Email subject (may be undefined for SMS/Push)
   * @param metadata  - Arbitrary context forwarded to the provider (for logging)
   */
  send(
    channel: string,
    address: string,
    body: string,
    subject?: string | null,
    metadata?: Record<string, unknown>,
  ): Promise<SendResult>
}

// ─── Logging stub (Phase-1 concrete implementation) ──────────────────────────

/**
 * LoggingSender — structured-log stub.
 *
 * Logs the outbound notification at INFO level with full message context
 * so engineers can verify pipeline correctness without connecting a real
 * provider.  Always returns `{ success: true }`.
 *
 * Replace this with a real provider implementation (Twilio, SES, FCM)
 * when PHI-safe channels are approved.
 */
class LoggingSender implements NotificationSender {
  async send(
    channel: string,
    address: string,
    body: string,
    subject?: string | null,
    metadata?: Record<string, unknown>,
  ): Promise<SendResult> {
    logger.info(
      {
        sender: 'LoggingSender',
        channel,
        // Mask address in logs to avoid PHI leakage in log aggregators.
        // Only the last 4 chars are surfaced for debugging.
        addressTail: address.length > 4 ? `***${address.slice(-4)}` : '***',
        subject: subject ?? null,
        bodyLength: body.length,
        ...(metadata ?? {}),
      },
      '[notifications] [stub] would send notification via %s',
      channel,
    )
    return { success: true }
  }
}

/**
 * The default sender used by `notificationsDispatcher`.
 *
 * Swap for a real provider by replacing this export (or by injecting via
 * an environment-keyed factory once a real provider is approved).
 */
export const defaultSender: NotificationSender = new LoggingSender()
