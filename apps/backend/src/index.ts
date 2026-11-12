import { app } from './app.js'
import { env } from './shared/config/env.js'
import { logger } from './shared/utils/logger.js'
import { startAnalyticsRefresh, stopAnalyticsRefresh } from './workers/analyticsRefresh.js'
import {
  startAuditPartitionRotate,
  stopAuditPartitionRotate,
} from './workers/auditPartitionRotate.js'
import {
  startDomainEventsPublisher,
  stopDomainEventsPublisher,
} from './workers/domainEventsPublisher.js'
import {
  startNotificationsDispatcher,
  stopNotificationsDispatcher,
} from './workers/notificationsDispatcher.js'
import {
  startPhiAccessLogRetention,
  stopPhiAccessLogRetention,
} from './workers/phiAccessLogRetention.js'
import { startTokenCleanup, stopTokenCleanup } from './workers/tokenCleanup.js'
import { startVerifyAuditChain, stopVerifyAuditChain } from './workers/verifyAuditChain.js'
import { checkDatabaseReadiness } from './shared/db/readiness.js'

const port = env.PORT

if (env.NODE_ENV === 'production') {
  const readiness = await checkDatabaseReadiness()
  if (!readiness.ready) {
    throw new Error(`Production startup refused: ${readiness.reason}`)
  }
}

const server = app.listen(port, () => {
  logger.info({ port, nodeEnv: env.NODE_ENV }, 'API server started')
})

// Workers are gated on WORKERS_ENABLED=true so dev/test environments don't
// spin up background loops unless explicitly opted in.
if (process.env.WORKERS_ENABLED === 'true') {
  startDomainEventsPublisher()
  startNotificationsDispatcher()
  startTokenCleanup()
  startPhiAccessLogRetention()
  startAuditPartitionRotate()
  startVerifyAuditChain()

  // Analytics refresh is additionally gated on ANALYTICS_REFRESH_ENABLED=true
  // because it depends on the analytics schema (migration 0008) being applied.
  if (process.env.ANALYTICS_REFRESH_ENABLED === 'true') {
    startAnalyticsRefresh()
  }
}

async function gracefulShutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Shutdown signal received — draining workers')
  await Promise.all([
    stopDomainEventsPublisher(),
    stopNotificationsDispatcher(),
    stopAnalyticsRefresh(),
    stopTokenCleanup(),
    stopPhiAccessLogRetention(),
    stopAuditPartitionRotate(),
    stopVerifyAuditChain(),
  ])
  server.close(() => {
    logger.info('HTTP server closed')
    process.exit(0)
  })
}

process.once('SIGTERM', () => void gracefulShutdown('SIGTERM'))
process.once('SIGINT', () => void gracefulShutdown('SIGINT'))
