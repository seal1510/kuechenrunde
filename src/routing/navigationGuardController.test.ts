import { describe, expect, it, vi } from 'vitest'
import {
  HISTORY_INDEX_KEY,
  NavigationGuardController,
  UNSAVED_CHANGES_QUESTION,
  readHistoryIndex,
  type NavigationHistoryLike,
  type NavigationPrompt,
} from './navigationGuardController'

class FakeHistory implements NavigationHistoryLike {
  state: unknown
  goCalls: number[] = []
  replaceCalls: Array<{ state: unknown; url?: string | null }> = []

  constructor(state: unknown = null) {
    this.state = state
  }

  replaceState(state: unknown, _title: string, url?: string | null): void {
    this.state = state
    this.replaceCalls.push({ state, url })
  }

  go(delta = 0): void {
    this.goCalls.push(delta)
  }
}

const EDITOR_HASH = '#/recipe/r1/edit'

function setup(options: { index?: number; hash?: string; indexed?: boolean } = {}) {
  const indexed = options.indexed ?? true
  const index = options.index ?? 1
  const history = new FakeHistory(indexed ? { [HISTORY_INDEX_KEY]: index } : null)
  const location = { hash: options.hash ?? EDITOR_HASH }
  const applyRoute = vi.fn()
  const onPromptChange = vi.fn<(prompt: NavigationPrompt | null) => void>()
  const controller = new NavigationGuardController({
    history,
    location,
    applyRoute,
    onPromptChange,
  })
  let dirty = true
  const unregister = controller.register(() => dirty)
  return {
    controller,
    history,
    location,
    applyRoute,
    onPromptChange,
    setDirty(value: boolean) {
      dirty = value
    },
    unregister,
  }
}

