import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { createRecall, getRecall, listRecalls } from '../../src/modules/product_recalls/db.js'
import { db } from '../../src/shared/db/index.js'
import { productRecalls, products, users } from '../../src/shared/db/schema.js'
import { withTenantTx } from '../../src/shared/db/withTenantTx.js'

describe('product-recall public IDs', () => {
  it('returns display IDs for related product, creator, and affected-lot branches', async () => {
    const [product] = await db
      .select({ displayId: products.displayId })
      .from(products)
      .where(eq(products.tenantId, 'SVX'))
      .limit(1)
    const [admin] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.tenantId, 'SVX'), eq(users.email, 'admin@surevax.com')))
      .limit(1)
    if (!product || !admin) throw new Error('seeded product and admin are required')

    const recallId = await createRecall({
      tenantId: 'SVX',
      userId: admin.id,
      productDisplayId: product.displayId,
      recallReason: 'Public display-ID integration coverage',
      recallSeverity: 'Class3',
      issuedAt: new Date('2099-12-31T00:00:00Z'),
      patientNotificationRequired: false,
    })

    try {
      const recalls = await listRecalls({
        tenantId: 'SVX',
        productDisplayId: product.displayId,
      })
      const linked = recalls.find((recall) => recall.id === recallId)

      expect(linked?.id).toMatch(/^RCL_[A-Z0-9]+$/)
      expect(linked?.productId).toBe(product.displayId)
      expect(linked).not.toHaveProperty('createdById')

      const detail = await getRecall('SVX', recallId)
      expect(detail).not.toBeNull()
      expect(detail?.productId).toBe(product.displayId)
      expect(detail).not.toHaveProperty('createdById')
      expect(detail?.createdBy).not.toHaveProperty('id')
      expect(detail?.createdBy?.displayId).toMatch(/^USR_[A-Z0-9]+$/)

      const seeded = (await listRecalls({ tenantId: 'SVX', active: true })).find(
        (recall) => recall.affectedLotsPattern === 'FLU-2026-',
      )
      expect(seeded?.id).toMatch(/^RCL_[A-Z0-9]+$/)
      const seededDetail = await getRecall('SVX', seeded!.id)
      expect(seededDetail?.affectedLots.length).toBeGreaterThan(0)
      for (const lot of seededDetail?.affectedLots ?? []) {
        expect(lot.id).toMatch(/^LOT_[A-Z0-9]+$/)
        expect(lot.branchId).toMatch(/^SVX\.[A-Z0-9]+$/)
      }
    } finally {
      await withTenantTx({ tenantId: 'SVX', userId: admin.id, branchId: null }, async (tx) => {
        await tx
          .delete(productRecalls)
          .where(and(eq(productRecalls.tenantId, 'SVX'), eq(productRecalls.displayId, recallId)))
      })
    }
  })
})
