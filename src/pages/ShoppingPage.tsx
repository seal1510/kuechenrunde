/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The shopping page is a calm, compact checklist for several independent
 * shopping lists. Recipe demand is still derived exactly once by
 * `buildShoppingList`; the page only presents the distribution and writes
 * purchase/manual actions through the existing services.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { formatDayLabel, todayKey, WEEKDAY_NAMES } from '../domain/dates'
import {
  categoryLabel,
  categoryOrderWithMove,
  editableShoppingAmount,
  formatShoppingAmount,
  parsePurchaseAmountInput,
  parseShoppingQuantityPosition,
  quantityDimensionLabel,
  SHOPPING_CATEGORIES,
  shoppingIdentityMappings,
  shoppingPositionSignature,
  type ShoppingAmountPosition,
  type ShoppingCategoryId,
  type ShoppingListItem,
} from '../domain/shopping'
import {
  adjacentShoppingPeriodStart,
  applyShoppingSettings,
} from '../shopping/cycle'
import type { ShoppingSettings } from '../settings/shopping'
import {
  addShoppingPurchase,
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
  type ItemRuleInput,
} from '../shopping/service'
import {
  createFreeShoppingList,
  createManualListItem,
  deleteFreeShoppingList,
  ensureStandardShoppingList,
  removeManualListItem,
  renameShoppingList,
  setManualItemPurchased,
  updateManualListItem,
} from '../shopping/listService'
import {
  buildShoppingPageView,
  type ShoppingPageList,
  type ShoppingPageRow,
  type ShoppingPageView,
} from '../shopping/pageView'
import type {
  ShoppingItemRule,
  ShoppingManualItem,
  ShoppingPurchase,
} from '../types'

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Die Aktion konnte nicht ausgeführt werden.'
}

function formatAmounts(positions: readonly ShoppingAmountPosition[]): string {
  return positions.map((position) => formatShoppingAmount(position)).join(' · ')
}

