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
import { BottomSheet } from '../components/BottomSheet'
import { usePhoneLayout } from '../lib/phoneLayout'
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
import { adjacentShoppingPeriodStart } from '../shopping/cycle'
import type { ShoppingDistributionPosition } from '../domain/shoppingLists'
import type { ShoppingSettings } from '../settings/shopping'
import type { ItemRuleInput } from '../shopping/service'
import { useShoppingBackend } from '../shopping/shoppingBackend'
import {
  buildShoppingPageView,
  type ShoppingPageList,
  type ShoppingPageReviewRow,
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

function ChevronDownIcon() {
  return (
    <svg
      className="shopping-switch-chevron"
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="m3.5 6 4.5 4.5L12.5 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export interface ShoppingListsPanelContentProps {
  lists: ShoppingPageList[]
  selectedListId: string | null
  selectedList: ShoppingPageList | null
  standardListDisplayName: string
  creatingList: boolean
  newListName: string
  listBusy: boolean
  sheetMode?: boolean
  onSelectList: (id: string) => void
  onToggleCreate: () => void
  onNewListNameChange: (value: string) => void
  onCreateList: (event: FormEvent) => void
  onCancelCreate: () => void
  onRenameList?: () => void
  onDeleteList?: () => void
  onCloseSheet?: () => void
}

/**
 * The complete list management surface. The desktop renders it in the sticky
 * sidebar; phones render the exact same controls in a bottom sheet. Keeping one
 * component means list switching, creation, renaming and deletion cannot drift
 * between the two presentations.
 */
export function ShoppingListsPanelContent({
  lists,
  selectedListId,
  selectedList,
  standardListDisplayName,
  creatingList,
  newListName,
  listBusy,
  sheetMode = false,
  onSelectList,
  onToggleCreate,
  onNewListNameChange,
  onCreateList,
  onCancelCreate,
  onRenameList,
  onDeleteList,
  onCloseSheet,
}: ShoppingListsPanelContentProps) {
  return (
    <>
      <div className={`shopping-lists-head${sheetMode ? ' shopping-lists-head--sheet' : ''}`}>
        {sheetMode ? null : <h2>Einkaufszettel</h2>}
        <button
          type="button"
          className="shopping-list-new"
          onClick={onToggleCreate}
          aria-expanded={creatingList}
        >
          {sheetMode
            ? creatingList
              ? 'Abbrechen'
              : '+ Neuer Zettel'
            : '+ Neu'}
        </button>
      </div>

      {creatingList ? (
        <form className="shopping-list-create" onSubmit={onCreateList}>
          <label className="shopping-field">
            <span>Name des neuen Zettels</span>
            <input
              value={newListName}
              onChange={(event) => onNewListNameChange(event.target.value)}
              placeholder="z. B. Drogerie"
              maxLength={60}
              autoFocus
              data-autofocus
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
              onClick={onCancelCreate}
            >
              Abbrechen
            </button>
          </div>
        </form>
      ) : null}

      <div className="shopping-list-options" aria-label="Zettel auswählen">
        {lists.map((list) => {
          const selected = list.id === selectedListId
          return (
            <button
              key={list.id}
              type="button"
              className={`shopping-list-option${selected ? ' is-selected' : ''}`}
              aria-pressed={selected}
              data-list-id={list.id}
              onClick={() => onSelectList(list.id)}
            >
              <span className="shopping-list-option-top">
                <span className="shopping-list-option-name">
                  {list.isStandard ? standardListDisplayName : list.name}
                </span>
                {list.isStandard ? (
                  <span className="shopping-list-badge">Woche</span>
                ) : null}
              </span>
              <span className="shopping-list-option-meta">
                {list.openCount} offen · {list.doneCount} erledigt
                {list.reviewCount > 0
                  ? ` · ${list.reviewCount} prüfen`
                  : list.requiresReview
                    ? ' · prüfen'
                    : ''}
              </span>
            </button>
          )
        })}
      </div>

      {sheetMode && selectedList && !selectedList.isStandard ? (
        <div className="shopping-sheet-manage">
          <button type="button" className="button quiet" onClick={onRenameList}>
            Umbenennen
          </button>
          <button
            type="button"
            className="button danger-quiet"
            onClick={onDeleteList}
          >
            Löschen
          </button>
        </div>
      ) : null}

      {sheetMode ? (
        <div className="bottom-sheet-actions shopping-sheet-actions">
          <button type="button" className="button primary" onClick={onCloseSheet}>
            Fertig
          </button>
        </div>
      ) : null}
    </>
  )
}

export function ShoppingPage() {
  const backend = useShoppingBackend()
  const today = useMemo(() => todayKey(), [])
  const phoneLayout = usePhoneLayout()
  const [periodAnchor, setPeriodAnchor] = useState(today)
  const [selectedListId, setSelectedListId] = useState<string | null>(null)
  const [listSheetOpen, setListSheetOpen] = useState(false)
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
  const [distributingItemKey, setDistributingItemKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [reviewBusyId, setReviewBusyId] = useState<string | null>(null)
  const [undoItem, setUndoItem] = useState<{
    item: ShoppingManualItem
    purchases: ShoppingPurchase[]
  } | null>(null)
  const addTriggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const data = backend.useShoppingData()
  const recipes = data?.recipes
  const freeDishes = data?.freeDishes
  const cookSessions = data?.cookSessions
  const manualItems = data?.manualItems
  const purchases = data?.purchases
  const rules = data?.rules
  const quantityCorrections = data?.quantityCorrections
  const settingsRows = data?.settings
  const shoppingLists = data?.shoppingLists
  const allocations = data?.allocations

  const loading = data === undefined

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
  const standardListDisplayName = view?.settings.standardListName ?? ''
  const selectedListName = selectedList?.isStandard
    ? standardListDisplayName
    : (selectedList?.name ?? '')
  const selectedRows = selectedList ? (view?.rowsByList[selectedList.id] ?? []) : []
  const reviewRows = selectedList
    ? (view?.reviewRowsByList[selectedList.id] ?? [])
    : []
  const openRows = selectedRows.filter((row) => row.status === 'open')
  const doneRows = selectedRows.filter((row) => row.status === 'done')
  const distributionLists = useMemo(
    () =>
      view?.lists.map((list) =>
        list.isStandard ? { ...list, name: standardListDisplayName } : list,
      ) ?? [],
    [view, standardListDisplayName],
  )
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

  const distributingItem =
    view?.richItems.find((item) => item.key === distributingItemKey) ?? null
  const distributingPositions = useMemo(
    () =>
      view?.distribution && distributingItemKey
        ? view.distribution.positions.filter(
            (position) => position.itemKey === distributingItemKey,
          )
        : [],
    [view, distributingItemKey],
  )

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

  useEffect(() => {
    if (!flash) return
    const timer = window.setTimeout(() => setFlash(null), 4000)
    return () => window.clearTimeout(timer)
  }, [flash])

  // A sheet opened on the phone must not remain over the desktop sidebar after
  // a rotation or resize.
  useEffect(() => {
    if (phoneLayout) return
    setListSheetOpen(false)
  }, [phoneLayout])

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
    setListSheetOpen(false)
  }

  function goToday() {
    setPeriodAnchor(today)
    setSelectedListId(null)
    setAddOpen(false)
    setListSheetOpen(false)
  }

  function selectList(id: string) {
    setSelectedListId(id)
    setAddOpen(false)
    setListSheetOpen(false)
  }

  /**
   * Selecting inside the sheet keeps it open: the highlighted option and the
   * manage actions update immediately, and "Fertig" or the close button reveal
   * the chosen list. The desktop sidebar still closes nothing and behaves as
   * before.
   */
  function selectListFromSheet(id: string) {
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
        const list = await backend.ensureStandardShoppingList(view.period.start)
        await backend.createManualListItem({
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
        await backend.createManualListItem({
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
      const list = await backend.createFreeShoppingList({ name: newListName })
      setNewListName('')
      setCreatingList(false)
      setSelectedListId(list.id)
      setListSheetOpen(false)
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setListBusy(false)
    }
  }

  async function toggleManual(row: ShoppingPageRow) {
    const item = row.manualItem
    if (!item) return
    await run(() => backend.setManualItemPurchased(item.id, row.status !== 'done'))
  }

  async function addAutomaticPurchase(
    row: ShoppingPageRow,
    positions: readonly { dimension: string; lower: number; upper: number }[],
    qualitative = false,
  ) {
    if (!view) throw new Error('Die Einkaufsliste ist noch nicht geladen.')
    await backend.addShoppingPurchase({
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
      await run(() => backend.removeShoppingPurchases(row.purchaseIds))
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
    // The backend returns exactly the purchase rows this delete removed, so
    // "Rückgängig" restores the complete done state, not just the article.
    const removed = await backend.removeManualListItemWithPurchases(item.id)
    setUndoItem({ item, purchases: removed })
  }

  async function removeReviewAllocations(row: ShoppingPageReviewRow) {
    if (reviewBusyId) return
    setReviewBusyId(row.id)
    try {
      const success = await run(() =>
        backend.removeShoppingAllocations(row.allocationIds),
      )
      if (success) setFlash(`Zuordnung für „${row.name}“ entfernt.`)
    } finally {
      setReviewBusyId(null)
    }
  }

  async function removeReviewPurchases(row: ShoppingPageReviewRow) {
    if (reviewBusyId) return
    setReviewBusyId(row.id)
    try {
      const success = await run(() =>
        backend.removeShoppingPurchases(row.purchaseIds),
      )
      if (success) setFlash(`Kauf für „${row.name}“ entfernt.`)
    } finally {
      setReviewBusyId(null)
    }
  }

  function moveCategory(id: ShoppingCategoryId, direction: -1 | 1) {
    if (!view) return
    void run(async () => {
      await backend.saveCategoryOrder(categoryOrderWithMove(view.categoryOrder, id, direction))
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
      await backend.splitShoppingProduct(aliasKey)
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
        <div className="shopping-head-main">
          <h1>Einkaufsliste</h1>
          {view && selectedList ? (
            <button
              type="button"
              className="shopping-list-switch"
              aria-haspopup="dialog"
              aria-expanded={listSheetOpen}
              aria-controls={listSheetOpen ? 'shopping-lists-sheet' : undefined}
              aria-label={`Einkaufszettel wechseln, aktuell ${selectedListName}`}
              onClick={() => setListSheetOpen(true)}
            >
              <span className="shopping-list-switch-name">{selectedListName}</span>
              <ChevronDownIcon />
            </button>
          ) : null}
        </div>
        <button
          type="button"
          className="shopping-icon-button"
          aria-label="Einstellungen"
          onClick={() => setSettingsOpen(true)}
        >
          <GearIcon />
        </button>
      </header>

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

      {view &&
      view.serviceConflicts.length === 0 &&
      view.distribution?.requiresReview ? (
        <div className="notice shopping-notice shopping-conflict-note" role="status">
          <strong>Einkaufszuordnung prüfen.</strong> Mindestens eine feste
          Teilmenge passt nicht mehr zum aktuellen Bedarf.
          {view.conflictLabels.length > 0
            ? ` Betroffen: ${view.conflictLabels.slice(0, 4).join(', ')}${
                view.conflictLabels.length > 4 ? ' …' : ''
              }.`
            : ''}{' '}
          Passe die Verteilung über „Verschieben / aufteilen“ an oder setze sie
          zurück.
        </div>
      ) : null}

      {view && view.warnings.length > 0 ? (
        <details className="shopping-hint">
          <summary>
            <span className="shopping-hint-icon" aria-hidden="true">
              i
            </span>
            {view.warnings.length === 1
              ? '1 Hinweis'
              : `${view.warnings.length} Hinweise`}
          </summary>
          <ul>
            {view.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </details>
      ) : null}

      {undoItem ? (
        <div className="shopping-undo" role="status">
          <span>„{undoItem.item.name}“ wurde entfernt.</span>
          <button
            type="button"
            className="shopping-text-action"
            onClick={() =>
              void run(async () => {
                await backend.restoreManualItem(undoItem.item, undoItem.purchases)
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

      {flash ? (
        <p className="shopping-flash" role="status">
          {flash}
        </p>
      ) : null}

      {loading ? <p className="muted">Einkaufsliste wird geladen …</p> : null}

      {view && selectedList ? (
        <div className="shopping-layout">
          <aside className="shopping-lists-panel" aria-label="Einkaufszettel">
            <ShoppingListsPanelContent
              lists={view.lists}
              selectedListId={selectedList.id}
              selectedList={selectedList}
              standardListDisplayName={standardListDisplayName}
              creatingList={creatingList}
              newListName={newListName}
              listBusy={listBusy}
              onSelectList={selectList}
              onToggleCreate={() => {
                setError(null)
                setCreatingList((open) => !open)
              }}
              onNewListNameChange={setNewListName}
              onCreateList={(event) => void createList(event)}
              onCancelCreate={() => {
                setCreatingList(false)
                setNewListName('')
              }}
            />
          </aside>

          <section className="shopping-list-content" aria-labelledby="shopping-active-list">
            <div className="shopping-active-head">
              <div className="shopping-active-title">
                <h2 id="shopping-active-list">{selectedListName}</h2>
                <div className="shopping-active-meta">
                  {selectedList.isStandard ? (
                    <div
                      className="shopping-active-period"
                      role="group"
                      aria-label="Einkaufsperiode wechseln"
                    >
                      <button
                        type="button"
                        className="shopping-period-button"
                        aria-label="Vorherige Einkaufsperiode"
                        disabled={Boolean(view.conflict)}
                        onClick={() => changePeriod(-1)}
                      >
                        ‹
                      </button>
                      <span className="shopping-period-label" aria-live="polite">
                        {view.period.label}
                      </span>
                      <button
                        type="button"
                        className="shopping-period-button"
                        aria-label="Nächste Einkaufsperiode"
                        disabled={Boolean(view.conflict)}
                        onClick={() => changePeriod(1)}
                      >
                        ›
                      </button>
                      <button
                        type="button"
                        className="shopping-period-today"
                        onClick={goToday}
                      >
                        Heute
                      </button>
                    </div>
                  ) : (
                    <span className="shopping-active-kind">Eigener Zettel</span>
                  )}
                  <span className="shopping-active-count">
                    {openRows.length} offen
                    {doneRows.length > 0 ? ` · ${doneRows.length} erledigt` : ''}
                    {reviewRows.length > 0
                      ? ` · ${reviewRows.length} prüfen`
                      : selectedList.requiresReview
                        ? ' · prüfen'
                        : ''}
                  </span>
                </div>
              </div>
              <div className="shopping-active-actions">
                {selectedList.isStandard ? null : (
                  <div className="shopping-active-manage">
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
                  </div>
                )}
                <button
                  type="button"
                  className="shopping-add-trigger"
                  ref={addTriggerRef}
                  onClick={() => {
                    setError(null)
                    setAddOpen((open) => !open)
                  }}
                  aria-expanded={addOpen}
                  disabled={Boolean(view.conflict)}
                >
                  <span aria-hidden="true">+</span> Artikel hinzufügen
                </button>
              </div>
            </div>

            {!view.conflict && addOpen ? (
              <AddArticleForm
                listName={selectedListName}
                isFree={!selectedList.isStandard}
                onAdd={addArticle}
                onClose={() => closeAdd(false)}
              />
            ) : null}

            {!view.conflict && selectedRows.length === 0 && reviewRows.length === 0 ? (
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

            {!view.conflict && reviewRows.length > 0 ? (
              <section className="shopping-review" aria-labelledby="shopping-review-title">
                <h2 id="shopping-review-title">Zu prüfen</h2>
                <ul className="shopping-review-list">
                  {reviewRows.map((row) => (
                    <ShoppingReviewRow
                      key={row.id}
                      row={row}
                      busy={reviewBusyId === row.id}
                      onRemoveAllocations={() => void removeReviewAllocations(row)}
                      onRemovePurchases={() => void removeReviewPurchases(row)}
                    />
                  ))}
                </ul>
              </section>
            ) : null}

            {!view.conflict && openGroups.length > 0 ? (
              <div className="shopping-groups shopping-list-surface" ref={listRef}>
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
                          onDistribute={
                            row.kind === 'automatic'
                              ? () => setDistributingItemKey(row.itemKey)
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
                  <span className="shopping-done-count">({doneRows.length})</span>
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
                      onDistribute={
                        row.kind === 'automatic'
                          ? () => setDistributingItemKey(row.itemKey)
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
            await backend.updateManualListItem(editingManualRow.manualItem!.id, {
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

      {distributingItem && view?.distribution ? (
        <DistributionDialog
          key={distributingItem.key}
          itemKey={distributingItem.key}
          name={distributingItem.name}
          periodStart={view.period.start}
          standardListId={view.standardListId}
          currentListId={selectedList?.id}
          positions={distributingPositions}
          lists={distributionLists}
          onDone={(message) => {
            setDistributingItemKey(null)
            setFlash(message)
          }}
          onClose={() => setDistributingItemKey(null)}
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
          onSave={(name) => backend.renameShoppingList(renamingList.id, name)}
          onClose={() => setRenamingListId(null)}
        />
      ) : null}

      {deletingList ? (
        <DeleteListDialog
          list={deletingList}
          onDelete={async () => {
            await backend.deleteFreeShoppingList(deletingList.id, { confirmManualItems: true })
            if (selectedListId === deletingList.id) setSelectedListId(null)
          }}
          onClose={() => setDeletingListId(null)}
        />
      ) : null}

      <BottomSheet
        open={listSheetOpen && Boolean(view && selectedList)}
        title="Einkaufszettel"
        description="Zettel auswählen oder verwalten."
        closeLabel="Einkaufszettel schließen"
        onClose={() => setListSheetOpen(false)}
        className="shopping-lists-sheet"
        id="shopping-lists-sheet"
      >
        {view && selectedList ? (
          <ShoppingListsPanelContent
            sheetMode
            lists={view.lists}
            selectedListId={selectedList.id}
            selectedList={selectedList}
            standardListDisplayName={standardListDisplayName}
            creatingList={creatingList}
            newListName={newListName}
            listBusy={listBusy}
            onSelectList={selectListFromSheet}
            onToggleCreate={() => {
              setError(null)
              setCreatingList((open) => !open)
            }}
            onNewListNameChange={setNewListName}
            onCreateList={(event) => void createList(event)}
            onCancelCreate={() => {
              setCreatingList(false)
              setNewListName('')
            }}
            onRenameList={() => {
              setListSheetOpen(false)
              setRenamingListId(selectedList.id)
            }}
            onDeleteList={() => {
              setListSheetOpen(false)
              setDeletingListId(selectedList.id)
            }}
            onCloseSheet={() => setListSheetOpen(false)}
          />
        ) : null}
      </BottomSheet>
    </div>
  )
}

interface RowAction {
  label: string
  onSelect: () => void
}

export function RowActionsMenu({
  label,
  actions,
  defaultOpen = false,
}: {
  label: string
  actions: readonly RowAction[]
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const firstItemRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    firstItemRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setOpen(false)
      buttonRef.current?.focus()
    }
    function onPointerDown(event: PointerEvent) {
      if (containerRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  if (actions.length === 0) return null

  return (
    <div className="shopping-row-actions" ref={containerRef}>
      <button
        type="button"
        className="shopping-row-menu-button"
        ref={buttonRef}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open ? (
        <div className="shopping-row-menu" role="menu" aria-label={label}>
          {actions.map((action, index) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              className="shopping-row-menu-item"
              ref={index === 0 ? firstItemRef : undefined}
              onClick={() => {
                setOpen(false)
                action.onSelect()
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

interface ShoppingRowProps {
  row: ShoppingPageRow
  done?: boolean
  onToggle: () => void
  onEdit?: () => void
  onDistribute?: () => void
}

function ShoppingRow({
  row,
  done = false,
  onToggle,
  onEdit,
  onDistribute,
}: ShoppingRowProps) {
  const openAmount = rowAmountSummary(row)
  const purchasedAmount = formatAmounts(row.purchasedPositions)
  const amount = done ? rowAmountSummary(row, true) : openAmount
  const partialText =
    !done && purchasedAmount ? `bereits gekauft: ${purchasedAmount}` : ''
  const secondary = [
    row.variant,
    ...row.notes,
    row.distributionListNames.length > 1
      ? `Verteilt auf: ${row.distributionListNames.join(', ')}`
      : '',
    partialText,
  ].filter(Boolean)
  const accessibleName = row.variant ? `${row.name}, ${row.variant}` : row.name
  const editLabel = `${accessibleName}${amount ? `, ${amount}` : ''} bearbeiten`
  const actions: RowAction[] = onDistribute
    ? [
        { label: 'Verschieben / aufteilen', onSelect: onDistribute },
        ...(onEdit ? [{ label: 'Bearbeiten', onSelect: onEdit }] : []),
      ]
    : []
  const content = (
    <>
      <span className="shopping-row-text">
        <span className="shopping-row-name">{row.name}</span>
        {secondary.length > 0 ? (
          <span className="shopping-row-note">{secondary.join(' · ')}</span>
        ) : null}
      </span>
      {amount ? <span className="shopping-row-amount">{amount}</span> : null}
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
      <RowActionsMenu label={`${accessibleName} weitere Aktionen`} actions={actions} />
    </li>
  )
}

export function ShoppingReviewRow({
  row,
  busy,
  onRemoveAllocations,
  onRemovePurchases,
}: {
  row: ShoppingPageReviewRow
  busy: boolean
  onRemoveAllocations: () => void
  onRemovePurchases: () => void
}) {
  return (
    <li className="shopping-review-row">
      <div className="shopping-review-text">
        <span className="shopping-row-name">{row.name}</span>
        {row.allocationLabels.length > 0 ? (
          <span className="shopping-row-note">
            Nicht angewendete Zuordnung: {row.allocationLabels.join(' · ')}
          </span>
        ) : null}
        {row.purchaseLabels.length > 0 ? (
          <span className="shopping-row-note">
            Kauf ohne passenden Bedarf: {row.purchaseLabels.join(' · ')}
          </span>
        ) : null}
      </div>
      <div className="shopping-review-actions">
        {row.allocationIds.length > 0 ? (
          <button
            type="button"
            className="shopping-review-action"
            disabled={busy}
            onClick={onRemoveAllocations}
          >
            Zuordnung entfernen
          </button>
        ) : null}
        {row.purchaseIds.length > 0 ? (
          <button
            type="button"
            className="shopping-review-action"
            disabled={busy}
            onClick={onRemovePurchases}
          >
            Kauf entfernen
          </button>
        ) : null}
      </div>
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

interface DistributionDialogProps {
  itemKey: string
  name: string
  periodStart: string
  standardListId: string
  currentListId?: string
  positions: readonly ShoppingDistributionPosition[]
  lists: readonly ShoppingPageList[]
  initialMode?: 'full' | 'partial'
  onDone: (message: string) => void
  onClose: () => void
}

function draftFor(
  positions: readonly ShoppingDistributionPosition[],
  dimension: string,
  targetListId: string,
): { quantityText: string; unit: string } {
  const position = positions.find((entry) => entry.dimension === dimension)
  if (!position) return { quantityText: '', unit: '' }
  const amount = position.amounts.find(
    (entry) => entry.listId === targetListId && (entry.lower > 0 || entry.upper > 0),
  )
  const editable = editableShoppingAmount(
    amount
      ? {
          dimension: position.dimension,
          unit: position.unit,
          lower: amount.lower,
          upper: amount.upper,
          qualifier: position.qualifier,
        }
      : {
          dimension: position.dimension,
          unit: position.unit,
          lower: position.totalLower,
          upper: position.totalUpper,
          qualifier: position.qualifier,
        },
  )
  return {
    quantityText: amount ? editable.quantityText : '',
    unit: editable.unit,
  }
}

/**
 * Move a complete automatic recipe position or assign a fixed subset. The
 * dialog only formats the already resolved distribution; every write is done
 * by the existing allocation services.
 */
export function DistributionDialog({
  itemKey,
  name,
  periodStart,
  standardListId,
  currentListId,
  positions,
  lists,
  initialMode = 'full',
  onDone,
  onClose,
}: DistributionDialogProps) {
  const backend = useShoppingBackend()
  const firstFree = lists.find((list) => !list.isStandard)
  const initialTarget =
    (currentListId && lists.some((list) => list.id === currentListId)
      ? currentListId
      : null) ??
    firstFree?.id ??
    standardListId ??
    lists[0]?.id ??
    ''
  const initialDimension = positions[0]?.dimension ?? ''
  const initialDraft = draftFor(positions, initialDimension, initialTarget)
  const [mode, setMode] = useState<'full' | 'partial'>(initialMode)
  const [targetListId, setTargetListId] = useState(initialTarget)
  const [dimension, setDimension] = useState(initialDimension)
  const [quantityText, setQuantityText] = useState(initialDraft.quantityText)
  const [unit, setUnit] = useState(initialDraft.unit)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const listNameById = new Map(lists.map((list) => [list.id, list.name]))
  const targetName = listNameById.get(targetListId) ?? targetListId
  const selectedPosition =
    positions.find((position) => position.dimension === dimension) ??
    positions[0] ??
    null
  const hasFullAllocation = positions.some((position) =>
    position.allocations.some(
      (resolved) => !resolved.blocked && resolved.allocation.mode === 'full',
    ),
  )
  const isRange =
    selectedPosition !== null &&
    selectedPosition.totalLower !== selectedPosition.totalUpper
  const partialAllowed =
    positions.length > 0 && !hasFullAllocation && !isRange
  const hasAnyAllocation = positions.some(
    (position) => position.allocations.length > 0,
  )
  const needText =
    positions.length > 0
      ? positions
          .map((position) =>
            formatShoppingAmount({
              dimension: position.dimension,
              unit: position.unit,
              lower: position.totalLower,
              upper: position.totalUpper,
              qualifier: position.qualifier,
            }),
          )
          .join(' · ')
      : 'ohne Mengenangabe'

  useEffect(() => {
    if (
      positions.length > 0 &&
      !positions.some((position) => position.dimension === dimension)
    ) {
      setDimension(positions[0]!.dimension)
    }
  }, [positions, dimension])

  useEffect(() => {
    const draft = draftFor(positions, dimension, targetListId)
    setQuantityText(draft.quantityText)
    setUnit(draft.unit)
  }, [positions, dimension, targetListId])

  useEffect(() => {
    if (!partialAllowed && mode === 'partial') setMode('full')
  }, [partialAllowed, mode])

  const parsed =
    mode === 'partial' && selectedPosition
      ? parseShoppingQuantityPosition(quantityText, unit)
      : null
  const previewPosition =
    parsed &&
    selectedPosition &&
    parsed.dimension === selectedPosition.dimension &&
    parsed.lower === parsed.upper &&
    parsed.lower > 0
      ? parsed
      : null
  const previewAmount = previewPosition
    ? formatShoppingAmount(previewPosition)
    : ''
  const actionLabel =
    mode === 'full'
      ? 'Alles verschieben'
      : previewAmount
        ? `${previewAmount} zuweisen`
        : 'Teilmenge zuweisen'

  const shares = lists
    .map((list) => {
      const parts: string[] = []
      const allocationIds = new Set<string>()
      for (const position of positions) {
        const amount = position.amounts.find(
          (entry) => entry.listId === list.id && (entry.lower > 0 || entry.upper > 0),
        )
        if (amount) {
          parts.push(
            formatShoppingAmount({
              dimension: position.dimension,
              unit: position.unit,
              lower: amount.lower,
              upper: amount.upper,
              qualifier: position.qualifier,
            }),
          )
        }
        for (const resolved of position.allocations) {
          if (resolved.listId !== list.id || resolved.blocked) continue
          if (resolved.effectiveLower <= 0 && resolved.effectiveUpper <= 0) continue
          allocationIds.add(resolved.allocation.id)
        }
      }
      return {
        listId: list.id,
        name: list.name,
        amountText: parts.join(' · '),
        allocationIds: Array.from(allocationIds),
      }
    })
    .filter((share) => share.amountText)

  async function ensureStandardList() {
    if (targetListId === standardListId) {
      await backend.ensureStandardShoppingList(periodStart)
    }
  }

  async function save() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      if (!targetListId) throw new Error('Bitte einen Zielzettel auswählen.')
      await ensureStandardList()
      if (mode === 'full') {
        await backend.moveShoppingItem({ periodStart, itemKey, targetListId })
        onDone(`„${name}“ wurde auf „${targetName}“ verschoben.`)
      } else {
        if (!selectedPosition) {
          throw new Error('Bitte eine Mengenart auswählen.')
        }
        if (selectedPosition.totalLower !== selectedPosition.totalUpper) {
          throw new Error('Ein Mengenbereich kann nicht als feste Teilmenge zugewiesen werden.')
        }
        if (!parsed) {
          throw new Error('Bitte eine gültige Menge mit Einheit angeben.')
        }
        if (parsed.lower !== parsed.upper) {
          throw new Error('Bitte eine feste Menge angeben, keinen Bereich.')
        }
        if (parsed.lower <= 0) {
          throw new Error('Die Menge muss größer als null sein.')
        }
        if (parsed.dimension !== selectedPosition.dimension) {
          throw new Error('Die Einheit passt nicht zur ausgewählten Mengenart.')
        }
        await backend.assignShoppingSubquantity({
          periodStart,
          itemKey,
          dimension: selectedPosition.dimension,
          targetListId,
          quantity: parsed.lower,
        })
        onDone(`${formatShoppingAmount(parsed)} auf „${targetName}“ verteilt.`)
      }
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setBusy(false)
    }
  }

  async function removeShare(
    share: (typeof shares)[number],
  ) {
    if (busy || share.allocationIds.length === 0) return
    setBusy(true)
    setError('')
    try {
      await backend.removeShoppingAllocations(share.allocationIds)
      onDone(`Zuordnung zu „${share.name}“ entfernt.`)
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setBusy(false)
    }
  }

  async function resetAssignments() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await backend.resetShoppingAllocations({ periodStart, itemKey })
      onDone('Verteilung zurückgesetzt.')
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal label={`${name} verteilen`} className="shopping-distribute-dialog" onClose={onClose}>
      <div className="shopping-distribute-head">
        <div>
          <h2>{name} verteilen</h2>
          <p className="shopping-distribute-need">Benötigt: {needText}</p>
        </div>
        <button type="button" className="shopping-icon-button" aria-label="Schließen" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>

      <label className="shopping-distribute-field">
        <span>Wohin?</span>
        <select
          value={targetListId}
          onChange={(event) => setTargetListId(event.target.value)}
          disabled={busy || lists.length === 0}
        >
          {lists.map((list) => (
            <option key={list.id} value={list.id}>
              {list.name}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="shopping-distribute-modes">
        <legend>Wie viel?</legend>
        <label className={mode === 'full' ? 'is-active' : undefined}>
          <input
            type="radio"
            name="shopping-distribution-mode"
            checked={mode === 'full'}
            disabled={busy}
            onChange={() => setMode('full')}
          />
          <span>Alles</span>
        </label>
        <label className={mode === 'partial' ? 'is-active' : undefined}>
          <input
            type="radio"
            name="shopping-distribution-mode"
            checked={mode === 'partial'}
            disabled={busy || !partialAllowed}
            onChange={() => setMode('partial')}
          />
          <span>Teilmenge</span>
        </label>
      </fieldset>

      {mode === 'partial' ? (
        <div className="shopping-distribute-partial">
          {positions.length > 1 ? (
            <label className="shopping-distribute-field">
              <span>Welche Menge?</span>
              <select
                value={dimension}
                onChange={(event) => setDimension(event.target.value)}
                disabled={busy}
              >
                {positions.map((position) => (
                  <option key={position.dimension} value={position.dimension}>
                    {formatShoppingAmount({
                      dimension: position.dimension,
                      unit: position.unit,
                      lower: position.totalLower,
                      upper: position.totalUpper,
                      qualifier: position.qualifier,
                    })}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="shopping-distribute-quantity">
            <label className="shopping-distribute-field">
              <span>Menge</span>
              <input
                value={quantityText}
                onChange={(event) => setQuantityText(event.target.value)}
                placeholder="z. B. 5"
                inputMode="decimal"
                disabled={busy || !partialAllowed}
                aria-label="Teilmenge"
              />
            </label>
            <label className="shopping-distribute-field">
              <span>Einheit</span>
              <input
                value={unit}
                onChange={(event) => setUnit(event.target.value)}
                placeholder="z. B. Stück"
                disabled={busy || !partialAllowed}
                aria-label="Einheit der Teilmenge"
              />
            </label>
          </div>
          <p className="shopping-distribute-hint">
            Der Rest bleibt auf dem Wocheneinkauf.
          </p>
        </div>
      ) : null}

      {hasFullAllocation ? (
        <p className="shopping-distribute-hint">
          Für eine Teilmenge zuerst die vollständige Verschiebung entfernen.
        </p>
      ) : null}
      {isRange ? (
        <p className="shopping-distribute-hint">
          Ein Mengenbereich kann nicht als feste Teilmenge aufgeteilt werden.
        </p>
      ) : null}

      {shares.length > 0 ? (
        <div className="shopping-distribute-shares">
          <h3>Bereits verteilt</h3>
          <ul>
            {shares.map((share) => (
              <li key={share.listId}>
                <span>
                  {share.name}: <strong>{share.amountText}</strong>
                </span>
                {share.allocationIds.length > 0 ? (
                  <button
                    type="button"
                    className="shopping-text-action"
                    disabled={busy}
                    onClick={() => void removeShare(share)}
                  >
                    Entfernen
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          {hasAnyAllocation ? (
            <button
              type="button"
              className="shopping-text-action"
              disabled={busy}
              onClick={() => void resetAssignments()}
            >
              Verteilung zurücksetzen
            </button>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className="notice danger" role="alert">
          {error}
        </p>
      ) : null}

      <div className="shopping-distribute-actions">
        <button
          type="button"
          className="button primary"
          disabled={
            busy ||
            !targetListId ||
            (mode === 'partial' && (!partialAllowed || !quantityText.trim()))
          }
          onClick={() => void save()}
        >
          {busy ? 'Speichere …' : actionLabel}
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
  const backend = useShoppingBackend()
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
        await backend.updateManualListItem(manualItem.id, {
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
        await backend.saveItemRule(item.key, patch)

        for (const position of item.derivedPositions) {
          const correction = correctionFor(position.dimension)
          const derived = editableShoppingAmount(position)
          const draft = quantityDrafts[position.dimension] ?? derived
          const empty = !draft.quantityText.trim()
          const matchesDerived = sameDraft(draft, derived)
          if (empty || matchesDerived) {
            if (correction) await backend.removeQuantityCorrection(correction.id)
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
          await backend.saveQuantityCorrection({
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
      await backend.saveQuantityCorrection({
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
      await backend.removeQuantityCorrection(correctionId)
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
      await backend.saveQuantityCorrection({
        shoppingDate,
        itemKey: item.key,
        dimension: legacyTarget.dimension,
        quantityText: item.legacyQuantityText,
        unit: item.legacyUnit,
        sourceSignature: shoppingPositionSignature(legacyTarget),
      })
      await backend.clearLegacyQuantity(item.key)
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
      await backend.clearLegacyQuantity(item.key)
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
      await backend.resolveAmbiguousRule(ruleKey, item.key)
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
      await backend.mergeShoppingProducts(item.key, mergeTarget)
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
      await backend.removeShoppingPurchase(purchase.id)
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
  const backend = useShoppingBackend()
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
      await backend.applyShoppingSettings({
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
