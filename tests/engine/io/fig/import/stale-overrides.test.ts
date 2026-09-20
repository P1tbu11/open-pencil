import { expect, test } from 'bun:test'

import { openReaderSession } from '#core/kiwi/fig/session/reader'

import { readFixtureArrayBuffer } from '#tests/helpers/fig/fixtures'
import { HEAVY_TEST_TIMEOUT_MS, runsHeavyTests } from '#tests/helpers/test-utils'

// material3.fig retains overrides on 58114:20598 that address 57994:10133, a node the
// archive no longer contains. Figma keeps such records; opening the file must not.
test.if(runsHeavyTests)(
  'opening a file skips overrides against deleted nodes and reports them',
  () => {
    const reader = openReaderSession(readFixtureArrayBuffer('material3.fig'), 'all')
    const stale = reader.diagnostics.filter(
      (entry) =>
        (entry.kind === 'property' || entry.kind === 'assignment') &&
        entry.diagnostic.ownerId === '58114:20598' &&
        entry.diagnostic.reason === 'missing-target'
    )
    expect(stale.length).toBeGreaterThan(0)
    expect(reader.graph.getPages().length).toBeGreaterThan(1)
  },
  HEAVY_TEST_TIMEOUT_MS
)
