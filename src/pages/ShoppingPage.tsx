/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The shopping list is a calm, compact checklist. Recipe demand is recomputed
 * from the actual cooking events on every Dexie change. Manual articles,
 * purchase actions, learned corrections and the category order are the only
 * stored shopping data. The discontinued pantry feature has no UI and no
 * persistence here.
 */

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { formatDayLabel, todayKey, WEEKDAY_NAMES, weekdayName } from '../domain/dates'
import {
  categoryLabel,
  categoryOrderWithMove,
  editableShoppingAmount,
  formatShoppingAmount,
  groupOpenItems,
  parsePurchaseAmountInput,
  parseShoppingQuantityPosition,
  quantityDimensionLabel,
  SHOPPING_CATEGORIES,
  shoppingIdentityMappings,
  shoppingItemKey,
  shoppingPositionSignature,
  splitIngredientName,
  type ShoppingCategoryId,
  type ShoppingListItem,
} from '../domain/shopping'
import {
  periodStartDayForDate,
  resolveShoppingPeriodResolution,
} from '../domain/shoppingLists'
import { buildShoppingPeriodView } from '../shopping/periodView'
import {
  adjacentShoppingPeriodStart,
  applyShoppingCycleChange,
  previewShoppingCycleChange,
  type ShoppingCycleChangePreview,
} from '../shopping/cycle'
import {
  shoppingSettingsFromRows,
  type ShoppingSettings,
} from '../settings/shopping'
import {
  addShoppingPurchase,
  categoryOrderFromRows,
  clearLegacyQuantity,
  mergeShoppingProducts,
  removeQuantityCorrection,
  removeShoppingPurchase,
  resolveAmbiguousRule,
  restoreManualItem,
  saveCategoryOrder,
  saveItemRule,
  saveQuantityCorrection,
  splitShoppingProduct,
  updateManualItem,
  type ItemRuleInput,
} from '../shopping/service'
import {
  createManualListItem,
  ensureStandardShoppingList,
  removeManualListItem,
} from '../shopping/listService'
import type {
  ShoppingItemRule,
  ShoppingManualItem,
  ShoppingPurchase,
} from '../types'

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Die Aktion konnte nicht ausgeführt werden.'
}

function formatAmounts(positions: ShoppingListItem['positions']): string {
  return positions.map((position) => formatShoppingAmount(position)).join(' · ')
}

function amountSummary(item: ShoppingListItem): string {
  if (item.unparsedAmounts.length > 0) {
    return [...item.unparsedAmounts, ...item.positions.map(formatShoppingAmount)]
      .filter(Boolean)
      .join(' · ')
  }
  return formatAmounts(item.positions)
}

