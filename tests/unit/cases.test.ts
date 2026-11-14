import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { DueProofDatabase, setDbForTests } from '../../src/infrastructure/storage/db'
import {
  saveNewCase,
  listCases,
  getCase,
  updateCase,
  deleteCase,
} from '../../src/infrastructure/storage/case-repository'
import {
  createCase,
  renameCase,
  setCaseStatus,
  validateTitle,
  normalizeCurrency,
  TITLE_MAX,
} from '../../src/domain/cases/case'

/* Fresh database per test so tests stay independent. Each test gets a
 * uniquely named database; fake-indexeddb keeps named databases alive for the
 * process lifetime, so reusing one name would leak records between tests. */
let dbCounter = 0
beforeEach(() => {
  dbCounter += 1
  setDbForTests(new DueProofDatabase(`dueproof-test-${dbCounter}`))
})

describe('case domain validation', () => {
  it('accepts a valid case', () => {
    const result = createCase({
      id: 'id-1',
      title: '  Acme website invoice  ',
      description: 'Final payment for the redesign',
      currency: 'inr',
      createdAt: 1_000,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.case.title).toBe('Acme website invoice')
    expect(result.case.currency).toBe('INR')
    expect(result.case.status).toBe('active')
    expect(result.case.revision).toBe(1)
  })

  it('rejects an empty title with a field error', () => {
    const result = validateTitle('   ')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.field).toBe('title')
  })

  it('rejects a title that is too long', () => {
    const result = validateTitle('a'.repeat(TITLE_MAX + 1))
    expect(result.ok).toBe(false)
  })

  it('rejects unsupported currency and normalizes case', () => {
    expect(normalizeCurrency(' aud ').ok).toBe(false)
    const ok = normalizeCurrency(' usd ')
    expect(ok.ok).toBe(true)
    if (!ok.ok) return
    expect(ok.currency).toBe('USD')
  })

  it('rename bumps revision only when content changes', () => {
    const created = createCase({
      id: 'id-1',
      title: 'Acme retainer',
      description: '',
      currency: 'USD',
      createdAt: 1_000,
    })
    if (!created.ok) throw new Error('setup failed')

    const unchanged = renameCase(created.case, { title: 'Acme retainer', description: '' }, 2_000)
    expect(unchanged.ok && unchanged.case.revision).toBe(1)

    const changed = renameCase(created.case, { title: 'Acme retainer 2026', description: '' }, 2_000)
    expect(changed.ok && changed.case.revision).toBe(2)
  })

  it('archive toggles status and bumps revision', () => {
    const created = createCase({
      id: 'id-1',
      title: 'Acme retainer',
      description: '',
      currency: 'USD',
      createdAt: 1_000,
    })
    if (!created.ok) throw new Error('setup failed')
    const archived = setCaseStatus(created.case, 'archived', 2_000)
    expect(archived.ok && archived.case.status).toBe('archived')
    expect(archived.ok && archived.case.revision).toBe(2)
  })
})

describe('case repository (fake IndexedDB)', () => {
  it('creates and lists cases', async () => {
    const saved = await saveNewCase({
      title: 'Brochure project',
      description: 'Payment dispute on final milestone',
      currency: 'INR',
    })
    expect(saved.ok).toBe(true)

    const rows = await listCases()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.title).toBe('Brochure project')
  })

  it('orders the list by most recently updated', async () => {
    await saveNewCase({ title: 'Old case', description: '', currency: 'USD' })
    // ensure a later updatedAt for the second case
    const later = await saveNewCase({ title: 'New case', description: '', currency: 'USD' })
    if (!later.ok) throw new Error('setup failed')
    await updateCase({ ...later.case, revision: later.case.revision })

    const rows = await listCases()
    expect(rows[0]?.title).toBe('New case')
  })

  it('gets a case by id and returns null for missing ids', async () => {
    const saved = await saveNewCase({ title: 'Find me', description: '', currency: 'EUR' })
    if (!saved.ok) throw new Error('setup failed')

    const found = await getCase(saved.case.id)
    expect(found?.title).toBe('Find me')

    expect(await getCase('missing-id')).toBeNull()
  })

  it('filters active and archived cases', async () => {
    const a = await saveNewCase({ title: 'Active one', description: '', currency: 'USD' })
    const b = await saveNewCase({ title: 'Archived one', description: '', currency: 'USD' })
    if (!a.ok || !b.ok) throw new Error('setup failed')

    // Wait so updatedAt ordering is deterministic even within the same ms.
    await new Promise((resolve) => setTimeout(resolve, 5))

    const archived = setCaseStatus(b.case, 'archived', Date.now())
    if (!archived.ok) throw new Error('setup failed')
    await updateCase(archived.case)

    const active = await listCases({ status: 'active' })
    const archivedList = await listCases({ status: 'archived' })
    expect(active).toHaveLength(1)
    expect(archivedList).toHaveLength(1)
    expect(active[0]?.title).toBe('Active one')
    expect(archivedList[0]?.title).toBe('Archived one')
  })

  it('deletes a case', async () => {
    const saved = await saveNewCase({ title: 'Delete me', description: '', currency: 'GBP' })
    if (!saved.ok) throw new Error('setup failed')

    const result = await deleteCase(saved.case.id)
    expect(result.ok).toBe(true)
    expect(await getCase(saved.case.id)).toBeNull()
  })

  it('round-trips revision and timestamps without mutation', async () => {
    const saved = await saveNewCase({ title: 'Round trip', description: '', currency: 'INR' })
    if (!saved.ok) throw new Error('setup failed')

    const stored = await getCase(saved.case.id)
    expect(stored).toEqual(saved.case)
  })
})
