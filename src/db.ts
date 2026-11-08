import Dexie, { type Table } from 'dexie'
import { parseIngredientLine, plainIngredientText } from './import/ingredients'
import { shoppingIdentityMappings } from './domain/shopping'
import { addDays, normalizeWeekday, startOfWeekOn } from './domain/dates'
import {
  shoppingPeriod,
  shoppingPeriodFromRange,
  standardShoppingListId,
  standardShoppingListName,
  standardShoppingListRecord,
} from './domain/shoppingLists'
import { normalizeInstructionList } from './recipe/references'
import {
  LEGACY_STANDARD_PERIOD_START_DAY,
  normalizeLegacyShoppingRows,
} from './shopping/legacyNormalization'
import {
  DEFAULT_SHOPPING_PERIOD_START_DAY,
  DEFAULT_STANDARD_SHOPPING_LIST_NAME,
  SHOPPING_PERIOD_START_DAY_KEY,
  STANDARD_SHOPPING_LIST_NAME_KEY,
} from './settings/shopping'
import type {
  CookProgress,
  CookSession,
  DayNote,
  FreeDish,
  MealDay,
  MealPlanEntry,
  Recipe,
  RecipeImage,
  SettingRecord,
  ShoppingCheck,
  ShoppingDemandAllocation,
  ShoppingItemRule,
  ShoppingList,
  ShoppingManualItem,
  ShoppingPurchase,
  ShoppingQuantityCorrection,
} from './types'

/**
 * Local, offline-first database. Everything the app shows lives here; there is
 * no network call in this implementation.
 *
 * v2 adds the week planner; v3 adds editable cuisine/dish-type/effort/tags
 * fields; v4 adds the optional ingredient purchase/preparation notes; v5
 * re-parses clearly recognisable plain imported ingredients; v6 adds URL
 * import metadata; v7 separates cooking events (`cookSessions`) from meal
 * appointments (`mealPlans`) and allows several dishes per date+slot; v8 adds
 * free day notes as their own table; v9 adds plan-only free dishes with their
 * own ingredient snapshot; v14 adds explicit instruction ingredient references
 * and the local cook-mode progress table; v15 adds independent shopping lists
 * and explicit partial demand allocations; v16 marks historical rows with an
 * unreconstructable calendar-week grouping for review; v17 corrects that
 * marking for free lists and uses the shared legacy normalisation so old rows
 * are never treated as an invented Thursday grouping.
 * Upgrades only add tables/indexes or backfill/reinterpret new fields; existing
 * recipes, images and plans are not deleted.
 */
export class OpenCookDatabase extends Dexie {
  recipes!: Table<Recipe, string>
  images!: Table<RecipeImage, string>
  mealPlans!: Table<MealPlanEntry, string>
  mealDays!: Table<MealDay, string>
  settings!: Table<SettingRecord, string>
  cookSessions!: Table<CookSession, string>
  dayNotes!: Table<DayNote, string>
  freeDishes!: Table<FreeDish, string>
  shoppingManualItems!: Table<ShoppingManualItem, string>
  shoppingChecks!: Table<ShoppingCheck, string>
  shoppingPurchases!: Table<ShoppingPurchase, string>
  shoppingItemRules!: Table<ShoppingItemRule, string>
  shoppingQuantityCorrections!: Table<ShoppingQuantityCorrection, string>
  shoppingLists!: Table<ShoppingList, string>
  shoppingDemandAllocations!: Table<ShoppingDemandAllocation, string>
  cookProgress!: Table<CookProgress, string>

