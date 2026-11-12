import pino from 'pino'
import { env } from '../config/env.js'

// Pino logger with redaction of secrets that commonly appear in request/
// response objects. `remove: true` drops the field entirely instead of
// masking it, which avoids leaving telltale `[Redacted]` markers in logs.
export const logger = pino({
  transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'req.body.pin',
      // The staff kiosk PIN, sent under this name by the dose-administer path
      // and by every money surface that attests who took a payment. It is the
      // SAME credential as clock-in, so a PIN in a log is enough to attest a
      // dose or a payment as someone else. `req.body.pin` above does not cover
      // it: the field is literally named `attestationPin`.
      'req.body.attestationPin',
      '*.attestationPin',
      'req.body.password',
      'req.body.passwordHash',
      'req.body.token',
      'req.body.mfaSecret',
      '*.contactNumber',
      '*.address',
      '*.passwordHash',
      'res.headers["set-cookie"]',
    ],
    remove: true,
  },
})
