import { describe, expect, it } from 'vitest'
import {
  chooserBackStep,
  dishBackStep,
  freeDishBackStep,
} from './planningBack'

describe('planning dialog back navigation', () => {
  it('returns from the recipe picker to the shared chooser', () => {
    expect(dishBackStep('create', true, true)).toEqual({
      target: 'chooser',
      label: 'Zurück zu Hinzufügen',
      keepsDraft: false,
    })
  })

  it('returns from the planning form to the recipe picker and keeps the draft', () => {
    expect(dishBackStep('create', false, true)).toEqual({
      target: 'picker',
      label: 'Zurück zur Rezeptauswahl',
      keepsDraft: true,
    })
  })

  it('never invents an earlier step while editing an existing entry', () => {
    expect(dishBackStep('edit', true, true)).toBeNull()
    expect(dishBackStep('edit', false, true)).toBeNull()
    expect(freeDishBackStep('edit', true)).toBeNull()
  })

  it('offers no back action without a real previous step', () => {
    expect(dishBackStep('create', true, false)).toBeNull()
    expect(chooserBackStep(false)).toBeNull()
  })

  it('returns free dishes and new comments to the chooser', () => {
    expect(freeDishBackStep('create', true)).toEqual({
      target: 'chooser',
      label: 'Zurück zu Hinzufügen',
      keepsDraft: false,
    })
    expect(chooserBackStep(true)?.target).toBe('chooser')
  })
})