function rowAmountSummary(row: ShoppingPageRow, done = false): string {
  if (done) {
    const purchased = formatAmounts(row.purchasedPositions)
    if (purchased) return purchased
    return row.unparsedAmounts.join(' · ')
  }
  return [...row.unparsedAmounts, ...row.openPositions.map(formatShoppingAmount)]
    .filter(Boolean)
    .join(' · ')
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
  const [selectedListId, setSelectedListId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [creatingList, setCreatingList] = useState(false)
  const [newListName, setNewListName] = useState('')
  const [listBusy, setListBusy] = useState(false)
  const [renamingListId, setRenamingListId] = useState<string | null>(null)
  const [deletingListId, setDeletingListId] = useState<string | null>(null)
  const [editingManualId, setEditingManualId] = useState<string | null>(null)
  const [editingAuto, setEditingAuto] = useState<{ listId: string; itemKey: string } | null>(
    null,
  )
  const [confirmingAuto, setConfirmingAuto] = useState<{
    listId: string
    itemKey: string
  } | null>(null)
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
  const allocations = useLiveQuery(() => db.shoppingDemandAllocations.toArray(), [])

  const loading =
    recipes === undefined ||
    freeDishes === undefined ||
    cookSessions === undefined ||
    manualItems === undefined ||
    purchases === undefined ||
    rules === undefined ||
    quantityCorrections === undefined ||
    settingsRows === undefined ||
    shoppingLists === undefined ||
    allocations === undefined

  const view = useMemo<ShoppingPageView | null>(() => {
    if (loading) return null
    return buildShoppingPageView({
      anchor: periodAnchor,
      today,
      settingsRows: settingsRows ?? [],
      lists: shoppingLists ?? [],
      recipes: recipes ?? [],
      freeDishes: freeDishes ?? [],
      cookSessions: cookSessions ?? [],
      manualItems: manualItems ?? [],
      purchases: purchases ?? [],
      rules: rules ?? [],
      quantityCorrections: quantityCorrections ?? [],
      allocations: allocations ?? [],
    })
  }, [
    loading,
    periodAnchor,
    today,
    settingsRows,
    shoppingLists,
    recipes,
    freeDishes,
    cookSessions,
    manualItems,
    purchases,
    rules,
    quantityCorrections,
    allocations,
  ])

  const selectedList =
    view?.lists.find((list) => list.id === selectedListId) ??
    view?.lists.find((list) => list.id === view.standardListId) ??
    null
  const selectedRows = selectedList ? (view?.rowsByList[selectedList.id] ?? []) : []
  const openRows = selectedRows.filter((row) => row.status === 'open')
  const doneRows = selectedRows.filter((row) => row.status === 'done')
  const openGroups = useMemo(
    () =>
      (view?.categoryOrder ?? [])
        .map((categoryId) => ({
          categoryId,
          label: categoryLabel(categoryId),
          rows: openRows.filter((row) => row.categoryId === categoryId),
        }))
        .filter((group) => group.rows.length > 0),
    [view, openRows],
  )

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

  const editingAutoRow = useMemo(() => {
    if (!view || !editingAuto) return null
    return (
      (view.rowsByList[editingAuto.listId] ?? []).find(
        (row) => row.kind === 'automatic' && row.itemKey === editingAuto.itemKey,
      ) ?? null
    )
  }, [view, editingAuto])
  const editingItem = editingAutoRow?.richItem ?? null

  const editingManualRow = useMemo(() => {
    if (!view || !editingManualId) return null
    for (const rows of Object.values(view.rowsByList)) {
      const row = rows.find((entry) => entry.manualItem?.id === editingManualId)
      if (row) return row
    }
    return null
  }, [view, editingManualId])

  const confirmingRow = useMemo(() => {
    if (!view || !confirmingAuto) return null
    return (
      (view.rowsByList[confirmingAuto.listId] ?? []).find(
        (row) => row.kind === 'automatic' && row.itemKey === confirmingAuto.itemKey,
      ) ?? null
    )
  }, [view, confirmingAuto])

  const renamingList =
    view?.lists.find((list) => list.id === renamingListId) ?? null
  const deletingList =
    view?.lists.find((list) => list.id === deletingListId) ?? null

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

  async function run(action: () => Promise<unknown>): Promise<boolean> {
    try {
      setError(null)
      await action()
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

  function changePeriod(direction: -1 | 1) {
    if (!view || view.conflict || !shoppingLists) return
    setPeriodAnchor(
      adjacentShoppingPeriodStart(
        view.period.start,
        direction,
        view.settings,
        shoppingLists,
      ),
    )
    setSelectedListId(null)
    setAddOpen(false)
  }

  function goToday() {
    setPeriodAnchor(today)
    setSelectedListId(null)
    setAddOpen(false)
  }

  function selectList(id: string) {
    setSelectedListId(id)
    setAddOpen(false)
  }

  async function addArticle(input: {
    name: string
    quantityText: string
    unit: string
    purchaseNote: string
    categoryId: string | null
  }): Promise<boolean> {
    if (!view || !selectedList) return false
    try {
      setError(null)
      if (selectedList.kind === 'standard') {
        const list = await ensureStandardShoppingList(view.period.start)
        await createManualListItem({
          listId: list.id,
          shoppingDate: view.period.start,
          name: input.name,
          quantityText: input.quantityText,
          unit: input.unit,
          purchaseNote: input.purchaseNote,
          categoryId: input.categoryId,
        })
      } else {
        // Free lists are deliberately independent from the shopping week. The
        // service stores the article without inventing a period date.
        await createManualListItem({
          listId: selectedList.id,
          name: input.name,
          quantityText: input.quantityText,
          unit: input.unit,
          purchaseNote: input.purchaseNote,
          categoryId: input.categoryId,
        })
      }
      closeAdd(true)
      return true
    } catch (caught) {
      setError(errorText(caught))
      return false
    }
  }

  async function createList(event: FormEvent) {
    event.preventDefault()
    if (!newListName.trim() || listBusy) return
    setListBusy(true)
    try {
      setError(null)
      const list = await createFreeShoppingList({ name: newListName })
      setNewListName('')
      setCreatingList(false)
      setSelectedListId(list.id)
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setListBusy(false)
    }
  }

  async function toggleManual(row: ShoppingPageRow) {
    const item = row.manualItem
    if (!item) return
    await run(() => setManualItemPurchased(item.id, row.status !== 'done'))
  }

  async function addAutomaticPurchase(
    row: ShoppingPageRow,
    positions: readonly { dimension: string; lower: number; upper: number }[],
    qualitative = false,
  ) {
    if (!view) throw new Error('Die Einkaufsliste ist noch nicht geladen.')
    await addShoppingPurchase({
      shoppingDate: view.period.start,
      itemKey: row.itemKey,
      listId: row.listId,
      periodStart: view.period.start,
      amounts: positions.map((position) => ({
        dimension: position.dimension,
        lower: position.lower,
        upper: position.upper,
      })),
      snapshot: row.requiredPositions,
      qualitative,
    })
  }

  async function toggleAutomatic(row: ShoppingPageRow) {
    if (row.status === 'done') {
      if (row.purchaseIds.length === 0) return
      await run(async () => {
        for (const purchaseId of row.purchaseIds) {
          await removeShoppingPurchase(purchaseId)
        }
      })
      return
    }
    if (row.openPositions.length > 0) {
      const hasRange = row.openPositions.some(
        (position) => position.lower !== position.upper,
      )
      if (hasRange) {
        setConfirmingAuto({ listId: row.listId, itemKey: row.itemKey })
        return
      }
      await run(() => addAutomaticPurchase(row, row.openPositions))
      return
    }
    if (row.unparsedAmounts.length > 0 || row.missingQuantity) {
      await run(() => addAutomaticPurchase(row, [], true))
    }
  }

  async function confirmRange(row: ShoppingPageRow, values: Map<string, string>) {
    const amounts = row.openPositions.map((position) => {
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
      await addAutomaticPurchase(row, confirmed)
      setConfirmingAuto(null)
    })
  }

  async function deleteManual(item: ShoppingManualItem) {
    await removeManualListItem(item.id)
    setUndoItem(item)
  }

  function moveCategory(id: ShoppingCategoryId, direction: -1 | 1) {
    if (!view) return
    void run(async () => {
      await saveCategoryOrder(categoryOrderWithMove(view.categoryOrder, id, direction))
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
      setEditingAuto(null)
    })
  }

  function editRow(row: ShoppingPageRow) {
    if (row.kind === 'manual' && row.manualItem) {
      setEditingManualId(row.manualItem.id)
      return
    }
    if (row.richItem) {
      setEditingAuto({ listId: row.listId, itemKey: row.itemKey })
    }
  }

  return (
    <div className="page shopping-page">
      <header className="shopping-head">
        <div>
          <h1>Einkaufsliste</h1>
          {!loading && selectedList ? (
            <p className="shopping-subline">
              {selectedList.name}
              {' · '}
              {openRows.length === 0
                ? doneRows.length === 0
                  ? 'Noch nichts eingetragen'
                  : 'Alles erledigt'
                : `${openRows.length} Artikel offen${
                    doneRows.length > 0 ? ` · ${doneRows.length} erledigt` : ''
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
          disabled={!view || Boolean(view.conflict)}
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
            disabled={!view || Boolean(view.conflict)}
            onClick={() => changePeriod(-1)}
          >
            ‹
          </button>
          <span className="shopping-week-label" aria-live="polite">
            {view?.period.label ?? 'Einkaufszeitraum'}
          </span>
          <button
            type="button"
            className="shopping-nav-button"
            aria-label="Nächste Einkaufsperiode"
            disabled={!view || Boolean(view.conflict)}
            onClick={() => changePeriod(1)}
          >
            ›
          </button>
        </div>
        <div className="shopping-toolbar-end">
          <button type="button" className="shopping-today" onClick={goToday}>
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

      {view?.conflict ? (
        <div className="notice danger shopping-notice" role="alert">
          <strong>Einkaufsperioden überlappen sich.</strong> Für{' '}
          {formatDayLabel(view.conflict.date)} sind mehrere Standardzettel
          zugeordnet ({view.conflict.listIds.join(', ')}). Die Einkaufsliste wird
          bis zur eindeutigen Zuordnung nicht berechnet.
        </div>
      ) : null}

      {view && view.serviceConflicts.length > 0 ? (
        <div className="notice shopping-notice shopping-conflict-note" role="status">
          <strong>Einkaufszuordnung unklar.</strong>{' '}
          {view.serviceConflicts.length === 1
            ? '1 Eintrag wird nicht als gekauft gewertet.'
            : `${view.serviceConflicts.length} Einträge werden nicht als gekauft gewertet.`}{' '}
          {view.conflictLabels.length > 0
            ? `Betroffen: ${view.conflictLabels.slice(0, 4).join(', ')}${
                view.conflictLabels.length > 4 ? ' …' : ''
              }. `
            : ''}
          Bitte die Zuordnung prüfen.
        </div>
      ) : null}

      {view && view.warnings.length > 0 ? (
        <div className="notice shopping-notice shopping-warnings">
          <ul>
            {view.warnings.slice(0, 3).map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
            {view.warnings.length > 3 ? (
              <li>Weitere {view.warnings.length - 3} Hinweis(e).</li>
            ) : null}
          </ul>
        </div>
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

      {view && selectedList ? (
        <div className="shopping-layout">
          <aside className="shopping-lists-panel" aria-label="Einkaufszettel">
            <div className="shopping-lists-head">
              <h2>Einkaufszettel</h2>
              <button
                type="button"
                className="shopping-list-new"
                onClick={() => {
                  setError(null)
                  setCreatingList((open) => !open)
                }}
                aria-expanded={creatingList}
              >
                + Neu
              </button>
            </div>

            {creatingList ? (
              <form className="shopping-list-create" onSubmit={(event) => void createList(event)}>
                <label className="shopping-field">
                  <span>Name des neuen Zettels</span>
                  <input
                    value={newListName}
                    onChange={(event) => setNewListName(event.target.value)}
                    placeholder="z. B. Drogerie"
                    maxLength={60}
                    autoFocus
                    disabled={listBusy}
                  />
                </label>
                <div className="shopping-list-create-actions">
                  <button
                    type="submit"
                    className="button primary"
                    disabled={listBusy || !newListName.trim()}
                  >
                    Anlegen
                  </button>
                  <button
                    type="button"
                    className="button quiet"
                    disabled={listBusy}
                    onClick={() => {
                      setCreatingList(false)
                      setNewListName('')
                    }}
                  >
                    Abbrechen
                  </button>
                </div>
              </form>
            ) : null}

            <div className="shopping-list-options" aria-label="Zettel auswählen">
              {view.lists.map((list) => {
                const selected = list.id === selectedList.id
                return (
                  <button
                    key={list.id}
                    type="button"
                    className={`shopping-list-option${selected ? ' is-selected' : ''}`}
                    aria-pressed={selected}
                    onClick={() => selectList(list.id)}
                  >
                    <span className="shopping-list-option-top">
                      <span className="shopping-list-option-name">{list.name}</span>
                      {list.isStandard ? (
                        <span className="shopping-list-badge">Woche</span>
                      ) : null}
                    </span>
                    <span className="shopping-list-option-meta">
                      {list.openCount} offen · {list.doneCount} erledigt
                      {list.requiresReview ? ' · prüfen' : ''}
                    </span>
                  </button>
                )
              })}
            </div>
          </aside>

          <section className="shopping-list-content" aria-labelledby="shopping-active-list">
            <div className="shopping-list-titlebar">
              <div>
                <h2 id="shopping-active-list">{selectedList.name}</h2>
                <p className="shopping-list-meta">
                  {selectedList.isStandard
                    ? `${view.period.label} · automatischer Wocheneinkauf`
                    : 'Eigener Zettel · unabhängig von der Einkaufswoche'}
                </p>
              </div>
              <div className="shopping-list-actions">
                {selectedList.isStandard ? (
                  <span className="shopping-list-lock">Standardzettel</span>
                ) : (
                  <>
                    <button
                      type="button"
                      className="shopping-text-action"
                      onClick={() => setRenamingListId(selectedList.id)}
                    >
                      Umbenennen
                    </button>
                    <button
                      type="button"
                      className="shopping-text-action danger"
                      onClick={() => setDeletingListId(selectedList.id)}
                    >
                      Löschen
                    </button>
                  </>
                )}
              </div>
            </div>

            {!view.conflict && addOpen ? (
              <AddArticleForm
                listName={selectedList.name}
                isFree={!selectedList.isStandard}
                onAdd={addArticle}
                onClose={() => closeAdd(false)}
              />
            ) : null}

            {!view.conflict && selectedRows.length === 0 ? (
              <div className="empty-state shopping-empty">
                <h2>
                  {selectedList.isStandard ? 'Noch nichts zu kaufen' : 'Dieser Zettel ist leer'}
                </h2>
                <p>
                  {selectedList.isStandard
                    ? 'Geplante Gerichte erscheinen hier automatisch. Artikel kannst du auch direkt eintragen.'
                    : 'Trage Artikel direkt ein – unabhängig von der Einkaufswoche.'}
                </p>
              </div>
            ) : null}

            {!view.conflict && openGroups.length > 0 ? (
              <div className="shopping-groups" ref={listRef}>
                {openGroups.map((group) => (
                  <section className="shopping-group" key={group.categoryId}>
                    <h2 className="shopping-group-title">
                      <span>{group.label}</span>
                      <span className="shopping-group-count" aria-hidden="true">
                        {group.rows.length}
                      </span>
                    </h2>
                    <ul className="shopping-list">
                      {group.rows.map((row) => (
                        <ShoppingRow
                          key={row.id}
                          row={row}
                          onToggle={() =>
                            void (row.kind === 'manual'
                              ? toggleManual(row)
                              : toggleAutomatic(row))
                          }
                          onEdit={
                            row.kind === 'manual' || row.richItem
                              ? () => editRow(row)
                              : undefined
                          }
                        />
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            ) : null}

            {!view.conflict && doneRows.length > 0 ? (
              <details className="shopping-done">
                <summary>
                  <span>Erledigt</span>
                  <span className="shopping-done-count">{doneRows.length}</span>
                </summary>
                <ul className="shopping-list shopping-done-list">
                  {doneRows.map((row) => (
                    <ShoppingRow
                      key={row.id}
                      row={row}
                      done
                      onToggle={() =>
                        void (row.kind === 'manual'
                          ? toggleManual(row)
                          : toggleAutomatic(row))
                      }
                      onEdit={
                        row.kind === 'manual' || row.richItem
                          ? () => editRow(row)
                          : undefined
                      }
                    />
                  ))}
                </ul>
              </details>
            ) : null}
          </section>
        </div>
      ) : null}

      {editingManualRow?.manualItem ? (
        <ManualItemDialog
          key={editingManualRow.manualItem.id}
          item={editingManualRow.manualItem}
          onSave={async (input) => {
            await updateManualListItem(editingManualRow.manualItem!.id, {
              name: input.name,
              quantityText: input.quantityText,
              unit: input.unit,
              purchaseNote: input.purchaseNote,
              categoryId: input.categoryId,
            })
          }}
          onDelete={async () => {
            await deleteManual(editingManualRow.manualItem!)
          }}
          onClose={() => setEditingManualId(null)}
        />
      ) : null}

      {editingItem && editingAutoRow ? (
        <ItemEditorDialog
          key={editingItem.key}
          item={editingItem}
          allItems={view?.richItems ?? []}
          shoppingDate={view?.period.start ?? today}
          ambiguousRules={ambiguousRulesForEditing}
          onClose={() => setEditingAuto(null)}
          onRemoveManual={async () => undefined}
          onSplit={splitAlias}
          onError={setError}
        />
      ) : null}

      {confirmingRow ? (
        <PurchaseConfirmDialog
          key={confirmingRow.id}
          name={confirmingRow.name}
          positions={confirmingRow.openPositions}
          onCancel={() => setConfirmingAuto(null)}
          onConfirm={(values) => void confirmRange(confirmingRow, values)}
        />
      ) : null}

      {settingsOpen && view ? (
        <SettingsDialog
          order={view.categoryOrder}
          settings={view.settings}
          onMove={moveCategory}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}

      {renamingList ? (
        <ListNameDialog
          list={renamingList}
          onSave={(name) => renameShoppingList(renamingList.id, name)}
          onClose={() => setRenamingListId(null)}
        />
      ) : null}

      {deletingList ? (
        <DeleteListDialog
          list={deletingList}
          onDelete={async () => {
            await deleteFreeShoppingList(deletingList.id, { confirmManualItems: true })
            if (selectedListId === deletingList.id) setSelectedListId(null)
          }}
          onClose={() => setDeletingListId(null)}
        />
      ) : null}
    </div>
  )
}

interface ShoppingRowProps {
  row: ShoppingPageRow
  done?: boolean
  onToggle: () => void
  onEdit?: () => void
}

function ShoppingRow({ row, done = false, onToggle, onEdit }: ShoppingRowProps) {
  const openAmount = rowAmountSummary(row)
  const purchasedAmount = formatAmounts(row.purchasedPositions)
  const amount = done ? rowAmountSummary(row, true) : openAmount
  const partialText =
    !done && purchasedAmount ? `bereits gekauft: ${purchasedAmount}` : ''
  const secondary = [
    row.variant ? `Variante: ${row.variant}` : '',
    ...row.notes,
    partialText,
  ].filter(Boolean)
  const accessibleName = row.variant ? `${row.name}, ${row.variant}` : row.name
  const editLabel = `${accessibleName}${amount ? `, ${amount}` : ''} bearbeiten`
  const content = (
    <>
      <span className="shopping-row-text">
        <span className="shopping-row-name">{row.name}</span>
        {secondary.length > 0 ? (
          <span className="shopping-row-note">{secondary.join(' · ')}</span>
        ) : null}
      </span>
      {amount ? <span className="shopping-row-amount">{amount}</span> : null}
      {onEdit ? (
        <span className="shopping-row-edit" aria-hidden="true">
          <span className="shopping-row-edit-icon">✎</span>
        </span>
      ) : null}
    </>
  )

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
      {onEdit ? (
        <button
          type="button"
          className="shopping-row-main"
          onClick={onEdit}
          aria-label={editLabel}
        >
          {content}
        </button>
      ) : (
        <div className="shopping-row-main">{content}</div>
      )}
    </li>
  )
}

interface AddArticleFormProps {
  listName: string
  isFree: boolean
  onAdd: (input: {
    name: string
    quantityText: string
    unit: string
    purchaseNote: string
    categoryId: string | null
  }) => Promise<boolean>
  onClose: () => void
}

function AddArticleForm({ listName, isFree, onAdd, onClose }: AddArticleFormProps) {
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
          <p className="shopping-panel-subline">
            {isFree
              ? `Für „${listName}“ · unabhängig von der Einkaufswoche.`
              : `Für den Wocheneinkauf „${listName}“.`}
          </p>
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

interface ManualItemDialogProps {
  item: ShoppingManualItem
  onSave: (input: {
    name: string
    quantityText: string
    unit: string
    purchaseNote: string
    categoryId: ShoppingCategoryId | null
  }) => Promise<unknown>
  onDelete: () => Promise<unknown>
  onClose: () => void
}

function ManualItemDialog({
  item,
  onSave,
  onDelete,
  onClose,
}: ManualItemDialogProps) {
  const initialCategory = SHOPPING_CATEGORIES.some(
    (category) => category.id === item.categoryId,
  )
    ? (item.categoryId as ShoppingCategoryId)
    : ('' as const)
  const [name, setName] = useState(item.name)
  const [quantityText, setQuantityText] = useState(item.quantityText ?? '')
  const [unit, setUnit] = useState(item.unit ?? '')
  const [purchaseNote, setPurchaseNote] = useState(item.purchaseNote)
  const [category, setCategory] = useState<'' | ShoppingCategoryId>(initialCategory)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      await onSave({
        name,
        quantityText,
        unit,
        purchaseNote,
        categoryId: category || null,
      })
      onClose()
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await onDelete()
      onClose()
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal label={`${item.name} bearbeiten`} onClose={onClose}>
      <div className="shopping-panel-head">
        <div>
          <h2>Artikel bearbeiten</h2>
          <p className="shopping-panel-subline">Manueller Artikel</p>
        </div>
        <button type="button" className="shopping-icon-button" aria-label="Schließen" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>

      <form className="shopping-edit-form" onSubmit={(event) => void save(event)}>
        <label className="shopping-field">
          <span>Artikelname</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            autoFocus
          />
        </label>
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
        <label className="shopping-field">
          <span>Kategorie</span>
          <select
            value={category}
            onChange={(event) =>
              setCategory(event.target.value as '' | ShoppingCategoryId)
            }
          >
            <option value="">Automatisch</option>
            {SHOPPING_CATEGORIES.map((entry) => (
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

        {error ? (
          <p className="notice danger" role="alert">
            {error}
          </p>
        ) : null}

        <div className="shopping-panel-actions">
          <button type="submit" className="button primary" disabled={busy || !name.trim()}>
            Speichern
          </button>
          <button type="button" className="button quiet" onClick={onClose} disabled={busy}>
            Abbrechen
          </button>
          <button
            type="button"
            className="shopping-text-action danger shopping-manual-delete"
            disabled={busy}
            onClick={() => void remove()}
          >
            Artikel löschen
          </button>
        </div>
      </form>
    </Modal>
  )
}

interface ListNameDialogProps {
  list: ShoppingPageList
  onSave: (name: string) => Promise<unknown>
  onClose: () => void
}

function ListNameDialog({ list, onSave, onClose }: ListNameDialogProps) {
  const [name, setName] = useState(list.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      await onSave(name)
      onClose()
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal label={`${list.name} umbenennen`} onClose={onClose}>
      <div className="shopping-panel-head">
        <div>
          <h2>Einkaufszettel umbenennen</h2>
          <p className="shopping-panel-subline">Der Name gilt nur für diesen Zettel.</p>
        </div>
        <button type="button" className="shopping-icon-button" aria-label="Schließen" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
      <form onSubmit={(event) => void save(event)}>
        <label className="shopping-field">
          <span>Name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={60}
            required
            autoFocus
          />
        </label>
        {error ? (
          <p className="notice danger" role="alert">
            {error}
          </p>
        ) : null}
        <div className="shopping-panel-actions">
          <button type="submit" className="button primary" disabled={busy || !name.trim()}>
            Speichern
          </button>
          <button type="button" className="button quiet" onClick={onClose} disabled={busy}>
            Abbrechen
          </button>
        </div>
      </form>
    </Modal>
  )
}

interface DeleteListDialogProps {
  list: ShoppingPageList
  onDelete: () => Promise<unknown>
  onClose: () => void
}

function DeleteListDialog({ list, onDelete, onClose }: DeleteListDialogProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function remove() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await onDelete()
      onClose()
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      label={`${list.name} löschen`}
      className="shopping-confirm-modal"
      onClose={onClose}
    >
      <div className="shopping-panel-head">
        <div>
          <h2>Einkaufszettel löschen?</h2>
          <p className="shopping-panel-subline">„{list.name}“ wird dauerhaft entfernt.</p>
        </div>
        <button type="button" className="shopping-icon-button" aria-label="Schließen" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
      <div className="shopping-delete-note">
        <p>
          Automatische Rezeptzutaten wandern zurück auf den Wocheneinkauf ihres
          Einkaufszeitraums. Bereits gekaufte Mengen bleiben dabei erhalten.
        </p>
        <p>
          Manuelle Artikel dieses Zettels und ihre zugehörigen Käufe werden
          gelöscht. Diese Bestätigung ist deshalb erforderlich.
        </p>
      </div>
      {error ? (
        <p className="notice danger" role="alert">
          {error}
        </p>
      ) : null}
      <div className="shopping-panel-actions">
        <button type="button" className="button danger" disabled={busy} onClick={() => void remove()}>
          {busy ? 'Lösche …' : 'Zettel löschen'}
        </button>
        <button type="button" className="button quiet" onClick={onClose} disabled={busy}>
          Abbrechen
        </button>
      </div>
    </Modal>
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
        await updateManualListItem(manualItem.id, {
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
                      {correction.quantityText} {correction.unit ?? ''} wird nicht angewendet.
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
  name: string
  positions: readonly ShoppingAmountPosition[]
  onCancel: () => void
  onConfirm: (values: Map<string, string>) => void
}

function PurchaseConfirmDialog({
  name,
  positions,
  onCancel,
  onConfirm,
}: PurchaseConfirmDialogProps) {
  const [values, setValues] = useState<Record<string, string>>({})
  return (
    <Modal label={`Einkauf für ${name} bestätigen`} className="shopping-confirm-modal" onClose={onCancel}>
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
                aria-label={`Gekaufte Menge für ${name}`}
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
  const [day, setDay] = useState(settings.periodStartDay)
  const [name, setName] = useState(settings.standardListName)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const trimmedName = name.replace(/\s+/g, ' ').trim()
  const dirty = day !== settings.periodStartDay || trimmedName !== settings.standardListName

  async function save() {
    setBusy(true)
    setError('')
    try {
      await applyShoppingSettings({
        periodStartDay: day,
        standardListName: name,
      })
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
            Einkaufstag, Name des Wocheneinkaufs und Kategorien.
          </p>
        </div>
        <button type="button" className="shopping-icon-button" aria-label="Schließen" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>

      <p className="notice shopping-settings-note" role="note">
        Der Einkaufstag gilt ab sofort für die weitere Planung. Bereits angelegte
        Einkaufszettel, Käufe und Verteilungen bleiben erhalten.
      </p>

      <label className="shopping-confirm-row">
        <span>Regelmäßiger Einkaufstag</span>
        <select value={day} onChange={(event) => setDay(Number(event.target.value))}>
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
          disabled={busy || !dirty}
        >
          {busy ? 'Speichere …' : 'Einstellungen speichern'}
        </button>
        <button type="button" className="button quiet" onClick={onClose}>
          Fertig
        </button>
      </div>
    </Modal>
  )
}