  constructor(name = 'opencook-web') {
    super(name)
    this.version(1).stores({
      // `&importId` makes repeated Mela imports impossible to duplicate at the DB level.
      recipes: 'id, &importId, title, updatedAt, *categories, favorite, wantToCook',
      images: 'id, recipeId, [recipeId+position]',
    })
    this.version(2).stores({
      recipes: 'id, &importId, title, updatedAt, *categories, favorite, wantToCook',
      images: 'id, recipeId, [recipeId+position]',
      mealPlans: 'id, date, &[date+slot], recipeId, pinned, cooked',
      mealDays: 'date',
      settings: 'key',
    })
    this.version(3)
      .stores({
        recipes:
          'id, &importId, title, updatedAt, *categories, *cuisine, *dishType, effort, *tags, favorite, wantToCook',
        images: 'id, recipeId, [recipeId+position]',
        mealPlans: 'id, date, &[date+slot], recipeId, pinned, cooked',
        mealDays: 'date',
        settings: 'key',
      })
      .upgrade(async (transaction) => {
        // Old recipes predate the editable classification. Keep their imported
        // `categories` exactly as they are; only add empty defaults.
        await transaction
          .table('recipes')
          .toCollection()
          .modify((recipe: Record<string, unknown>) => {
            if (!Array.isArray(recipe.cuisine)) recipe.cuisine = []
            if (!Array.isArray(recipe.dishType)) recipe.dishType = []
            if (typeof recipe.effort !== 'string') recipe.effort = ''
            if (!Array.isArray(recipe.tags)) recipe.tags = []
            if (recipe.importSource !== 'manual' && recipe.importSource !== 'mela') {
              recipe.importSource = 'mela'
            }
          })
      })
    this.version(4)
      .stores({
        recipes:
          'id, &importId, title, updatedAt, *categories, *cuisine, *dishType, effort, *tags, favorite, wantToCook',
        images: 'id, recipeId, [recipeId+position]',
        mealPlans: 'id, date, &[date+slot], recipeId, pinned, cooked',
        mealDays: 'date',
        settings: 'key',
      })
      .upgrade(async (transaction) => {
        // Ingredient notes are object fields, not indexes. Backfill empty strings
        // so old data and new data have the same shape; raw lines stay untouched.
        await transaction
          .table('recipes')
          .toCollection()
          .modify((recipe: Record<string, unknown>) => {
            if (!Array.isArray(recipe.ingredients)) return
            recipe.ingredients = recipe.ingredients.map((value) => {
              if (typeof value !== 'object' || value === null || Array.isArray(value)) return value
              const ingredient = value as Record<string, unknown>
              if (typeof ingredient.purchaseNote !== 'string') ingredient.purchaseNote = ''
              if (typeof ingredient.preparationNote !== 'string') ingredient.preparationNote = ''
              return ingredient
            })
          })
      })
    this.version(5)
      .stores({
        recipes:
          'id, &importId, title, updatedAt, *categories, *cuisine, *dishType, effort, *tags, favorite, wantToCook',
        images: 'id, recipeId, [recipeId+position]',
        mealPlans: 'id, date, &[date+slot], recipeId, pinned, cooked',
        mealDays: 'date',
        settings: 'key',
      })
      .upgrade(async (transaction) => {
        // Existing Mela recipes may still contain plain ingredient lines that
        // the old parser could not structure. Repair only clearly recognisable
        // lines; keep id/raw/group/position/links/notes and leave everything
        // else untouched.
        await transaction
          .table('recipes')
          .toCollection()
          .modify((recipe: Record<string, unknown>) => {
            if (recipe.importSource !== 'mela' || !Array.isArray(recipe.ingredients)) return
            recipe.ingredients = recipe.ingredients.map((value, index) => {
              if (typeof value !== 'object' || value === null || Array.isArray(value)) return value
              const ingredient = value as Record<string, unknown>
              if (ingredient.parseStatus !== 'plain') return ingredient
              if (typeof ingredient.quantity === 'number') return ingredient
              if (typeof ingredient.quantityText === 'string' && ingredient.quantityText.trim()) {
                return ingredient
              }
              if (typeof ingredient.unit === 'string' && ingredient.unit.trim()) return ingredient
              if (
                (typeof ingredient.purchaseNote === 'string' && ingredient.purchaseNote.trim()) ||
                (typeof ingredient.preparationNote === 'string' &&
                  ingredient.preparationNote.trim())
              ) {
                return ingredient
              }
              const raw = typeof ingredient.raw === 'string' ? ingredient.raw : ''
              if (!raw.trim()) return ingredient
              // A differing name indicates a manual edit; do not overwrite it.
              if (
                typeof ingredient.name === 'string' &&
                ingredient.name !== plainIngredientText(raw)
              ) {
                return ingredient
              }
              const position = typeof ingredient.position === 'number' ? ingredient.position : index
              const groupId = typeof ingredient.groupId === 'string' ? ingredient.groupId : null
              const parsed = parseIngredientLine(raw, position, groupId)
              if (parsed.parseStatus !== 'parsed') return ingredient
              return {
                ...ingredient,
                name: parsed.name,
                quantity: parsed.quantity,
                quantityText: parsed.quantityText,
                unit: parsed.unit,
                parseStatus: 'parsed',
              }
            })
          })
      })
    // v6 adds URL import metadata. The index allows duplicate detection without
    // a full table scan; existing recipes keep all values. Manual/Mela recipes
    // get an empty importUrl so the field shape is predictable.
    this.version(6)
      .stores({
        recipes:
          'id, &importId, title, updatedAt, *categories, *cuisine, *dishType, effort, *tags, favorite, wantToCook, importUrl',
        images: 'id, recipeId, [recipeId+position]',
        mealPlans: 'id, date, &[date+slot], recipeId, pinned, cooked',
        mealDays: 'date',
        settings: 'key',
      })
      .upgrade(async (transaction) => {
        await transaction
          .table('recipes')
          .toCollection()
          .modify((recipe: Record<string, unknown>) => {
            if (typeof recipe.importUrl !== 'string') recipe.importUrl = ''
            if (
              recipe.importSource !== 'manual' &&
              recipe.importSource !== 'mela' &&
              recipe.importSource !== 'url'
            ) {
              recipe.importSource = 'mela'
            }
          })
      })
    // v7 separates real cooking events from meal appointments. The unique
    // `[date+slot]` index is replaced by a normal compound index so a meal slot
    // can hold several dishes. Existing plans are kept; every non-leftover
    // plan becomes a cooking event it consumes, while old automatic leftover
    // days stay unlinked because their origin is not known for sure.
    this.version(7)
      .stores({
        recipes:
          'id, &importId, title, updatedAt, *categories, *cuisine, *dishType, effort, *tags, favorite, wantToCook, importUrl',
        images: 'id, recipeId, [recipeId+position]',
        mealPlans: 'id, date, [date+slot], recipeId, pinned, cooked, cookSessionId, status',
        mealDays: 'date',
        settings: 'key',
        cookSessions: 'id, recipeId, date, status, [recipeId+date]',
      })
      .upgrade(async (transaction) => {
        const settingsTable = transaction.table<SettingRecord, string>('settings')
        const householdRow = await settingsTable.get('householdSize')
        const householdSize =
          typeof householdRow?.value === 'number' && householdRow.value >= 1
            ? Math.round(householdRow.value)
            : 2
        const plansTable = transaction.table<MealPlanEntry, string>('mealPlans')
        const sessionsTable = transaction.table<CookSession, string>('cookSessions')
        const existing = await plansTable.toArray()
        if (existing.length === 0) return

        const now = Date.now()
        const migrated: MealPlanEntry[] = []
        const newSessions: CookSession[] = []

        for (const plan of existing) {
          const servings =
            typeof plan.servings === 'number' && Number.isFinite(plan.servings) && plan.servings > 0
              ? plan.servings
              : householdSize
          const status = plan.status ?? (plan.cooked ? 'eaten' : 'planned')
          let cookSessionId = plan.cookSessionId ?? null

          // A leftover day is a second helping whose cooking event is unknown.
          // Never invent a cooking event for it.
          if (!cookSessionId && !plan.leftover) {
            cookSessionId = `cook-migrated-${plan.id}`
            newSessions.push({
              id: cookSessionId,
              recipeId: plan.recipeId,
              date: plan.date,
              servings,
              status: plan.cooked ? 'cooked' : 'planned',
              auto: plan.auto === true,
              createdAt: plan.createdAt ?? now,
              updatedAt: plan.updatedAt ?? now,
            })
          }

          migrated.push({
            ...plan,
            servings,
            position: typeof plan.position === 'number' ? plan.position : 0,
            cookSessionId,
            status,
          })
        }

        if (newSessions.length > 0) await sessionsTable.bulkPut(newSessions)
        await plansTable.bulkPut(migrated)
      })
    // v8 adds free day notes. The table is new and independent from recipes,
    // meal appointments and cooking events; no existing row is changed.
    this.version(8).stores({
      recipes:
        'id, &importId, title, updatedAt, *categories, *cuisine, *dishType, effort, *tags, favorite, wantToCook, importUrl',
      images: 'id, recipeId, [recipeId+position]',
      mealPlans: 'id, date, [date+slot], recipeId, pinned, cooked, cookSessionId, status',
      mealDays: 'date',
      settings: 'key',
      cookSessions: 'id, recipeId, date, status, [recipeId+date]',
      dayNotes: 'date, updatedAt',
    })
    // v9 adds free dishes that live only in the meal plan. The new table owns
    // name, reference portions and ingredients; cooking events and meal
    // appointments gain an optional `freeDishId` link. Existing recipe plans
    // keep their `recipeId` and are not rewritten.
    this.version(9).stores({
      recipes:
        'id, &importId, title, updatedAt, *categories, *cuisine, *dishType, effort, *tags, favorite, wantToCook, importUrl',
      images: 'id, recipeId, [recipeId+position]',
      mealPlans:
        'id, date, [date+slot], recipeId, freeDishId, pinned, cooked, cookSessionId, status',
      mealDays: 'date',
      settings: 'key',
      cookSessions: 'id, recipeId, freeDishId, date, status, [recipeId+date]',
      dayNotes: 'date, updatedAt',
      freeDishes: 'id, updatedAt',
    })
    // v10 adds the shopping list. The tables are new and additive: manual
    // articles, purchased/checked state per week, learned product corrections
    // and (historically) pantry stock. Derived recipe demand is deliberately
    // not stored; it is recomputed from cookSessions. No existing row changes.
    this.version(10).stores({
      recipes:
        'id, &importId, title, updatedAt, *categories, *cuisine, *dishType, effort, *tags, favorite, wantToCook, importUrl',
      images: 'id, recipeId, [recipeId+position]',
      mealPlans:
        'id, date, [date+slot], recipeId, freeDishId, pinned, cooked, cookSessionId, status',
      mealDays: 'date',
      settings: 'key',
      cookSessions: 'id, recipeId, freeDishId, date, status, [recipeId+date]',
      dayNotes: 'date, updatedAt',
      freeDishes: 'id, updatedAt',
      shoppingManualItems: 'id, weekStart',
      shoppingChecks: 'id, weekStart, [weekStart+itemKey], itemKey',
      shoppingItemRules: 'key, updatedAt',
      pantryItems: 'id, itemKey, updatedAt',
    })
    // v11 makes shopping data independent from the configured week start and
    // turns the aggregate check into individual purchase actions. Existing
    // rows are backfilled in place; v10 checks become exactly one historical
    // purchase each, never a fabricated history. If that purchase already
    // existed from an interrupted earlier attempt, the deterministic id keeps
    // the operation idempotent.
    this.version(11)
      .stores({
        recipes:
          'id, &importId, title, updatedAt, *categories, *cuisine, *dishType, effort, *tags, favorite, wantToCook, importUrl',
        images: 'id, recipeId, [recipeId+position]',
        mealPlans:
          'id, date, [date+slot], recipeId, freeDishId, pinned, cooked, cookSessionId, status',
        mealDays: 'date',
        settings: 'key',
        cookSessions: 'id, recipeId, freeDishId, date, status, [recipeId+date]',
        dayNotes: 'date, updatedAt',
        freeDishes: 'id, updatedAt',
        shoppingManualItems: 'id, shoppingDate, weekStart',
        shoppingChecks: 'id, weekStart, [weekStart+itemKey], itemKey',
        shoppingPurchases: 'id, shoppingDate, itemKey, createdAt, [itemKey+shoppingDate]',
        shoppingItemRules: 'key, updatedAt',
        pantryItems: 'id, itemKey, updatedAt',
      })
      .upgrade(async (transaction) => {
        await transaction
          .table('shoppingManualItems')
          .toCollection()
          .modify((item: Record<string, unknown>) => {
            if (typeof item.shoppingDate !== 'string' || !item.shoppingDate) {
              item.shoppingDate = typeof item.weekStart === 'string' ? item.weekStart : ''
            }
          })
        await transaction
          .table('shoppingItemRules')
          .toCollection()
          .modify((rule: Record<string, unknown>) => {
            if (typeof rule.canonicalKey !== 'string' || !rule.canonicalKey) {
              rule.canonicalKey = typeof rule.key === 'string' ? rule.key : ''
            }
            if (typeof rule.purchaseNoteOverride !== 'boolean') rule.purchaseNoteOverride = false
            if (!Array.isArray(rule.hiddenPurchaseNotes)) rule.hiddenPurchaseNotes = []
          })
        const checksTable = transaction.table<ShoppingCheck, string>('shoppingChecks')
        const purchasesTable = transaction.table<ShoppingPurchase, string>('shoppingPurchases')
        const checks = await checksTable.toArray()
        const now = Date.now()
        for (const check of checks) {
          if (!check.checked) continue
          const shoppingDate = check.shoppingDate || check.weekStart
          await purchasesTable.put({
            id: `legacy-${check.id}`,
            shoppingDate,
            itemKey: check.itemKey,
            amounts: Array.isArray(check.purchased) ? check.purchased : [],
            confirmedTotal: Array.isArray(check.purchased) ? check.purchased : [],
            snapshot: [],
            qualitative: !Array.isArray(check.purchased) || check.purchased.length === 0,
            createdAt: typeof check.updatedAt === 'number' ? check.updatedAt : now,
            updatedAt: typeof check.updatedAt === 'number' ? check.updatedAt : now,
          })
        }
        // Converted checks must not be consumed twice. The purchase rows carry
        // the complete historical amount.
        await checksTable.clear()
      })
    // v12 removes the discontinued pantry feature. The table is dropped by
    // Dexie because it is no longer part of the schema; the shopping list now
    // only knows demand, manual articles and purchase status. Historical
    // purchase rows keep their amounts and dates, only the obsolete pantry
    // snapshot is stripped. Older backups with pantry data stay importable and
    // their pantry section is ignored.
    this.version(12)
      .stores({
        recipes:
          'id, &importId, title, updatedAt, *categories, *cuisine, *dishType, effort, *tags, favorite, wantToCook, importUrl',
        images: 'id, recipeId, [recipeId+position]',
        mealPlans:
          'id, date, [date+slot], recipeId, freeDishId, pinned, cooked, cookSessionId, status',
        mealDays: 'date',
        settings: 'key',
        cookSessions: 'id, recipeId, freeDishId, date, status, [recipeId+date]',
        dayNotes: 'date, updatedAt',
        freeDishes: 'id, updatedAt',
        shoppingManualItems: 'id, shoppingDate, weekStart',
        shoppingChecks: 'id, weekStart, [weekStart+itemKey], itemKey',
        shoppingPurchases: 'id, shoppingDate, itemKey, createdAt, [itemKey+shoppingDate]',
        shoppingItemRules: 'key, updatedAt',
        // Explicit null deletes the discontinued table and its data.
        pantryItems: null,
      })
      .upgrade(async (transaction) => {
        await transaction
          .table('shoppingPurchases')
          .toCollection()
          .modify((purchase: Record<string, unknown>) => {
            delete purchase.pantrySnapshot
          })
      })
    // v13 scopes quantity corrections to one shopping week and one amount
    // dimension. Old product-wide quantities are preserved as legacy values
    // instead of being applied to every future week. Product-rule identities
    // are remapped only when the current data makes the assignment
    // unambiguous; ambiguous rules stay untouched and are flagged.
    this.version(13)
      .stores({
        recipes:
          'id, &importId, title, updatedAt, *categories, *cuisine, *dishType, effort, *tags, favorite, wantToCook, importUrl',
        images: 'id, recipeId, [recipeId+position]',
        mealPlans:
          'id, date, [date+slot], recipeId, freeDishId, pinned, cooked, cookSessionId, status',
        mealDays: 'date',
        settings: 'key',
        cookSessions: 'id, recipeId, freeDishId, date, status, [recipeId+date]',
        dayNotes: 'date, updatedAt',
        freeDishes: 'id, updatedAt',
        shoppingManualItems: 'id, shoppingDate, weekStart',
        shoppingChecks: 'id, weekStart, [weekStart+itemKey], itemKey',
        shoppingPurchases: 'id, shoppingDate, itemKey, createdAt, [itemKey+shoppingDate]',
        shoppingItemRules: 'key, updatedAt',
        shoppingQuantityCorrections:
          'id, shoppingDate, itemKey, [itemKey+shoppingDate]',
        pantryItems: null,
      })
      .upgrade(async (transaction) => {
        const rulesTable = transaction.table<ShoppingItemRule, string>('shoppingItemRules')
        await rulesTable.toCollection().modify((rule) => {
          const record = rule as unknown as Record<string, unknown>
          const legacyQuantity =
            typeof record.quantityOverrideText === 'string'
              ? record.quantityOverrideText.trim()
              : ''
          const legacyUnit =
            typeof record.unitOverride === 'string' ? record.unitOverride.trim() : ''
          if (legacyQuantity && !record.legacyQuantityText) {
            record.legacyQuantityText = legacyQuantity
          }
          if (legacyUnit && !record.legacyUnit) record.legacyUnit = legacyUnit
          delete record.quantityOverrideText
          delete record.unitOverride
        })

        const names: string[] = []
        const recipes = await transaction.table('recipes').toArray()
        for (const recipe of recipes) {
          if (!Array.isArray(recipe.ingredients)) continue
          for (const ingredient of recipe.ingredients) {
            if (typeof ingredient?.name === 'string' && ingredient.name.trim()) {
              names.push(ingredient.name)
            }
          }
        }
        const freeDishes = await transaction.table('freeDishes').toArray()
        for (const freeDish of freeDishes) {
          if (!Array.isArray(freeDish.ingredients)) continue
          for (const ingredient of freeDish.ingredients) {
            if (typeof ingredient?.name === 'string' && ingredient.name.trim()) {
              names.push(ingredient.name)
            }
          }
        }
        const manualItems = await transaction.table('shoppingManualItems').toArray()
        for (const item of manualItems) {
          if (typeof item.name === 'string' && item.name.trim()) names.push(item.name)
        }

        const { unique, ambiguous } = shoppingIdentityMappings(names)
        if (unique.size === 0 && ambiguous.size === 0) return
        const rules = await rulesTable.toArray()
        const migrated = rules.map((rule) => {
          const next: ShoppingItemRule = { ...rule }
          if (ambiguous.has(next.key)) next.legacyAmbiguous = true
          else if (
            unique.has(next.key) &&
            (!next.canonicalKey || next.canonicalKey === next.key)
          ) {
            next.canonicalKey = unique.get(next.key)
            next.legacyAmbiguous = false
          }
          return next
        })
        // A purchase may exist under the old base identity without a rule.
        // A minimal alias keeps that historical purchase attached to the one
        // unambiguous variant; no amounts are rewritten.
        const knownKeys = new Set(migrated.map((rule) => rule.key))
        const purchases = await transaction.table('shoppingPurchases').toArray()
        for (const purchase of purchases) {
          const key = typeof purchase.itemKey === 'string' ? purchase.itemKey : ''
          const target = unique.get(key)
          if (!key || !target || knownKeys.has(key)) continue
          knownKeys.add(key)
          migrated.push({
            key,
            canonicalKey: target,
            displayName: '',
            categoryId: null,
            purchaseNote: '',
            updatedAt: Date.now(),
          })
        }
        await rulesTable.bulkPut(migrated)
      })
    // v14 makes instruction steps explicitly structured for the cook mode:
    // every step keeps its stable id, position and exact text, and gains an
    // optional list of explicit ingredient references. Existing text is never
    // split or rewritten. The new progress table stores only the last opened
    // step of a planned cooking event; it is local, not part of backups.
    this.version(14)
      .stores({
        recipes:
          'id, &importId, title, updatedAt, *categories, *cuisine, *dishType, effort, *tags, favorite, wantToCook, importUrl',
        images: 'id, recipeId, [recipeId+position]',
        mealPlans:
          'id, date, [date+slot], recipeId, freeDishId, pinned, cooked, cookSessionId, status',
        mealDays: 'date',
        settings: 'key',
        cookSessions: 'id, recipeId, freeDishId, date, status, [recipeId+date]',
        dayNotes: 'date, updatedAt',
        freeDishes: 'id, updatedAt',
        shoppingManualItems: 'id, shoppingDate, weekStart',
        shoppingChecks: 'id, weekStart, [weekStart+itemKey], itemKey',
        shoppingPurchases: 'id, shoppingDate, itemKey, createdAt, [itemKey+shoppingDate]',
        shoppingItemRules: 'key, updatedAt',
        shoppingQuantityCorrections:
          'id, shoppingDate, itemKey, [itemKey+shoppingDate]',
        pantryItems: null,
        cookProgress: 'cookSessionId, updatedAt',
      })
      .upgrade(async (transaction) => {
        await transaction
          .table('recipes')
          .toCollection()
          .modify((recipe: Record<string, unknown>) => {
            if (!Array.isArray(recipe.instructions)) return
            recipe.instructions = normalizeInstructionList(recipe.instructions)
          })
      })
    // v15 adds independent shopping lists and explicit demand allocations.
    // Existing weekly rows are migrated additively: the original date/week
    // fields stay untouched, and every row gets the deterministic standard
    // list of its Thursday–Wednesday period. Older weeks that used another
    // configured calendar week keep their exact date; their original grouping
    // is still available to the old aggregate view, so nothing is silently
    // rebooked. No recipe, plan or cooking event is modified.
    this.version(15)
      .stores({
        recipes:
          'id, &importId, title, updatedAt, *categories, *cuisine, *dishType, effort, *tags, favorite, wantToCook, importUrl',
        images: 'id, recipeId, [recipeId+position]',
        mealPlans:
          'id, date, [date+slot], recipeId, freeDishId, pinned, cooked, cookSessionId, status',
        mealDays: 'date',
        settings: 'key',
        cookSessions: 'id, recipeId, freeDishId, date, status, [recipeId+date]',
        dayNotes: 'date, updatedAt',
        freeDishes: 'id, updatedAt',
        shoppingManualItems: 'id, shoppingDate, weekStart, listId',
        shoppingChecks: 'id, weekStart, [weekStart+itemKey], itemKey',
        shoppingPurchases:
          'id, shoppingDate, itemKey, createdAt, [itemKey+shoppingDate], listId, manualItemId',
        shoppingItemRules: 'key, updatedAt',
        shoppingQuantityCorrections:
          'id, shoppingDate, itemKey, [itemKey+shoppingDate]',
        shoppingLists: 'id, kind, periodStart, createdAt',
        shoppingDemandAllocations:
          'id, periodStart, itemKey, listId, [periodStart+itemKey]',
        pantryItems: null,
        cookProgress: 'cookSessionId, updatedAt',
      })
      .upgrade(async (transaction) => {
        const now = Date.now()
        const listTable = transaction.table<ShoppingList, string>('shoppingLists')
        const manualTable = transaction.table<ShoppingManualItem, string>(
          'shoppingManualItems',
        )
        const purchaseTable = transaction.table<ShoppingPurchase, string>(
          'shoppingPurchases',
        )
        const periods = new Set<string>()
        const standardIdForDate = (date: string): string | null => {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
          try {
            const period = shoppingPeriod(date, LEGACY_STANDARD_PERIOD_START_DAY)
            periods.add(period.start)
            return standardShoppingListId(period.start)
          } catch {
            return null
          }
        }

        const manualItems = await manualTable.toArray()
        const manualUpdates: ShoppingManualItem[] = []
        for (const item of manualItems) {
          const date = item.shoppingDate || item.weekStart || ''
          const target = standardIdForDate(date)
          if (!target || item.listId) continue
          manualUpdates.push({ ...item, listId: target })
        }

        const purchases = await purchaseTable.toArray()
        const purchaseUpdates: ShoppingPurchase[] = []
        for (const purchase of purchases) {
          const target = standardIdForDate(purchase.shoppingDate)
          if (!target || purchase.listId) continue
          purchaseUpdates.push({ ...purchase, listId: target })
        }

        // A partially migrated database may already contain explicit standard
        // references. Make sure their list rows exist as well.
        const addStandardReference = (listId: string | undefined): void => {
          if (!listId?.startsWith('standard:')) return
          const start = listId.slice('standard:'.length)
          if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return
          try {
            periods.add(
              shoppingPeriod(start, LEGACY_STANDARD_PERIOD_START_DAY).start,
            )
          } catch {
            // Ignore an invalid legacy reference instead of failing the upgrade.
          }
        }
        for (const item of manualItems) addStandardReference(item.listId)
        for (const purchase of purchases) addStandardReference(purchase.listId)

        const existingLists = await listTable.toArray()
        const existingIds = new Set(existingLists.map((list) => list.id))
        const newLists = Array.from(periods)
          .filter((periodStart) => !existingIds.has(standardShoppingListId(periodStart)))
          .map((periodStart) =>
            standardShoppingListRecord(
              shoppingPeriodFromRange(periodStart, addDays(periodStart, 6)),
              DEFAULT_STANDARD_SHOPPING_LIST_NAME,
              now,
            ),
          )
        if (newLists.length > 0) await listTable.bulkPut(newLists)
        if (manualUpdates.length > 0) await manualTable.bulkPut(manualUpdates)
        if (purchaseUpdates.length > 0) await purchaseTable.bulkPut(purchaseUpdates)
      })
    // v16 marks historical rows whose legacy calendar week cannot be
    // reconstructed as the fixed Thursday–Wednesday period. The rows keep all
    // original dates and list references; readers surface them as review
    // conflicts instead of silently re-booking them. No row is deleted.
    this.version(16)
      .stores({
        recipes:
          'id, &importId, title, updatedAt, *categories, *cuisine, *dishType, effort, *tags, favorite, wantToCook, importUrl',
        images: 'id, recipeId, [recipeId+position]',
        mealPlans:
          'id, date, [date+slot], recipeId, freeDishId, pinned, cooked, cookSessionId, status',
        mealDays: 'date',
        settings: 'key',
        cookSessions: 'id, recipeId, freeDishId, date, status, [recipeId+date]',
        dayNotes: 'date, updatedAt',
        freeDishes: 'id, updatedAt',
        shoppingManualItems: 'id, shoppingDate, weekStart, listId',
        shoppingChecks: 'id, weekStart, [weekStart+itemKey], itemKey',
        shoppingPurchases:
          'id, shoppingDate, itemKey, createdAt, [itemKey+shoppingDate], listId, manualItemId',
        shoppingItemRules: 'key, updatedAt',
        shoppingQuantityCorrections:
          'id, shoppingDate, itemKey, [itemKey+shoppingDate]',
        shoppingLists: 'id, kind, periodStart, createdAt',
        shoppingDemandAllocations:
          'id, periodStart, itemKey, listId, [periodStart+itemKey]',
        pantryItems: null,
        cookProgress: 'cookSessionId, updatedAt',
      })
      .upgrade(async (transaction) => {
        const settingsTable = transaction.table<SettingRecord, string>('settings')
        const setting = await settingsTable.get('weekStartDay')
        const weekStartDay =
          typeof setting?.value === 'number' && Number.isFinite(setting.value)
            ? normalizeWeekday(Math.round(setting.value))
            : 3

        const manualTable = transaction.table<ShoppingManualItem, string>(
          'shoppingManualItems',
        )
        const purchaseTable = transaction.table<ShoppingPurchase, string>(
          'shoppingPurchases',
        )
        const manualUpdates: ShoppingManualItem[] = []
        for (const item of await manualTable.toArray()) {
          const date = item.shoppingDate || item.weekStart || ''
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
          try {
            const periodStart = shoppingPeriod(
              date,
              LEGACY_STANDARD_PERIOD_START_DAY,
            ).start
            const oldWeekStart =
              item.weekStart || startOfWeekOn(date, weekStartDay)
            if (oldWeekStart !== periodStart) {
              manualUpdates.push({ ...item, legacyWeekAmbiguous: true })
            }
          } catch {
            // Keep an invalid historical row untouched; readers skip it.
          }
        }
        const purchaseUpdates: ShoppingPurchase[] = []
        for (const purchase of await purchaseTable.toArray()) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(purchase.shoppingDate)) continue
          try {
            const periodStart = shoppingPeriod(
              purchase.shoppingDate,
              LEGACY_STANDARD_PERIOD_START_DAY,
            ).start
            const oldWeekStart = startOfWeekOn(purchase.shoppingDate, weekStartDay)
            if (oldWeekStart !== periodStart) {
              purchaseUpdates.push({ ...purchase, legacyWeekAmbiguous: true })
            }
          } catch {
            // Keep an invalid historical row untouched; readers skip it.
          }
        }
        if (manualUpdates.length > 0) await manualTable.bulkPut(manualUpdates)
        if (purchaseUpdates.length > 0) await purchaseTable.bulkPut(purchaseUpdates)
      })
    // v17 uses the shared legacy normalisation. It corrects v16 false
    // positives on free lists and explicit manual purchases, but keeps every
    // standard-list purchase without a stored historical week start as a
    // review conflict instead of inventing a Thursday grouping.
    this.version(17)
      .stores({
        recipes:
          'id, &importId, title, updatedAt, *categories, *cuisine, *dishType, effort, *tags, favorite, wantToCook, importUrl',
        images: 'id, recipeId, [recipeId+position]',
        mealPlans:
          'id, date, [date+slot], recipeId, freeDishId, pinned, cooked, cookSessionId, status',
        mealDays: 'date',
        settings: 'key',
        cookSessions: 'id, recipeId, freeDishId, date, status, [recipeId+date]',
        dayNotes: 'date, updatedAt',
        freeDishes: 'id, updatedAt',
        shoppingManualItems: 'id, shoppingDate, weekStart, listId',
        shoppingChecks: 'id, weekStart, [weekStart+itemKey], itemKey',
        shoppingPurchases:
          'id, shoppingDate, itemKey, createdAt, [itemKey+shoppingDate], listId, manualItemId',
        shoppingItemRules: 'key, updatedAt',
        shoppingQuantityCorrections:
          'id, shoppingDate, itemKey, [itemKey+shoppingDate]',
        shoppingLists: 'id, kind, periodStart, createdAt',
        shoppingDemandAllocations:
          'id, periodStart, itemKey, listId, [periodStart+itemKey]',
        pantryItems: null,
        cookProgress: 'cookSessionId, updatedAt',
      })
      .upgrade(async (transaction) => {
        const listTable = transaction.table<ShoppingList, string>('shoppingLists')
        const manualTable = transaction.table<ShoppingManualItem, string>(
          'shoppingManualItems',
        )
        const purchaseTable = transaction.table<ShoppingPurchase, string>(
          'shoppingPurchases',
        )
        const normalized = normalizeLegacyShoppingRows({
          lists: await listTable.toArray(),
          manualItems: await manualTable.toArray(),
          purchases: await purchaseTable.toArray(),
          legacySource: true,
        })
        if (normalized.changedManualItems > 0) {
          await manualTable.bulkPut(normalized.manualItems)
        }
        if (normalized.changedPurchases > 0) {
          await purchaseTable.bulkPut(normalized.purchases)
        }
      })
    // v18 introduces the persistent shopping-cycle configuration. Existing
    // installations start with Thursday (the historical shopping weekday) and
    // a neutral standard-list name; both are only editable defaults. Period
    // boundaries and ids of existing standard lists are preserved. Only the
    // obsolete generated "Donnerstags-Einkauf" display name is replaced, and
    // purchases keep their unknown provenance until a new write marks them.
    this.version(18)
      .stores({
        recipes:
          'id, &importId, title, updatedAt, *categories, *cuisine, *dishType, effort, *tags, favorite, wantToCook, importUrl',
        images: 'id, recipeId, [recipeId+position]',
        mealPlans:
          'id, date, [date+slot], recipeId, freeDishId, pinned, cooked, cookSessionId, status',
        mealDays: 'date',
        settings: 'key',
        cookSessions: 'id, recipeId, freeDishId, date, status, [recipeId+date]',
        dayNotes: 'date, updatedAt',
        freeDishes: 'id, updatedAt',
        shoppingManualItems: 'id, shoppingDate, weekStart, listId',
        shoppingChecks: 'id, weekStart, [weekStart+itemKey], itemKey',
        shoppingPurchases:
          'id, shoppingDate, itemKey, createdAt, [itemKey+shoppingDate], listId, manualItemId',
        shoppingItemRules: 'key, updatedAt',
        shoppingQuantityCorrections:
          'id, shoppingDate, itemKey, [itemKey+shoppingDate]',
        shoppingLists: 'id, kind, periodStart, createdAt',
        shoppingDemandAllocations:
          'id, periodStart, itemKey, listId, [periodStart+itemKey]',
        pantryItems: null,
        cookProgress: 'cookSessionId, updatedAt',
      })
      .upgrade(async (transaction) => {
        const settingsTable = transaction.table<SettingRecord, string>('settings')
        const dayRow = await settingsTable.get(SHOPPING_PERIOD_START_DAY_KEY)
        if (
          typeof dayRow?.value !== 'number' ||
          !Number.isFinite(dayRow.value)
        ) {
          await settingsTable.put({
            key: SHOPPING_PERIOD_START_DAY_KEY,
            value: DEFAULT_SHOPPING_PERIOD_START_DAY,
          })
        }
        const nameRow = await settingsTable.get(STANDARD_SHOPPING_LIST_NAME_KEY)
        if (typeof nameRow?.value !== 'string' || !nameRow.value.trim()) {
          await settingsTable.put({
            key: STANDARD_SHOPPING_LIST_NAME_KEY,
            value: DEFAULT_STANDARD_SHOPPING_LIST_NAME,
          })
        }

        const listTable = transaction.table<ShoppingList, string>('shoppingLists')
        for (const list of await listTable.toArray()) {
          if (
            list.kind !== 'standard' ||
            !list.periodStart ||
            !/^\d{4}-\d{2}-\d{2}$/.test(list.periodStart)
          ) {
            continue
          }
          const rawEnd =
            typeof list.periodEnd === 'string' &&
            /^\d{4}-\d{2}-\d{2}$/.test(list.periodEnd) &&
            list.periodEnd >= list.periodStart
              ? list.periodEnd
              : addDays(list.periodStart, 6)
          const period = shoppingPeriodFromRange(
            list.periodStart,
            rawEnd,
            list.isTransition === true,
          )
          const name = String(list.name ?? '').startsWith('Donnerstags-Einkauf')
            ? standardShoppingListName(DEFAULT_STANDARD_SHOPPING_LIST_NAME, period)
            : list.name
          if (list.periodEnd !== period.end || name !== list.name) {
            await listTable.put({ ...list, periodEnd: period.end, name })
          }
        }
      })
  }
}

export const db = new OpenCookDatabase()
