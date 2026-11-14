import { defineConfig } from 'vitest/config'

/**
 * Test configuration.
 *
 * Unit tests run in the Node environment; IndexedDB access is provided by
 * fake-indexeddb so persistence code can be tested without a browser.
 * Live AI calls are deliberately NOT part of this suite — model behavior,
 * quotas, latency, and on-device availability are validated separately and
 * recorded in the project context document, never faked in CI.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
