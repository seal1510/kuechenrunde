import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { InviteSetupPage } from './InviteSetupPage'

describe('InviteSetupPage', () => {
  it('shows a friendly message for an expired or invalid invitation', () => {
    const html = renderToStaticMarkup(
      <InviteSetupPage
        redirect={{
          type: 'error',
          purpose: 'invite',
          message:
            'Der Einladungslink ist abgelaufen. Bitte den Betreiber um eine neue Einladung.',
        }}
      />,
    )
    expect(html).toContain('Einladung nicht verwendbar')
    expect(html).toContain('abgelaufen')
    expect(html).toContain('Zum Login')
    expect(html).not.toContain('access_token')
    expect(html).not.toContain('refresh_token')
  })
})