describe('navigation guard controller', () => {
  it('initialises unindexed entries without changing the history length', () => {
    const history = new FakeHistory(null)
    const controller = new NavigationGuardController({
      history,
      location: { hash: EDITOR_HASH },
      applyRoute: () => undefined,
      onPromptChange: () => undefined,
    })
    controller.register(() => false)

    expect(readHistoryIndex(history.state)).toBe(0)
    expect(history.replaceCalls).toHaveLength(1)
    expect(history.goCalls).toHaveLength(0)
  })

  it('allows unchanged navigation without a prompt', () => {
    const { controller, history, location, applyRoute, onPromptChange, setDirty } = setup({
      index: 1,
    })
    setDirty(false)
    history.state = { [HISTORY_INDEX_KEY]: 2 }
    location.hash = '#/plan'

    expect(controller.handleLocationChange()).toBe('applied')
    expect(applyRoute).toHaveBeenCalledWith('#/plan')
    expect(onPromptChange).not.toHaveBeenCalled()
    expect(readHistoryIndex(history.state)).toBe(2)
  })

  it('prompts before an internal link and applies it only after confirmation', () => {
    const { controller, history, location, applyRoute, onPromptChange } = setup({ index: 1 })
    const action = vi.fn(() => {
      location.hash = '#/plan'
    })

    expect(controller.shouldPromptFor('#/plan')).toBe(true)
    expect(controller.requestAction(action, '#/plan')).toBe('prompted')
    expect(action).not.toHaveBeenCalled()
    expect(onPromptChange).toHaveBeenLastCalledWith({
      question: UNSAVED_CHANGES_QUESTION,
      hash: '#/plan',
    })

    controller.confirmPending()
    expect(action).toHaveBeenCalledTimes(1)
    expect(onPromptChange).toHaveBeenLastCalledWith(null)

    history.state = null
    expect(controller.handleLocationChange()).toBe('applied')
    expect(applyRoute).toHaveBeenCalledWith('#/plan')
    expect(readHistoryIndex(history.state)).toBe(2)
  })

  it('keeps form data and the URL when an internal link is cancelled', () => {
    const { controller, location, history } = setup({ index: 1 })
    const action = vi.fn(() => {
      location.hash = '#/plan'
    })
    const formData = { title: 'Synthetisches Rezept', ingredients: ['Curry', 'Reis'] }

    controller.requestAction(action, '#/plan')
    controller.cancelPending()

    expect(action).not.toHaveBeenCalled()
    expect(location.hash).toBe(EDITOR_HASH)
    expect(history.goCalls).toHaveLength(0)
    expect(formData).toEqual({ title: 'Synthetisches Rezept', ingredients: ['Curry', 'Reis'] })
  })

  it('restores the editor entry when Back is cancelled and confirms without extra entries', () => {
    const { controller, history, location, applyRoute, onPromptChange } = setup({ index: 2 })

    history.state = { [HISTORY_INDEX_KEY]: 1 }
    location.hash = '#/plan'
    expect(controller.handleLocationChange()).toBe('prompted')
    expect(applyRoute).not.toHaveBeenCalled()

    controller.cancelPending()
    expect(history.goCalls).toEqual([1])

    history.state = { [HISTORY_INDEX_KEY]: 2 }
    location.hash = EDITOR_HASH
    expect(controller.handleLocationChange()).toBe('applied')
    expect(applyRoute).toHaveBeenLastCalledWith(EDITOR_HASH)
    expect(onPromptChange).toHaveBeenLastCalledWith(null)

    history.state = { [HISTORY_INDEX_KEY]: 1 }
    location.hash = '#/plan'
    expect(controller.handleLocationChange()).toBe('prompted')
    controller.confirmPending()
    expect(applyRoute).toHaveBeenLastCalledWith('#/plan')
    expect(readHistoryIndex(history.state)).toBe(1)
    expect(history.replaceCalls).toHaveLength(0)
  })

  it('handles Forward symmetrically without adding history entries', () => {
    const { controller, history, location, applyRoute } = setup({ index: 0 })

    history.state = { [HISTORY_INDEX_KEY]: 1 }
    location.hash = '#/plan'
    expect(controller.handleLocationChange()).toBe('prompted')

    controller.cancelPending()
    expect(history.goCalls).toEqual([-1])

    history.state = { [HISTORY_INDEX_KEY]: 1 }
    location.hash = '#/plan'
    controller.handleLocationChange()
    controller.confirmPending()
    expect(applyRoute).toHaveBeenLastCalledWith('#/plan')
    expect(history.goCalls).toEqual([-1])
  })

  it('keeps one prompt during rapid Back presses and returns to the editor', () => {
    const { controller, history, location, onPromptChange } = setup({ index: 3 })

    history.state = { [HISTORY_INDEX_KEY]: 2 }
    location.hash = '#/plan'
    expect(controller.handleLocationChange()).toBe('prompted')

    history.state = { [HISTORY_INDEX_KEY]: 1 }
    location.hash = '#/shopping'
    expect(controller.handleLocationChange()).toBe('prompted')

    expect(onPromptChange.mock.calls.filter(([prompt]) => prompt !== null)).toHaveLength(1)
    controller.cancelPending()
    expect(history.goCalls).toEqual([2])
  })

  it('marks a new programmatic entry so Cancel can step back exactly once', () => {
    const { controller, history, location } = setup({ index: 1 })

    history.state = null
    location.hash = '#/plan'
    expect(controller.handleLocationChange()).toBe('prompted')
    expect(readHistoryIndex(history.state)).toBe(2)

    controller.cancelPending()
    expect(history.goCalls).toEqual([-1])

    history.state = { [HISTORY_INDEX_KEY]: 1 }
    location.hash = EDITOR_HASH
    expect(controller.handleLocationChange()).toBe('applied')
  })

  it('does not warn after a successful save or delete', () => {
    const { controller, history, location, applyRoute, onPromptChange } = setup({ index: 4 })

    controller.allowNextNavigation('#/recipe/r1')
    history.state = null
    location.hash = '#/recipe/r1'
    expect(controller.handleLocationChange()).toBe('applied')
    expect(applyRoute).toHaveBeenCalledWith('#/recipe/r1')
    expect(onPromptChange).not.toHaveBeenCalled()
    expect(readHistoryIndex(history.state)).toBe(5)
  })

  it('does not let a pending save bypass an unrelated route', () => {
    const { controller, history, location, applyRoute, onPromptChange } = setup({ index: 4 })

    controller.allowNextNavigation('#/recipe/r1')
    history.state = null
    location.hash = '#/plan'

    expect(controller.handleLocationChange()).toBe('prompted')
    expect(applyRoute).not.toHaveBeenCalled()
    expect(onPromptChange).toHaveBeenLastCalledWith({
      question: UNSAVED_CHANGES_QUESTION,
      hash: '#/plan',
    })
    expect(readHistoryIndex(history.state)).toBe(5)
  })

  it('opens only one prompt for repeated link attempts', () => {
    const { controller, onPromptChange } = setup({ index: 1 })
    const first = vi.fn()
    const second = vi.fn()

    expect(controller.requestAction(first, '#/plan')).toBe('prompted')
    expect(controller.requestAction(second, '#/shopping')).toBe('prompted')
    expect(first).not.toHaveBeenCalled()
    expect(second).not.toHaveBeenCalled()
    expect(onPromptChange.mock.calls.filter(([prompt]) => prompt !== null)).toHaveLength(1)

    controller.confirmPending()
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()
  })

  it('stops guarding after the editor unregisters', () => {
    const { controller, history, location, applyRoute, unregister, onPromptChange } = setup({
      index: 1,
    })
    unregister()
    history.state = { [HISTORY_INDEX_KEY]: 2 }
    location.hash = '#/plan'

    expect(controller.isDirty()).toBe(false)
    expect(controller.handleLocationChange()).toBe('applied')
    expect(applyRoute).toHaveBeenCalledWith('#/plan')
    expect(onPromptChange).not.toHaveBeenCalled()
  })
})
