/**
 * Delivery boundary for high-priority, PHI-free security alerts.
 *
 * Keep this contract deliberately narrow. Callers must reduce an incident to
 * operational metadata before it reaches Sentry; raw errors, request bodies,
 * audit row content, credentials, and tenant/user data do not belong here.
 */
import * as Sentry from '@sentry/node'

export type AuditChainTamperAlert = Readonly<{
  kind: 'audit_chain_tamper'
  partition: string
  mismatchCount: number
  firstMismatchAuditId?: string
  firstMismatchTimestamp?: string
}>

export type AuditChainVerificationErrorAlert = Readonly<{
  kind: 'audit_chain_verification_error'
  partition: string
  errorName: string
  errorCode?: string
}>

export type SecurityAlert = AuditChainTamperAlert | AuditChainVerificationErrorAlert

export type SecurityAlertDelivery = Readonly<{
  eventId: string
}>

export interface SecurityAlertSink {
  deliver(alert: SecurityAlert): Promise<SecurityAlertDelivery>
}

type SecurityAlertContext = {
  level: 'error' | 'fatal'
  tags: Record<string, string>
  fingerprint: string[]
  contexts: {
    security_alert: Record<string, string | number>
  }
}

export interface SentrySecurityAlertClient {
  isConfigured(): boolean
  captureMessage(message: string, context: SecurityAlertContext): string
  flush(timeoutMs: number): Promise<boolean>
}

export class SecurityAlertDeliveryError extends Error {
  readonly code: 'NOT_CONFIGURED' | 'CAPTURE_FAILED' | 'FLUSH_FAILED'

  constructor(code: SecurityAlertDeliveryError['code']) {
    super('Security alert delivery failed')
    this.name = 'SecurityAlertDeliveryError'
    this.code = code
  }
}

const sentryClient: SentrySecurityAlertClient = {
  isConfigured: () => Sentry.getClient() !== undefined,
  captureMessage: (message, context) => Sentry.captureMessage(message, context),
  flush: (timeoutMs) => Sentry.flush(timeoutMs),
}

function alertContext(alert: SecurityAlert): SecurityAlertContext {
  const securityAlert: Record<string, string | number> = {
    kind: alert.kind,
    partition: alert.partition,
  }

  if (alert.kind === 'audit_chain_tamper') {
    securityAlert.mismatch_count = alert.mismatchCount
    if (alert.firstMismatchAuditId !== undefined) {
      securityAlert.first_mismatch_audit_id = alert.firstMismatchAuditId
    }
    if (alert.firstMismatchTimestamp !== undefined) {
      securityAlert.first_mismatch_timestamp = alert.firstMismatchTimestamp
    }
  } else {
    securityAlert.error_name = alert.errorName
    if (alert.errorCode !== undefined) securityAlert.error_code = alert.errorCode
  }

  return {
    level: alert.kind === 'audit_chain_tamper' ? 'fatal' : 'error',
    tags: {
      security_alert_kind: alert.kind,
      security_component: 'audit_chain',
      audit_partition: alert.partition,
    },
    fingerprint: ['surevax-security-alert', alert.kind, alert.partition],
    contexts: { security_alert: securityAlert },
  }
}

export function createSentrySecurityAlertSink(options?: {
  client?: SentrySecurityAlertClient
  flushTimeoutMs?: number
}): SecurityAlertSink {
  const client = options?.client ?? sentryClient
  const flushTimeoutMs = options?.flushTimeoutMs ?? 2_000

  return {
    async deliver(alert) {
      if (!client.isConfigured()) throw new SecurityAlertDeliveryError('NOT_CONFIGURED')

      let eventId: string
      try {
        eventId = client.captureMessage(
          alert.kind === 'audit_chain_tamper'
            ? 'Audit chain tamper detected'
            : 'Audit chain verification failed',
          alertContext(alert),
        )
        if (eventId.length === 0) throw new SecurityAlertDeliveryError('CAPTURE_FAILED')
      } catch {
        throw new SecurityAlertDeliveryError('CAPTURE_FAILED')
      }

      try {
        if (!(await client.flush(flushTimeoutMs))) {
          throw new SecurityAlertDeliveryError('FLUSH_FAILED')
        }
      } catch (error) {
        if (error instanceof SecurityAlertDeliveryError) throw error
        throw new SecurityAlertDeliveryError('FLUSH_FAILED')
      }

      return { eventId }
    },
  }
}

export const securityAlertSink = createSentrySecurityAlertSink()