function Modal({
  label,
  className,
  onClose,
  children,
}: {
  label: string
  className?: string
  onClose: () => void
  children: ReactNode
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className={`modal shopping-modal${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm8.2-3.5c0-.5-.05-1-.14-1.47l2.02-1.58-1.9-3.3-2.38.96a8.2 8.2 0 0 0-2.54-1.47L14.9 2.5h-3.8l-.36 2.64A8.2 8.2 0 0 0 8.2 6.61L5.82 5.65l-1.9 3.3 2.02 1.58a8.5 8.5 0 0 0 0 2.94l-2.02 1.58 1.9 3.3 2.38-.96a8.2 8.2 0 0 0 2.54 1.47l.36 2.64h3.8l.36-2.64a8.2 8.2 0 0 0 2.54-1.47l2.38.96 1.9-3.3-2.02-1.58c.09-.47.14-.97.14-1.47Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m6.5 6.5 11 11m0-11-11 11" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

export function ShoppingPage() {
  const today = useMemo(() => todayKey(), [])
  const [periodAnchor, setPeriodAnchor] = useState(today)
  const [addOpen, setAddOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [confirmingKey, setConfirmingKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [undoItem, setUndoItem] = useState<ShoppingManualItem | null>(null)
  const addTriggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const recipes = useLiveQuery(() => db.recipes.toArray(), [])
  const freeDishes = useLiveQuery(() => db.freeDishes.toArray(), [])
  const cookSessions = useLiveQuery(() => db.cookSessions.toArray(), [])
  const manualItems = useLiveQuery(() => db.shoppingManualItems.toArray(), [])
  const purchases = useLiveQuery(() => db.shoppingPurchases.toArray(), [])
  const rules = useLiveQuery(() => db.shoppingItemRules.toArray(), [])
  const quantityCorrections = useLiveQuery(
    () => db.shoppingQuantityCorrections.toArray(),
    [],
  )
  const settingsRows = useLiveQuery(() => db.settings.toArray(), [])
  const shoppingLists = useLiveQuery(() => db.shoppingLists.toArray(), [])

  const categoryOrder = useMemo(
    () => categoryOrderFromRows(settingsRows ?? []),
    [settingsRows],
  )
  const shoppingSettings = useMemo(
    () => shoppingSettingsFromRows(settingsRows ?? []),
    [settingsRows],
  )
  const periodResolution = useMemo(
    () =>
      resolveShoppingPeriodResolution(
        periodAnchor,
        shoppingSettings,
        shoppingLists ?? [],
      ),
    [periodAnchor, shoppingSettings, shoppingLists],
  )
  const period = periodResolution.period
  const periodConflict = periodResolution.conflict
  const view = useMemo(
    () =>
      buildShoppingPeriodView({
        period,
        recipes: periodConflict ? [] : recipes ?? [],
        freeDishes: periodConflict ? [] : freeDishes ?? [],
        cookSessions: periodConflict ? [] : cookSessions ?? [],
        manualItems: periodConflict ? [] : manualItems ?? [],
        purchases: periodConflict ? [] : purchases ?? [],
        lists: shoppingLists ?? [],
        rules: rules ?? [],
        quantityCorrections: quantityCorrections ?? [],
        today,
      }),
    [
      period,
      periodConflict,
      recipes,
      freeDishes,
      cookSessions,
      manualItems,
      purchases,
      shoppingLists,
      rules,
      quantityCorrections,
      today,
    ],
  )
  const list = view.list
  const conflicts = view.conflicts
  const conflictLabels = useMemo(() => {
    const labels = [
      ...conflicts.manualItems.map((item) => item.name),
      ...conflicts.purchases.map((purchase) => purchase.itemKey),
    ]
    return Array.from(new Set(labels))
  }, [conflicts])

  const openGroups = useMemo(
    () => groupOpenItems(list.items, categoryOrder),
    [list.items, categoryOrder],
  )
  const doneItems = list.items.filter((item) => item.status === 'done')
  const editingItem = list.items.find((item) => item.key === editingKey) ?? null
  const ambiguousRuleTargets = useMemo(() => {
    const names: string[] = []
    for (const recipe of recipes ?? []) {
      for (const ingredient of recipe.ingredients) names.push(ingredient.name)
    }
    for (const freeDish of freeDishes ?? []) {
      for (const ingredient of freeDish.ingredients) names.push(ingredient.name)
    }
    for (const manual of manualItems ?? []) names.push(manual.name)
    return shoppingIdentityMappings(names)
  }, [recipes, freeDishes, manualItems])
  const ambiguousRulesForEditing = useMemo(
    () =>
      editingItem
        ? (rules ?? []).filter(
            (rule) =>
              rule.legacyAmbiguous &&
              ambiguousRuleTargets.candidates.get(rule.key)?.has(editingItem.key),
          )
        : [],
    [editingItem, rules, ambiguousRuleTargets],
  )
  const confirmingItem = list.items.find((item) => item.key === confirmingKey) ?? null

  const loading =
    recipes === undefined ||
    freeDishes === undefined ||
    cookSessions === undefined ||
    manualItems === undefined ||
    purchases === undefined ||
    rules === undefined ||
    quantityCorrections === undefined ||
    settingsRows === undefined ||
    shoppingLists === undefined

  async function run(action: () => Promise<unknown>) {
    try {
      setError(null)
      await action()
    } catch (caught) {
      setError(errorText(caught))
    }
  }

  async function addArticle(input: {
    name: string
    quantityText: string
    unit: string
    purchaseNote: string
    categoryId: string | null
  }): Promise<boolean> {
    try {
      setError(null)
      const list = await ensureStandardShoppingList(period.start)
      await createManualListItem({
        listId: list.id,
        shoppingDate: period.start,
        name: input.name,
        quantityText: input.quantityText,
        unit: input.unit,
        purchaseNote: input.purchaseNote,
        categoryId: input.categoryId,
      })
      closeAdd(true)
      return true
    } catch (caught) {
      setError(errorText(caught))
      return false
    }
  }

  function closeAdd(focusList = false) {
    setAddOpen(false)
    if (typeof window === 'undefined') return
    window.requestAnimationFrame(() => {
      const firstRow = listRef.current?.querySelector<HTMLButtonElement>('.shopping-row-main')
      if (focusList && firstRow) firstRow.focus()
      else addTriggerRef.current?.focus()
    })
  }

  async function toggleItem(item: ShoppingListItem) {
    if (item.status === 'done') {
      const latest = item.purchases[0]
      if (!latest) return
      await run(() => removeShoppingPurchase(latest.id))
      return
    }
    const hasRange = item.positions.some((position) => position.lower !== position.upper)
    if (hasRange) {
      setConfirmingKey(item.key)
      return
    }
    await run(async () => {
      const amounts = item.positions.map((position) => ({
        dimension: position.dimension,
        lower: position.lower,
        upper: position.upper,
      }))
      await addShoppingPurchase({
        shoppingDate: period.start,
        itemKey: item.key,
        amounts,
        snapshot: item.requiredPositions,
        confirmedTotal: [...item.purchased, ...amounts],
        qualitative: item.positions.length === 0,
      })
    })
  }

  async function confirmRange(item: ShoppingListItem, values: Map<string, string>) {
    const amounts = item.positions.map((position) => {
      if (position.lower === position.upper) {
        return {
          dimension: position.dimension,
          lower: position.lower,
          upper: position.upper,
        }
      }
      const amount = parsePurchaseAmountInput(values.get(position.dimension) ?? '', position)
      return amount === null
        ? null
        : { dimension: position.dimension, lower: amount, upper: amount }
    })
    if (amounts.some((entry) => entry === null)) {
      setError('Bitte die tatsächlich gekaufte Menge für den Bereich angeben.')
      return
    }
    const confirmed = amounts.filter(
      (entry): entry is { dimension: string; lower: number; upper: number } => entry !== null,
    )
    await run(async () => {
      await addShoppingPurchase({
        shoppingDate: period.start,
        itemKey: item.key,
        amounts: confirmed,
        snapshot: item.requiredPositions,
        confirmedTotal: [...item.purchased, ...confirmed],
        qualitative: false,
      })
      setConfirmingKey(null)
    })
  }

  async function removeManual(item: ShoppingManualItem) {
    await run(async () => {
      await removeManualListItem(item.id)
      setUndoItem(item)
    })
  }

  function moveCategory(id: ShoppingCategoryId, direction: -1 | 1) {
    void run(async () => {
      await saveCategoryOrder(categoryOrderWithMove(categoryOrder, id, direction))
    })
  }

  function splitAlias(aliasKey: string) {
    const confirmed =
      typeof window === 'undefined' ||
      window.confirm(
        'Zuordnung trennen? Bereits gekaufte Mengen bleiben beim bisherigen Artikel.',
      )
    if (!confirmed) return
    void run(async () => {
      await splitShoppingProduct(aliasKey)
      setEditingKey(null)
    })
  }

  return (
    <div className="page shopping-page">
      <header className="shopping-head">
        <div>
          <h1>Einkaufsliste</h1>
          {!loading ? (
            <p className="shopping-subline">
              {list.items.length === 0
                ? 'Noch nichts eingetragen'
                : list.counts.open === 0
                  ? 'Alles erledigt'
                  : `${list.counts.open} Artikel offen${
                      doneItems.length > 0 ? ` · ${doneItems.length} erledigt` : ''
                    }`}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          className="shopping-add-trigger"
          ref={addTriggerRef}
          onClick={() => {
            setError(null)
            setAddOpen((open) => !open)
          }}
          aria-expanded={addOpen}
        >
          <span aria-hidden="true">+</span> Artikel hinzufügen
        </button>
      </header>

      <div className="shopping-toolbar">
        <div className="shopping-weeknav" role="group" aria-label="Einkaufsperiode wechseln">
          <button
            type="button"
            className="shopping-nav-button"
            aria-label="Vorherige Einkaufsperiode"
            onClick={() => {
              if (periodConflict) return
              setPeriodAnchor(
                adjacentShoppingPeriodStart(
                  period.start,
                  -1,
                  shoppingSettings,
                  shoppingLists ?? [],
                ),
              )
            }}
          >
            ‹
          </button>
          <span className="shopping-week-label" aria-live="polite">
            {period.label}
          </span>
          <button
            type="button"
            className="shopping-nav-button"
            aria-label="Nächste Einkaufsperiode"
            onClick={() => {
              if (periodConflict) return
              setPeriodAnchor(
                adjacentShoppingPeriodStart(
                  period.start,
                  1,
                  shoppingSettings,
                  shoppingLists ?? [],
                ),
              )
            }}
          >
            ›
          </button>
        </div>
        <div className="shopping-toolbar-end">
          <button
            type="button"
            className="shopping-today"
            onClick={() => setPeriodAnchor(today)}
          >
            Heute
          </button>
          <button
            type="button"
            className="shopping-icon-button"
            aria-label="Einstellungen"
            onClick={() => setSettingsOpen(true)}
          >
            <GearIcon />
          </button>
        </div>
      </div>

      {error ? (
        <p className="notice danger shopping-notice" role="alert">
          {error}
        </p>
      ) : null}

      {periodConflict ? (
        <div className="notice danger shopping-notice" role="alert">
          <strong>Einkaufsperioden überlappen sich.</strong> Für{' '}
          {formatDayLabel(periodConflict.date)} sind mehrere Standardzettel
          zugeordnet ({periodConflict.listIds.join(', ')}). Die Einkaufsliste wird
          bis zur eindeutigen Zuordnung nicht berechnet.
        </div>
      ) : null}

      {conflicts.total > 0 ? (
        <div className="notice shopping-notice shopping-conflict-note" role="status">
          <strong>Einkaufszuordnung unklar.</strong>{' '}
          {conflicts.total === 1
            ? '1 Eintrag wird nicht als gekauft gewertet.'
            : `${conflicts.total} Einträge werden nicht als gekauft gewertet.`}{' '}
          {conflictLabels.length > 0
            ? `Betroffen: ${conflictLabels.slice(0, 4).join(', ')}${
                conflictLabels.length > 4 ? ' …' : ''
              }. `
            : ''}
          Bitte die Zuordnung prüfen.
        </div>
      ) : null}

      {list.warnings.length > 0 ? (
        <div className="notice shopping-notice shopping-warnings">
          <ul>
            {list.warnings.slice(0, 3).map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
            {list.warnings.length > 3 ? (
              <li>Weitere {list.warnings.length - 3} Hinweis(e).</li>
            ) : null}
          </ul>
        </div>
      ) : null}

      {addOpen ? (
        <AddArticleForm onAdd={addArticle} onClose={() => closeAdd(false)} />
      ) : null}

      {undoItem ? (
        <div className="shopping-undo" role="status">
          <span>„{undoItem.name}“ wurde entfernt.</span>
          <button
            type="button"
            className="shopping-text-action"
            onClick={() =>
              void run(async () => {
                await restoreManualItem(undoItem)
                setUndoItem(null)
              })
            }
          >
            Rückgängig
          </button>
          <button
            type="button"
            className="shopping-icon-button shopping-undo-close"
            aria-label="Hinweis schließen"
            onClick={() => setUndoItem(null)}
          >
            <CloseIcon />
          </button>
        </div>
      ) : null}

      {loading ? <p className="muted">Einkaufsliste wird geladen …</p> : null}

      {!loading && list.items.length === 0 ? (
        <div className="empty-state shopping-empty">
          <h2>Noch nichts zu kaufen</h2>
          <p>
            Geplante Gerichte erscheinen hier automatisch. Artikel kannst du auch direkt
            eintragen.
          </p>
        </div>
      ) : null}

      {openGroups.length > 0 ? (
        <div className="shopping-groups" ref={listRef}>
          {openGroups.map((group) => (
            <section className="shopping-group" key={group.category.id}>
              <h2 className="shopping-group-title">
                <span>{group.category.label}</span>
                <span className="shopping-group-count" aria-hidden="true">
                  {group.items.length}
                </span>
              </h2>
              <ul className="shopping-list">
                {group.items.map((item) => (
                  <ShoppingRow
                    key={item.key}
                    item={item}
                    onToggle={() => void toggleItem(item)}
                    onEdit={() => setEditingKey(item.key)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : null}

      {!loading && doneItems.length > 0 ? (
        <details className="shopping-done">
          <summary>
            <span>Erledigt</span>
            <span className="shopping-done-count">{doneItems.length}</span>
          </summary>
          <ul className="shopping-list shopping-done-list">
            {doneItems.map((item) => (
              <ShoppingRow
                key={item.key}
                item={item}
                done
                onToggle={() => void toggleItem(item)}
                onEdit={() => setEditingKey(item.key)}
              />
            ))}
          </ul>
        </details>
      ) : null}

      {editingItem ? (
        <ItemEditorDialog
          key={editingItem.key}
          item={editingItem}
          allItems={list.items}
          shoppingDate={period.start}
          ambiguousRules={ambiguousRulesForEditing}
          onClose={() => setEditingKey(null)}
          onRemoveManual={removeManual}
          onSplit={splitAlias}
          onError={setError}
        />
      ) : null}

      {confirmingItem ? (
        <PurchaseConfirmDialog
          key={confirmingItem.key}
          item={confirmingItem}
          onCancel={() => setConfirmingKey(null)}
          onConfirm={(values) => void confirmRange(confirmingItem, values)}
        />
      ) : null}

      {settingsOpen ? (
        <SettingsDialog
          order={categoryOrder}
          settings={shoppingSettings}
          onMove={moveCategory}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
    </div>
  )
}

interface ShoppingRowProps {
  item: ShoppingListItem
  done?: boolean
  onToggle: () => void
  onEdit: () => void
}

function ShoppingRow({ item, done = false, onToggle, onEdit }: ShoppingRowProps) {
  const openAmount = amountSummary(item)
  const purchasedAmount = formatAmounts(item.purchased)
  const amount = done ? purchasedAmount || openAmount : openAmount
  const notes = item.purchaseNotes
  const partialText =
    !done && item.purchased.length > 0 && purchasedAmount
      ? `bereits gekauft: ${purchasedAmount}`
      : ''
  const secondary = [
    item.variant ? `Variante: ${item.variant}` : '',
    ...notes,
    partialText,
  ].filter(Boolean)
  const hasNote = secondary.length > 0
  const accessibleName = item.variant ? `${item.name}, ${item.variant}` : item.name

  return (
    <li className={`shopping-row${done ? ' is-done' : ''}`}>
      <label className="shopping-check">
        <input
          type="checkbox"
          checked={done}
          onChange={onToggle}
          aria-label={`${accessibleName} ${done ? 'wieder auf die Liste' : 'abhaken'}`}
        />
        <span className="shopping-check-box" aria-hidden="true" />
      </label>
      <button
        type="button"
        className="shopping-row-main"
        onClick={onEdit}
        aria-label={`${accessibleName}${amount ? `, ${amount}` : ''} bearbeiten`}
      >
        <span className="shopping-row-text">
          <span className="shopping-row-name">{item.name}</span>
          {hasNote ? (
            <span className="shopping-row-note">{secondary.join(' · ')}</span>
          ) : null}
        </span>
        {amount ? <span className="shopping-row-amount">{amount}</span> : null}
        <span className="shopping-row-edit" aria-hidden="true">
          <span className="shopping-row-edit-icon">✎</span>
        </span>
      </button>
    </li>
  )
}

interface AddArticleFormProps {
  onAdd: (input: {
    name: string
    quantityText: string
    unit: string
    purchaseNote: string
    categoryId: string | null
  }) => Promise<boolean>
  onClose: () => void
}

function AddArticleForm({ onAdd, onClose }: AddArticleFormProps) {
  const [name, setName] = useState('')
  const [quantityText, setQuantityText] = useState('')
  const [unit, setUnit] = useState('')
  const [purchaseNote, setPurchaseNote] = useState('')
  const [categoryId, setCategoryId] = useState<'' | ShoppingCategoryId>('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    const success = await onAdd({
      name,
      quantityText,
      unit,
      purchaseNote,
      categoryId: categoryId || null,
    })
    if (!success) setBusy(false)
  }

  return (
    <form className="shopping-add-panel" onSubmit={(event) => void submit(event)}>
      <div className="shopping-panel-head">
        <div>
          <h2>Artikel hinzufügen</h2>
          <p className="shopping-panel-subline">Nur für diese Einkaufswoche.</p>
        </div>
        <button type="button" className="shopping-icon-button" aria-label="Schließen" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
      <div className="shopping-add-grid">
        <label className="shopping-field shopping-add-name">
          <span>Artikel</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="z. B. Milch"
            autoFocus
            required
          />
        </label>
        <label className="shopping-field">
          <span>Menge</span>
          <input
            value={quantityText}
            onChange={(event) => setQuantityText(event.target.value)}
            placeholder="optional"
            inputMode="decimal"
          />
        </label>
        <label className="shopping-field">
          <span>Einheit</span>
          <input
            value={unit}
            onChange={(event) => setUnit(event.target.value)}
            placeholder="optional"
          />
        </label>
        <label className="shopping-field">
          <span>Kategorie</span>
          <select
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value as '' | ShoppingCategoryId)}
          >
            <option value="">Automatisch</option>
            {SHOPPING_CATEGORIES.map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
          </select>
        </label>
        <label className="shopping-field shopping-add-note">
          <span>Einkaufshinweis</span>
          <input
            value={purchaseNote}
            onChange={(event) => setPurchaseNote(event.target.value)}
            placeholder="optional"
          />
        </label>
      </div>
      <div className="shopping-panel-actions">
        <button type="submit" className="button primary" disabled={busy || !name.trim()}>
          Hinzufügen
        </button>
        <button type="button" className="button quiet" onClick={onClose} disabled={busy}>
          Abbrechen
        </button>
      </div>
    </form>
  )
}

interface ItemEditorDialogProps {
  item: ShoppingListItem
  allItems: readonly ShoppingListItem[]
  /** Stable date inside the visible shopping week for quantity corrections. */
  shoppingDate: string
  /** Ambiguous legacy rules that could belong to this exact variant. */
  ambiguousRules: readonly ShoppingItemRule[]
  onClose: () => void
  onRemoveManual: (item: ShoppingManualItem) => Promise<void>
  onSplit: (aliasKey: string) => void
  onError: (message: string) => void
}

function singleManualItem(item: ShoppingListItem): ShoppingManualItem | null {
  if (item.hasItemRule) return null
  return item.manualItems.length === 1 && item.sources.every((source) => source.kind === 'manual')
    ? item.manualItems[0]!
    : null
}

interface EditorInitialValues {
  displayName: string
  quantityText: string
  unit: string
  category: ShoppingCategoryId
  purchaseNote: string
}

interface QuantityDraft {
  quantityText: string
  unit: string
}

/**
 * Manual articles keep their raw source values so opening and saving never
 * changes the product identity. Derived products use one draft per amount
 * dimension; corrections are scoped to the week and dimension.
 */
function editorInitialValues(
  item: ShoppingListItem,
  manualItem: ShoppingManualItem | null,
): EditorInitialValues {
  if (manualItem) {
    const category = SHOPPING_CATEGORIES.some((entry) => entry.id === manualItem.categoryId)
      ? (manualItem.categoryId as ShoppingCategoryId)
      : item.categoryId
    return {
      displayName: manualItem.name,
      quantityText: manualItem.quantityText ?? '',
      unit: manualItem.unit ?? '',
      category,
      purchaseNote: manualItem.purchaseNote,
    }
  }
  return {
    displayName: item.name,
    quantityText: '',
    unit: '',
    category: item.categoryId,
    purchaseNote: item.customPurchaseNote,
  }
}

function initialQuantityDrafts(item: ShoppingListItem): Record<string, QuantityDraft> {
  const drafts: Record<string, QuantityDraft> = {}
  for (const position of item.derivedPositions) {
    const correction = item.quantityCorrections.find(
      (entry) => entry.dimension === position.dimension,
    )
    drafts[position.dimension] = correction
      ? {
          quantityText: correction.quantityText,
          unit: correction.unit ?? editableShoppingAmount(position).unit,
        }
      : editableShoppingAmount(position)
  }
  return drafts
}

function sameDraft(left: QuantityDraft, right: QuantityDraft): boolean {
  return (
    left.quantityText.trim() === right.quantityText.trim() &&
    left.unit.trim() === right.unit.trim()
  )
}

function ItemEditorDialog({
  item,
  allItems,
  shoppingDate,
  ambiguousRules,
  onClose,
  onRemoveManual,
  onSplit,
  onError,
}: ItemEditorDialogProps) {
  const manualItem = singleManualItem(item)
  const initial = useMemo(() => editorInitialValues(item, manualItem), [item, manualItem])
  const [displayName, setDisplayName] = useState(initial.displayName)
  const [quantityText, setQuantityText] = useState(initial.quantityText)
  const [unit, setUnit] = useState(initial.unit)
  const [quantityDrafts, setQuantityDrafts] = useState<Record<string, QuantityDraft>>(() =>
    manualItem ? {} : initialQuantityDrafts(item),
  )
  const [category, setCategory] = useState<ShoppingCategoryId>(initial.category)
  const [purchaseNote, setPurchaseNote] = useState(initial.purchaseNote)
  const [purchaseNoteOverride, setPurchaseNoteOverride] = useState(item.purchaseNoteOverride)
  const [hiddenNotes, setHiddenNotes] = useState<string[]>(item.hiddenPurchaseNotes)
  const [mergeTarget, setMergeTarget] = useState('')
  const [busy, setBusy] = useState(false)

  const orphanCorrections = item.quantityCorrections.filter(
    (correction) =>
      !item.derivedPositions.some((position) => position.dimension === correction.dimension),
  )
  const legacyPosition = item.legacyQuantityText
    ? parseShoppingQuantityPosition(item.legacyQuantityText, item.legacyUnit)
    : null
  const legacyTarget = legacyPosition
    ? item.derivedPositions.find((position) => position.dimension === legacyPosition.dimension)
    : undefined

  function toggleHidden(note: string) {
    setHiddenNotes((current) =>
      current.includes(note) ? current.filter((entry) => entry !== note) : [...current, note],
    )
  }

  function updateDraft(dimension: string, patch: Partial<QuantityDraft>) {
    setQuantityDrafts((current) => ({
      ...current,
      [dimension]: {
        ...(current[dimension] ?? { quantityText: '', unit: '' }),
        ...patch,
      },
    }))
  }

  function correctionFor(dimension: string) {
    return item.quantityCorrections.find((entry) => entry.dimension === dimension)
  }

  function validateDraftUnits() {
    for (const position of item.derivedPositions) {
      const draft = quantityDrafts[position.dimension]
      if (!draft || !draft.quantityText.trim()) continue
      const parsed = parseShoppingQuantityPosition(draft.quantityText, draft.unit)
      if (!parsed) {
        throw new Error(
          `Die Menge „${draft.quantityText}“ konnte nicht gelesen werden.`,
        )
      }
      if (parsed.dimension !== position.dimension) {
        throw new Error(
          `Die Einheit „${draft.unit}“ passt nicht zur Mengenposition „${quantityDimensionLabel(
            position.dimension,
          )}“.`,
        )
      }
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!displayName.trim() || busy) return
    setBusy(true)
    try {
      if (manualItem) {
        // A single manual article is corrected at its source, so its name and
        // amount stay editable without inventing a product rule.
        await updateManualItem(manualItem.id, {
          name: displayName,
          quantityText,
          unit,
          purchaseNote,
          categoryId:
            manualItem.categoryId === null && category === item.categoryId ? null : category,
        })
      } else {
        validateDraftUnits()
        const patch: ItemRuleInput = {}
        if (displayName.trim() !== item.name) patch.displayName = displayName
        if (category !== item.categoryId) patch.categoryId = category
        if (purchaseNote !== item.customPurchaseNote) patch.purchaseNote = purchaseNote
        if (purchaseNoteOverride !== item.purchaseNoteOverride) {
          patch.purchaseNoteOverride = purchaseNoteOverride
        }
        const hiddenChanged =
          JSON.stringify([...hiddenNotes].sort()) !==
          JSON.stringify([...item.hiddenPurchaseNotes].sort())
        if (hiddenChanged) patch.hiddenPurchaseNotes = hiddenNotes
        await saveItemRule(item.key, patch)

        for (const position of item.derivedPositions) {
          const correction = correctionFor(position.dimension)
          const derived = editableShoppingAmount(position)
          const draft = quantityDrafts[position.dimension] ?? derived
          const empty = !draft.quantityText.trim()
          const matchesDerived = sameDraft(draft, derived)
          if (empty || matchesDerived) {
            if (correction) await removeQuantityCorrection(correction.id)
            continue
          }
          if (correction) {
            const unchanged =
              draft.quantityText.trim() === correction.quantityText.trim() &&
              draft.unit.trim() ===
                (correction.unit ?? editableShoppingAmount(position).unit).trim()
            // An unchanged stale correction stays visible for explicit review.
            if (unchanged) continue
          }
          await saveQuantityCorrection({
            shoppingDate: correction?.shoppingDate ?? shoppingDate,
            itemKey: item.key,
            dimension: position.dimension,
            quantityText: draft.quantityText,
            unit: draft.unit,
            sourceSignature: shoppingPositionSignature(position),
          })
        }
      }
      onClose()
    } catch (caught) {
      onError(errorText(caught))
    } finally {
      setBusy(false)
    }
  }

  async function confirmCorrection(
    correction: ShoppingListItem['quantityCorrections'][number],
  ) {
    const position = item.derivedPositions.find(
      (entry) => entry.dimension === correction.dimension,
    )
    if (!position || busy) return
    const draft = quantityDrafts[position.dimension] ?? editableShoppingAmount(position)
    if (!draft.quantityText.trim()) {
      onError('Bitte eine korrigierte Menge angeben.')
      return
    }
    setBusy(true)
    try {
      await saveQuantityCorrection({
        shoppingDate: correction.shoppingDate,
        itemKey: item.key,
        dimension: position.dimension,
        quantityText: draft.quantityText,
        unit: draft.unit,
        sourceSignature: shoppingPositionSignature(position),
      })
      onClose()
    } catch (caught) {
      onError(errorText(caught))
    } finally {
      setBusy(false)
    }
  }

  async function resetCorrection(correctionId: string) {
    if (busy) return
    setBusy(true)
    try {
      await removeQuantityCorrection(correctionId)
      onClose()
    } catch (caught) {
      onError(errorText(caught))
    } finally {
      setBusy(false)
    }
  }

  async function adoptLegacyQuantity() {
    if (!legacyTarget || !legacyPosition || busy) return
    setBusy(true)
    try {
      await saveQuantityCorrection({
        shoppingDate,
        itemKey: item.key,
        dimension: legacyTarget.dimension,
        quantityText: item.legacyQuantityText,
        unit: item.legacyUnit,
        sourceSignature: shoppingPositionSignature(legacyTarget),
      })
      await clearLegacyQuantity(item.key)
      onClose()
    } catch (caught) {
      onError(errorText(caught))
    } finally {
      setBusy(false)
    }
  }

  async function discardLegacyQuantity() {
    if (busy) return
    setBusy(true)
    try {
      await clearLegacyQuantity(item.key)
      onClose()
    } catch (caught) {
      onError(errorText(caught))
    } finally {
      setBusy(false)
    }
  }

  async function resolveLegacyRule(ruleKey: string) {
    if (busy) return
    setBusy(true)
    try {
      await resolveAmbiguousRule(ruleKey, item.key)
      onClose()
    } catch (caught) {
      onError(errorText(caught))
    } finally {
      setBusy(false)
    }
  }

  async function merge() {
    if (!mergeTarget || busy) return
    setBusy(true)
    try {
      await mergeShoppingProducts(item.key, mergeTarget)
      onClose()
    } catch (caught) {
      onError(errorText(caught))
    } finally {
      setBusy(false)
    }
  }

  async function removeManualItem(id: string) {
    const manual = item.manualItems.find((entry) => entry.id === id)
    if (!manual) return
    await onRemoveManual(manual)
    onClose()
  }

  async function removePurchase(purchase: ShoppingPurchase) {
    try {
      await removeShoppingPurchase(purchase.id)
    } catch (caught) {
      onError(errorText(caught))
    }
  }

  const availableNotes = manualItem ? [] : item.derivedPurchaseNotes
  const categoryOptions = SHOPPING_CATEGORIES

  return (
    <Modal
      label={`${item.variant ? `${item.name}, ${item.variant}` : item.name} bearbeiten`}
      onClose={onClose}
    >
      <div className="shopping-panel-head">
        <div>
          <h2>Artikel bearbeiten</h2>
          {item.sources.length > 0 ? (
            <p className="shopping-panel-subline">
              {item.sources.length === 1
                ? item.sources[0]!.label
                : `${item.sources.length} Einträge`}
            </p>
          ) : null}
        </div>
        <button type="button" className="shopping-icon-button" aria-label="Schließen" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>

      <form className="shopping-edit-form" onSubmit={(event) => void save(event)}>
        <label className="shopping-field">
          <span>Artikelname</span>
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            required
          />
        </label>

        {item.variant ? (
          <p className="shopping-field-hint">Variante: {item.variant}</p>
        ) : null}

        {manualItem ? (
          <div className="shopping-edit-row">
            <label className="shopping-field">
              <span>Menge</span>
              <input
                value={quantityText}
                onChange={(event) => setQuantityText(event.target.value)}
                placeholder="optional"
                inputMode="decimal"
              />
            </label>
            <label className="shopping-field">
              <span>Einheit</span>
              <input
                value={unit}
                onChange={(event) => setUnit(event.target.value)}
                placeholder="optional"
              />
            </label>
          </div>
        ) : item.derivedPositions.length > 0 || orphanCorrections.length > 0 ? (
          <div className="shopping-quantity-block">
            <span className="shopping-field-label">
              {item.derivedPositions.length > 0 ? 'Mengen' : 'Mengenkorrekturen'}
            </span>
            {item.derivedPositions.map((position) => {
              const correction = correctionFor(position.dimension)
              const draft =
                quantityDrafts[position.dimension] ?? editableShoppingAmount(position)
              const label = quantityDimensionLabel(position.dimension)
              return (
                <div className="shopping-quantity-row" key={position.dimension}>
                  <div className="shopping-quantity-head">
                    <span>{label}</span>
                    {correction?.status === 'applied' ? (
                      <span className="shopping-quantity-badge">korrigiert</span>
                    ) : null}
                    {correction?.status === 'stale' ? (
                      <span className="shopping-quantity-badge is-warn">prüfen</span>
                    ) : null}
                  </div>
                  <div className="shopping-quantity-inputs">
                    <input
                      value={draft.quantityText}
                      onChange={(event) =>
                        updateDraft(position.dimension, {
                          quantityText: event.target.value,
                        })
                      }
                      placeholder="Menge"
                      inputMode="decimal"
                      aria-label={`Menge (${label})`}
                    />
                    <input
                      value={draft.unit}
                      onChange={(event) =>
                        updateDraft(position.dimension, { unit: event.target.value })
                      }
                      placeholder="Einheit"
                      aria-label={`Einheit (${label})`}
                    />
                  </div>
                  <div className="shopping-quantity-meta">
                    <span>Berechnet: {formatShoppingAmount(position)}</span>
                    {correction?.status === 'stale' ? (
                      <button
                        type="button"
                        className="shopping-text-action"
                        disabled={busy}
                        onClick={() => void confirmCorrection(correction)}
                      >
                        Bestätigen
                      </button>
                    ) : null}
                    {correction ? (
                      <button
                        type="button"
                        className="shopping-text-action"
                        disabled={busy}
                        onClick={() => void resetCorrection(correction.id)}
                      >
                        Zurücksetzen
                      </button>
                    ) : null}
                  </div>
                  {correction?.status === 'stale' ? (
                    <p className="shopping-field-hint">
                      Der Bedarf hat sich geändert. Die alte Korrektur „
                      {correction.quantityText} {correction.unit ?? ''}“ wird nicht angewendet.
                    </p>
                  ) : null}
                </div>
              )
            })}
            {orphanCorrections.length > 0 ? (
              <div className="shopping-quantity-row is-orphan">
                <span className="shopping-field-label">
                  Nicht mehr zugeordnete Korrekturen
                </span>
                {orphanCorrections.map((correction) => (
                  <div className="shopping-quantity-meta" key={correction.id}>
                    <span>
                      {quantityDimensionLabel(correction.dimension)}:{' '}
                      {correction.quantityText} {correction.unit ?? ''}
                    </span>
                    <button
                      type="button"
                      className="shopping-text-action"
                      disabled={busy}
                      onClick={() => void resetCorrection(correction.id)}
                    >
                      Entfernen
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {!manualItem && item.legacyQuantityText ? (
          <div className="shopping-legacy-note">
            <p className="shopping-field-hint">
              <strong>Frühere Mengenkorrektur:</strong> {item.legacyQuantityText}{' '}
              {item.legacyUnit} – sie ist nicht automatisch aktiv.
            </p>
            {!legacyTarget ? (
              <p className="shopping-field-hint">
                Sie passt zu keiner aktuellen Mengenposition und kann nur verworfen werden.
              </p>
            ) : null}
            <div className="shopping-legacy-actions">
              {legacyTarget ? (
                <button
                  type="button"
                  className="button quiet"
                  disabled={busy}
                  onClick={() => void adoptLegacyQuantity()}
                >
                  Für diese Woche übernehmen
                </button>
              ) : null}
              <button
                type="button"
                className="shopping-text-action"
                disabled={busy}
                onClick={() => void discardLegacyQuantity()}
              >
                Verwerfen
              </button>
            </div>
          </div>
        ) : null}

        <label className="shopping-field">
          <span>Kategorie</span>
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value as ShoppingCategoryId)}
          >
            {categoryOptions.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>

        <label className="shopping-field">
          <span>Einkaufshinweis</span>
          <input
            value={purchaseNote}
            onChange={(event) => setPurchaseNote(event.target.value)}
            placeholder="optional"
          />
        </label>

        {!manualItem && (availableNotes.length > 0 || purchaseNote || purchaseNoteOverride) ? (
          <div className="shopping-hint-editor">
            <label className="shopping-check-line">
              <input
                type="checkbox"
                checked={purchaseNoteOverride}
                onChange={(event) => setPurchaseNoteOverride(event.target.checked)}
              />
              <span>Nur eigener Hinweis anzeigen</span>
            </label>
            {availableNotes.length > 0 ? (
              <span className="shopping-field-label">Hinweise aus den Zutaten</span>
            ) : null}
            {availableNotes.length > 0 ? (
              <ul className="shopping-note-list">
                {availableNotes.map((note) => {
                  const hidden = hiddenNotes.includes(note)
                  return (
                    <li key={note} className={hidden ? 'is-hidden' : undefined}>
                      <span>{note}</span>
                      <button
                        type="button"
                        className="shopping-text-action"
                        onClick={() => toggleHidden(note)}
                      >
                        {hidden ? 'Anzeigen' : 'Ausblenden'}
                      </button>
                    </li>
                  )
                })}
              </ul>
            ) : null}
            <button
              type="button"
              className="shopping-text-action"
              onClick={() => {
                setPurchaseNote('')
                setPurchaseNoteOverride(false)
                setHiddenNotes([])
              }}
            >
              Hinweise zurücksetzen
            </button>
          </div>
        ) : null}

        <div className="shopping-panel-actions">
          <button type="submit" className="button primary" disabled={busy || !displayName.trim()}>
            Speichern
          </button>
          <button type="button" className="button quiet" onClick={onClose} disabled={busy}>
            Abbrechen
          </button>
        </div>

        <details className="shopping-advanced">
          <summary>Weitere Optionen</summary>

          {item.mergedFrom.length > 0 ? (
            <div className="shopping-advanced-block">
              <span className="shopping-field-label">Zusammengeführt mit</span>
              <ul className="shopping-plain-list">
                {item.mergedFrom.map((merged) => (
                  <li key={merged.key}>
                    <span>{merged.name}</span>
                    <button
                      type="button"
                      className="shopping-text-action"
                      onClick={() => onSplit(merged.key)}
                    >
                      Trennen
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {ambiguousRules.length > 0 ? (
            <div className="shopping-advanced-block">
              <span className="shopping-field-label">Frühere Zuordnung</span>
              {ambiguousRules.map((rule) => (
                <div className="shopping-legacy-actions" key={rule.key}>
                  <span className="small">
                    {rule.displayName || rule.key} ist nicht eindeutig zugeordnet.
                  </span>
                  <button
                    type="button"
                    className="shopping-text-action"
                    disabled={busy}
                    onClick={() => void resolveLegacyRule(rule.key)}
                  >
                    Diesem Artikel zuordnen
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {item.purchases.length > 0 ? (
            <div className="shopping-advanced-block">
              <span className="shopping-field-label">Einkäufe</span>
              <ul className="shopping-plain-list">
                {item.purchases.map((purchase) => (
                  <li key={purchase.id}>
                    <span>
                      {formatDayLabel(purchase.shoppingDate)}
                      {' · '}
                      {purchase.amounts.length > 0
                        ? purchase.amounts
                            .map((entry) =>
                              formatShoppingAmount({
                                dimension: entry.dimension,
                                unit: entry.dimension === 'count' ? 'Stück' : null,
                                lower: entry.lower,
                                upper: entry.upper,
                                qualifier: '',
                              }),
                            )
                            .join(' · ')
                        : 'ohne Mengenangabe'}
                    </span>
                    <button
                      type="button"
                      className="shopping-text-action"
                      onClick={() => void removePurchase(purchase)}
                    >
                      Entfernen
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {allItems.length > 1 ? (
            <div className="shopping-advanced-block">
              <span className="shopping-field-label">Gleicher Artikel</span>
              <div className="shopping-merge-row">
                <select
                  value={mergeTarget}
                  onChange={(event) => setMergeTarget(event.target.value)}
                  aria-label="Artikel zum Zusammenführen auswählen"
                >
                  <option value="">Mit Artikel zusammenführen …</option>
                  {allItems
                    .filter((entry) => entry.key !== item.key)
                    .map((entry) => (
                      <option key={entry.key} value={entry.key}>
                        {entry.name}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  className="button quiet"
                  disabled={!mergeTarget || busy}
                  onClick={() => void merge()}
                >
                  Zusammenführen
                </button>
              </div>
            </div>
          ) : null}

          {item.manualItems.length > 0 ? (
            <div className="shopping-advanced-block">
              <span className="shopping-field-label">Manuelle Artikel</span>
              <ul className="shopping-plain-list">
                {item.manualItems.map((manual) => (
                  <li key={manual.id}>
                    <span>{manual.name}</span>
                    <button
                      type="button"
                      className="shopping-text-action danger"
                      onClick={() => void removeManualItem(manual.id)}
                    >
                      Entfernen
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {item.warnings.length > 0 ? (
            <div className="shopping-advanced-block">
              {item.warnings.map((warning) => (
                <p className="shopping-field-hint" key={warning}>
                  {warning}
                </p>
              ))}
            </div>
          ) : null}
        </details>
      </form>
    </Modal>
  )
}

interface PurchaseConfirmDialogProps {
  item: ShoppingListItem
  onCancel: () => void
  onConfirm: (values: Map<string, string>) => void
}

function PurchaseConfirmDialog({ item, onCancel, onConfirm }: PurchaseConfirmDialogProps) {
  const [values, setValues] = useState<Record<string, string>>({})
  const positions = item.positions
  return (
    <Modal label={`Einkauf für ${item.name} bestätigen`} className="shopping-confirm-modal" onClose={onCancel}>
      <div className="shopping-panel-head">
        <div>
          <h2>Tatsächlich gekauft</h2>
          <p className="shopping-panel-subline">
            Für Mengenbereiche bitte die wirklich gekaufte Menge eintragen.
          </p>
        </div>
        <button type="button" className="shopping-icon-button" aria-label="Schließen" onClick={onCancel}>
          <CloseIcon />
        </button>
      </div>
      <div className="shopping-confirm-list">
        {positions.map((position) => (
          <label className="shopping-confirm-row" key={position.dimension}>
            <span>
              Benötigt: <strong>{formatShoppingAmount(position)}</strong>
            </span>
            {position.lower === position.upper ? (
              <span className="muted small">wird übernommen</span>
            ) : (
              <input
                value={values[position.dimension] ?? ''}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    [position.dimension]: event.target.value,
                  }))
                }
                placeholder="gekaufte Menge"
                inputMode="decimal"
                aria-label={`Gekaufte Menge für ${item.name}`}
              />
            )}
          </label>
        ))}
      </div>
      <div className="shopping-panel-actions">
        <button
          type="button"
          className="button primary"
          onClick={() => onConfirm(new Map(Object.entries(values)))}
        >
          Einkauf bestätigen
        </button>
        <button type="button" className="button quiet" onClick={onCancel}>
          Abbrechen
        </button>
      </div>
    </Modal>
  )
}

interface SettingsDialogProps {
  order: readonly ShoppingCategoryId[]
  settings: ShoppingSettings
  onMove: (id: ShoppingCategoryId, direction: -1 | 1) => void
  onClose: () => void
}

function SettingsDialog({ order, settings, onMove, onClose }: SettingsDialogProps) {
  const today = useMemo(() => todayKey(), [])
  const activeDay = periodStartDayForDate(settings, today)
  const [day, setDay] = useState(activeDay)
  const [name, setName] = useState(settings.standardListName)
  const [preview, setPreview] = useState<ShoppingCycleChangePreview | null>(null)
  const [previewPending, setPreviewPending] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const trimmedName = name.replace(/\s+/g, ' ').trim()
  const dirty =
    day !== activeDay || trimmedName !== settings.standardListName

  async function refreshPreview(
    nextDay: number,
    nextName: string,
    cancelPending = false,
  ) {
    setPreviewPending(true)
    try {
      setError('')
      setPreview(
        await previewShoppingCycleChange(
          {
            periodStartDay: nextDay,
            standardListName: nextName,
          },
          today,
          { cancelPending },
        ),
      )
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setPreviewPending(false)
    }
  }

  useEffect(() => {
    void refreshPreview(activeDay, settings.standardListName)
    // The preview only describes the persisted state on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function save(cancelPending = false, overrideDay = day) {
    setBusy(true)
    setError('')
    try {
      await applyShoppingCycleChange(
        {
          periodStartDay: overrideDay,
          standardListName: name,
        },
        today,
        { cancelPending },
      )
      onClose()
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal label="Einkaufslisten-Einstellungen" className="shopping-settings-modal" onClose={onClose}>
      <div className="shopping-panel-head">
        <div>
          <h2>Einstellungen</h2>
          <p className="shopping-panel-subline">
            Einkaufszyklus, Standardzettel und Kategorien deines Einkaufswegs.
          </p>
        </div>
        <button type="button" className="shopping-icon-button" aria-label="Schließen" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>

      {settings.pending ? (
        <div className="notice" role="status">
          <p>
            {settings.pending.effectiveFrom > today ? (
              <>
                <strong>Geplante Änderung:</strong>{' '}
                {weekdayName(settings.pending.periodStartDay)} ab{' '}
                {formatDayLabel(settings.pending.effectiveFrom)}. Bestehende
                Perioden bleiben unverändert.
              </>
            ) : (
              <>
                <strong>Geplante Änderung ist aktiv seit</strong>{' '}
                {formatDayLabel(settings.pending.effectiveFrom)}.
              </>
            )}
          </p>
          {settings.pending.effectiveFrom > today ? (
            <button
              type="button"
              className="button quiet"
              onClick={() => void save(true, activeDay)}
              disabled={busy}
            >
              Geplante Änderung verwerfen
            </button>
          ) : null}
        </div>
      ) : null}

      <label className="shopping-confirm-row">
        <span>Regelmäßiger Einkaufstag</span>
        <select
          value={day}
          onChange={(event) => {
            const next = Number(event.target.value)
            setDay(next)
            void refreshPreview(next, name)
          }}
        >
          {WEEKDAY_NAMES.map((label, index) => (
            <option key={label} value={index}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <label className="shopping-confirm-row">
        <span>Name des Standard-Einkaufszettels</span>
        <input
          value={name}
          maxLength={60}
          onChange={(event) => setName(event.target.value)}
          placeholder="Wocheneinkauf"
        />
      </label>

      {error ? (
        <p className="notice danger" role="alert">
          {error}
        </p>
      ) : null}

      {preview ? (
        <div className={`notice${preview.blocked ? ' danger' : ''}`} role="status">
          <p>
            <strong>Aktueller Zeitraum:</strong> {preview.currentPeriod.label}
          </p>
          {preview.mode === 'name' ? (
            <p>Nur der Anzeigename wird geändert; Perioden und Käufe bleiben unverändert.</p>
          ) : preview.mode === 'cancel' ? (
            <p>Die geplante Änderung wird verworfen; die bisherige Periodenzuordnung bleibt.</p>
          ) : preview.mode === 'materialize' ? (
            <p>
              Die bereits aktive geplante Änderung wird jetzt als reguläre Einstellung
              übernommen.
            </p>
          ) : (
            <p>
              <strong>
                {preview.mode === 'scheduled' ? 'Wirksam ab' : 'Neuer Rhythmus ab'}:
              </strong>{' '}
              {formatDayLabel(preview.effectiveFrom)}
            </p>
          )}
          {preview.transition ? (
            <p>
              <strong>Einmaliger Übergangszeitraum:</strong> {preview.transition.label} (
              {preview.transition.days.length} Tage). Bereits vorhandene Einkäufe und
              Verteilungen bleiben ihrem bisherigen Zeitraum zugeordnet.
            </p>
          ) : preview.mode === 'name' || preview.mode === 'cancel' ? null : (
            <p>Kein verkürzter Übergangszeitraum nötig.</p>
          )}
          {preview.mode !== 'name' && preview.mode !== 'cancel' ? (
            <p>
              <strong>Erster regulärer Zeitraum:</strong>{' '}
              {preview.firstRegularPeriod.label}
            </p>
          ) : null}
          {preview.bindingFuturePeriods.length > 0 ? (
            <p>
              <strong>Verbindliche Zukunftsperioden bleiben erhalten:</strong>{' '}
              {preview.bindingFuturePeriods.map((period) => period.label).join(', ')}
            </p>
          ) : null}
          {preview.unusedFuturePeriods.length > 0 ? (
            <p>
              <strong>Unbenutzte systemseitige Zettel werden entfernt:</strong>{' '}
              {preview.unusedFuturePeriods.map((period) => period.label).join(', ')}
            </p>
          ) : null}
          {preview.blocked ? <p>{preview.conflict?.message}</p> : null}
        </div>
      ) : null}

      <ol className="shopping-category-order">
        {order.map((id, index) => (
          <li key={id}>
            <span>{categoryLabel(id)}</span>
            <span className="shopping-order-buttons">
              <button
                type="button"
                className="shopping-icon-button"
                aria-label={`${categoryLabel(id)} nach oben`}
                disabled={index === 0}
                onClick={() => onMove(id, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="shopping-icon-button"
                aria-label={`${categoryLabel(id)} nach unten`}
                disabled={index === order.length - 1}
                onClick={() => onMove(id, 1)}
              >
                ↓
              </button>
            </span>
          </li>
        ))}
      </ol>
      <div className="shopping-panel-actions">
        <button
          type="button"
          className="button primary"
          onClick={() => void save()}
          disabled={busy || previewPending || !dirty || preview?.blocked === true}
        >
          {busy ? 'Speichere …' : previewPending ? 'Prüfe …' : 'Einstellungen speichern'}
        </button>
        <button type="button" className="button quiet" onClick={onClose}>
          Fertig
        </button>
      </div>
    </Modal>
  )
}
