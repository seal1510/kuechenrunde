import { describe, expect, it } from 'vitest'
import { emptyDraft } from './editor'
import {
  editorFingerprint,
  editorSaveState,
  hasEditorChanges,
  imageFingerprint,
} from './editorSession'

function syntheticDraft() {
  const draft = emptyDraft()
  draft.title = 'Synthetisches Curry'
  draft.cuisine = ['Indisch']
  draft.dishType = ['Curry']
  draft.tags = ['schnell']
  draft.ingredients = [
    {
      key: 'i1',
      id: 'i1',
      group: 'Curry',
      quantity: '1 1/2',
      unit: 'TL',
      name: 'Kurkuma',
      purchaseNote: 'Bio',
      preparationNote: 'gemahlen',
    },
  ]
  draft.steps = [
    {
      key: 's1',
      id: 's1',
      text: 'Die 1 1/2 TL Kurkuma in die Pfanne geben.',
      references: [
        {
          id: 'ref-1',
          ingredientId: 'i1',
          anchor: '1 1/2',
          anchorOffset: 4,
          quantity: { kind: 'full' },
        },
      ],
    },
  ]
  return draft
}

const images = [{ id: 'image-1' }, { id: 'image-2' }]

describe('editor session fingerprint', () => {
  it('stays clean until an editable field changes', () => {
    const draft = syntheticDraft()
    const baseline = editorFingerprint(draft, images)
    expect(hasEditorChanges(baseline, draft, images)).toBe(false)

    const edited = { ...draft, title: 'Synthetisches Curry, überarbeitet' }
    expect(hasEditorChanges(baseline, edited, images)).toBe(true)
  })

  it('detects ingredient groups, notes, category tags and step references', () => {
    const draft = syntheticDraft()
    const baseline = editorFingerprint(draft, images)
    const changed = structuredClone(draft)
    changed.ingredients[0]!.group = 'Gewürze'
    changed.ingredients[0]!.purchaseNote = 'Bio und fair'
    changed.tags = ['schnell', 'Gäste']
    changed.steps[0]!.references[0]!.quantity = { kind: 'partial', quantityText: '1' }

    expect(hasEditorChanges(baseline, changed, images)).toBe(true)
  })

  it('detects added, removed and reordered images', () => {
    const draft = syntheticDraft()
    const baseline = editorFingerprint(draft, images)

    expect(imageFingerprint(images)).not.toBe(imageFingerprint([...images, { id: 'image-3' }]))
    expect(hasEditorChanges(baseline, draft, [{ id: 'image-2' }, { id: 'image-1' }])).toBe(true)
    expect(hasEditorChanges(baseline, draft, images.slice(0, 1))).toBe(true)
  })

  it('does not call a loading editor dirty without a baseline', () => {
    expect(hasEditorChanges(null, syntheticDraft(), images)).toBe(false)
  })

  it('reports the visible save state', () => {
    expect(editorSaveState({ saving: true, dirty: true, isNew: false })).toBe('Speichere …')
    expect(editorSaveState({ saving: false, dirty: true, isNew: false })).toBe(
      'Ungespeicherte Änderungen',
    )
    expect(editorSaveState({ saving: false, dirty: false, isNew: true })).toBe('Neues Rezept')
    expect(editorSaveState({ saving: false, dirty: false, isNew: false })).toBe('Keine Änderungen')
  })
})
