import { Router, type Request, type Response } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { env } from '../../shared/config/env.js'
import { logger } from '../../shared/utils/logger.js'

export const placesRouter: Router = Router()

// ---------------------------------------------------------------------------
// In-memory TTL cache (Phase 1; Redis is the documented future follow-up).
// Keyed by the full query string for autocomplete, by place_id for details.
// ---------------------------------------------------------------------------
const CACHE_TTL_MS = 5 * 60 * 1_000 // 5 minutes

interface CacheEntry<T> {
  value: T
  expiresAt: number
}

function makeCache<T>() {
  const store = new Map<string, CacheEntry<T>>()
  return {
    get(key: string): T | undefined {
      const entry = store.get(key)
      if (!entry) return undefined
      if (Date.now() > entry.expiresAt) {
        store.delete(key)
        return undefined
      }
      return entry.value
    },
    set(key: string, value: T): void {
      store.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS })
    },
  }
}

const autocompleteCache = makeCache<unknown>()
const detailsCache = makeCache<unknown>()

// ---------------------------------------------------------------------------
// Per-IP rate limiter: 60 autocomplete requests / minute per IP.
// Phase 1 in-process store; documented as Redis-deferred in risks.md H3.
// ---------------------------------------------------------------------------
const autocompleteLimiter = rateLimit({
  windowMs: 60 * 1_000, // 1 minute
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests', code: 'RATE_LIMITED' },
})

const GOOGLE_PLACES_API_BASE = 'https://maps.googleapis.com/maps/api/place'

interface GooglePlacesAutocompleteResponse {
  predictions: Array<{
    place_id: string
    description: string
    structured_formatting?: {
      main_text: string
      secondary_text: string
    }
  }>
  status: string
  error_message?: string
}

interface GooglePlacesDetailsResponse {
  result?: {
    place_id: string
    formatted_address: string
    address_components: Array<{
      long_name: string
      short_name: string
      types: string[]
    }>
    geometry?: {
      location: { lat: number; lng: number }
    }
  }
  status: string
  error_message?: string
}

export interface AddressComponents {
  streetAddress: string
  barangay: string
  city: string
  province: string
  region: string
}

function parseAddressComponents(
  components: Array<{ long_name: string; short_name: string; types: string[] }>,
): AddressComponents {
  const streetNumber = findComponent(components, 'street_number') ?? ''
  const route = findComponent(components, 'route') ?? ''
  const sublocality = findComponent(components, 'sublocality_level_1') ?? ''
  const barangay = findComponent(components, 'administrative_area_level_4') ?? sublocality
  const city =
    findComponent(components, 'administrative_area_level_3') ??
    findComponent(components, 'locality') ??
    ''
  const province =
    findComponent(components, 'administrative_area_level_2') ??
    findComponent(components, 'administrative_area_level_1') ??
    ''
  const region = findComponent(components, 'administrative_area_level_1') ?? ''

  const streetParts = [streetNumber, route].filter(Boolean)
  const streetAddress = streetParts.length > 0 ? streetParts.join(' ') : ''

  return { streetAddress, barangay, city, province, region }
}

function findComponent(
  components: Array<{ long_name: string; types: string[] }>,
  type: string,
): string | null {
  const c = components.find((c) => c.types.includes(type))
  return c?.long_name ?? null
}

const autocompleteQuerySchema = z.object({
  input: z.string().min(1).max(200),
  sessiontoken: z.string().max(200).optional(),
})

placesRouter.get('/autocomplete', autocompleteLimiter, async (req: Request, res: Response) => {
  if (!env.GOOGLE_PLACES_API_KEY) {
    res.status(503).json({ error: 'Places API not configured', code: 'SERVICE_UNAVAILABLE' })
    return
  }

  const parsed = autocompleteQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten(),
    })
    return
  }

  const { input, sessiontoken } = parsed.data

  // Cache key is the normalised input (lower-cased, trimmed); sessiontoken is
  // per-session billing sugar and must NOT be part of the cache key.
  const cacheKey = input.trim().toLowerCase()
  const cached = autocompleteCache.get(cacheKey)
  if (cached) {
    res.json(cached)
    return
  }

  const params = new URLSearchParams({
    input,
    key: env.GOOGLE_PLACES_API_KEY,
    components: 'country:ph',
    language: 'en',
  })
  if (sessiontoken) params.set('sessiontoken', sessiontoken)

  try {
    const resp = await fetch(`${GOOGLE_PLACES_API_BASE}/autocomplete/json?${params}`, {
      signal: AbortSignal.timeout(5000),
    })
    const data: GooglePlacesAutocompleteResponse = await resp.json()

    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      logger.warn(
        { status: data.status, error: data.error_message },
        'Google Places autocomplete error',
      )
      res.status(502).json({ error: 'Places API error', code: 'UPSTREAM_ERROR' })
      return
    }

    const predictions = (data.predictions ?? []).map((p) => ({
      placeId: p.place_id,
      description: p.description,
      mainText: p.structured_formatting?.main_text ?? p.description,
      secondaryText: p.structured_formatting?.secondary_text ?? '',
    }))

    const body = { predictions }
    autocompleteCache.set(cacheKey, body)
    res.json(body)
  } catch (err) {
    logger.error({ err }, 'Google Places autocomplete fetch failed')
    res.status(502).json({ error: 'Places API unreachable', code: 'UPSTREAM_ERROR' })
  }
})

const detailsQuerySchema = z.object({
  place_id: z.string().min(1).max(500),
  sessiontoken: z.string().max(200).optional(),
})

placesRouter.get('/details', async (req: Request, res: Response) => {
  if (!env.GOOGLE_PLACES_API_KEY) {
    res.status(503).json({ error: 'Places API not configured', code: 'SERVICE_UNAVAILABLE' })
    return
  }

  const parsed = detailsQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten(),
    })
    return
  }

  const { place_id, sessiontoken } = parsed.data

  // place_id is stable — cache indefinitely within the TTL window.
  const cachedDetail = detailsCache.get(place_id)
  if (cachedDetail) {
    res.json(cachedDetail)
    return
  }

  const params = new URLSearchParams({
    place_id,
    key: env.GOOGLE_PLACES_API_KEY,
    fields: 'place_id,formatted_address,address_components,geometry',
    language: 'en',
  })
  if (sessiontoken) params.set('sessiontoken', sessiontoken)

  try {
    const resp = await fetch(`${GOOGLE_PLACES_API_BASE}/details/json?${params}`, {
      signal: AbortSignal.timeout(5000),
    })
    const data: GooglePlacesDetailsResponse = await resp.json()

    if (data.status !== 'OK') {
      logger.warn({ status: data.status, error: data.error_message }, 'Google Places details error')
      res.status(502).json({ error: 'Places API error', code: 'UPSTREAM_ERROR' })
      return
    }

    if (!data.result) {
      res.status(404).json({ error: 'Place not found', code: 'NOT_FOUND' })
      return
    }

    const components = parseAddressComponents(data.result.address_components)

    const body = {
      placeId: data.result.place_id,
      formattedAddress: data.result.formatted_address,
      components,
    }
    detailsCache.set(place_id, body)
    res.json(body)
  } catch (err) {
    logger.error({ err }, 'Google Places details fetch failed')
    res.status(502).json({ error: 'Places API unreachable', code: 'UPSTREAM_ERROR' })
  }
})
