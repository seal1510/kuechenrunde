# Ingredient identity and shopping catalogue

This document describes the central ingredient catalogue of Küchenrunde and
how it removes duplicate shopping articles without per-ingredient special
cases.

## 1. Why duplicates appeared

Before the catalogue, one ingredient was interpreted by several independent
rule sets:

| Step | Code | What it decided |
| --- | --- | --- |
| Import | `normalizeIngredientName` | removes approximate words, size adjectives and plural shorthand |
| Shopping split | `splitIngredientName` | removes preparation/usage hints and moves some form words into a "variant" |
| Identity | `shoppingItemKey` | lowercases, folds umlauts, stems a plural suffix |
| Category | `guessShoppingCategory` | scores a keyword dictionary independently from the identity |
| Special cases | `PRODUCT_SYNONYMS`, `inferHerbFormVariant`, `inferFreshRootVariant` | small hand-written tables for a few products |

That caused the visible duplicates:

- `Korianderpulver` is a single compound word. The splitter only recognised
  form adjectives at the **start** of a name (`gemahlener Koriander`) and not
  the form suffix of a compound (`Korianderpulver`). It therefore became its
  own item, while `Koriander getrocknet` became another one.
- `gemahlener Kreuzkümmel`, `Kreuzkümmel gemahlen`, `Kreuzkümmelpulver` and
  `Cumin gemahlen` each produced a different key. The synonym `Cumin` was not
  known to any table, so its category also fell to "Sonstiges".
- Word order mattered: `Paprikapulver edelsüß` and `edelsüßes Paprikapulver`
  are different token sequences and had no shared identity.
- The unit heuristic invented a product form (`TL` → "getrocknet") for herbs.
  That form was a third identity next to fresh coriander and coriander powder.
- Category and identity were decided by different tables. A name could be
  recognised as produce for grouping while the same name was classified as a
  spice for the aisle.
- The same product (`Kurkuma`, `Kurkumapulver`, `Kurkuma gemahlen`) could be
  split or merged depending on which function looked at it first.

## 2. The unified model

`src/domain/ingredientCatalog.ts` is the only authority for known food names.
Its data lives in `src/domain/ingredientCatalogData.ts`.

```text
family (botanical/culinary base)
  └── product (what the shopper buys)
        ├── canonical label  -> display name and shopping key
        ├── category
        ├── forms            -> fresh, dried, ground, seed, whole, root, …
        ├── aliases          -> German/English synonyms and explicit spellings
        ├── qualifiers       -> edelsüß, rosenscharf, rot, weiß, …
        ├── unitHints        -> spoon, pinch, count, bunch, can, jar, package
        └── default          -> the bare family name
```

Resolution order in `resolveCatalogMatch()`:

1. Exact product alias (including the canonical label).
2. Exact bare family name; a documented unit hint may select a different form
   (`1 TL Koriander` → ground spice, `1 Stück Kurkuma` → fresh root).
3. Remove known form and qualifier words (`getrocknet`, `gemahlen`, `ganz`,
   `edelsüß`, …), then match the remaining base.
4. Split a curated compound suffix (`-pulver`, `-samen`, `-körner`,
   `-blätter`, `-wurzel`, `-stange`, `-mark`, `-öl`, `-mehl`, `-flocken`,
   `-sprossen`, `-milch`, `-saft`) and match the base.
5. A parenthetical annotation is not allowed to split a known product. If the
   base name resolves and every annotation resolves to the same catalogue
   family, the annotation is treated as a translation/synonym
   (`Kreuzkümmelpulver (Cumin)`, `Korianderpulver (Cilantro)`). If the
   annotation names a more specific product of the same family, that product
   wins (`Kreuzkümmel (Kreuzkümmelsamen)` → seeds). Unknown brands, qualities
   and preparation notes stay part of the identity (`Tomaten (Mutti)`).
6. A bare product-type number is a qualifier only when the matched family
   declares it (`Mehl (550)` → `Mehl Type 550`); arbitrary numbers never select
   a product.
7. Unknown or ambiguous combinations return `null`. Callers keep their existing
   conservative behaviour; no product form is invented.

The result is used everywhere:

- `splitIngredientName()` (therefore `classifyIngredientForShopping`,
  `buildShoppingList`, `pageView`, `demand.manualItemKey`)
- `shoppingItemKey()` via the canonical label
- `guessShoppingCategory()` for known products
- the displayed article name
- legacy key compatibility (`catalogShoppingKey`, `catalogKeyVariants`)

`PRODUCT_SYNONYMS` and the two product-specific form heuristics were removed.
The keyword category dictionary remains only as a fallback for names the
catalogue does not know.

## 3. Merge policy

Two names share one shopping position when they describe the same thing to buy:

| Merged | Reason |
| --- | --- |
| `Kreuzkümmel`, `Kreuzkümmelpulver`, `Cumin`, `Cumin gemahlen`, `gemahlener Kreuzkümmel` | same ground cumin jar |
| `Kurkuma`, `Kurkumapulver`, `Kurkuma gemahlen`, `Curcuma` | same ground turmeric jar |
| `Koriander`, `Korianderblätter`, `frischer Koriander`, `Cilantro` | fresh leaf herb |
| `Korianderpulver`, `gemahlener Koriander`, `Koriander getrocknet`, `gemahlene Koriandersamen` | ground coriander spice |
| `Paprikapulver edelsüß`, `edelsüßes Paprikapulver`, `Edelsüßpaprika` | same sweet paprika powder |
| `Tomaten`, `Tomate`, `Rispentomaten` | fresh tomatoes |
| `Tomaten Dose`, `Dosentomaten`, `Tomaten aus der Dose` | canned whole tomatoes |
| `Zwiebel`, `Zwiebeln`, `Speisezwiebel` | same onions |
| `Frühlingszwiebel`, `Lauchzwiebel`, `Jungzwiebel` | same spring onions |
| `Hähnchen`, `Huhn`, `Hähnchenfleisch` | same chicken |
| `Rinderhack`, `Rinderhackfleisch` | same minced beef |
| `Milch`, `Vollmilch`; `Sahne`, `Schlagsahne` | same dairy product |

Deliberately separate:

- fresh coriander vs. coriander seeds vs. ground coriander,
- fresh turmeric root vs. ground turmeric,
- whole cumin seeds vs. ground cumin,
- black pepper vs. white/green/pink pepper,
- wheat flour type 405 vs. 550 vs. 1050,
- fresh ginger vs. ground ginger,
- `Kümmel` (caraway) vs. `Kreuzkümmel` (cumin),
- bulb fennel vs. fennel seed,
- `Senf` (mustard) vs. `Senfkörner` vs. `Senfpulver`,
- `Süßkartoffel` vs. `Kartoffel`,
- `Lauch` vs. `Frühlingszwiebeln`,
- fresh cucumbers vs. pickled cucumbers,
- `Lachs` vs. `Räucherlachs`,
- `Thunfisch` vs. `Thunfischdose`,
- whole egg vs. egg yolk/egg white,
- `Spaghetti` vs. `Penne` (pasta shapes are separate purchases).

## 4. Data sources and licences

- **Open Food Facts ingredients taxonomy**
  <https://github.com/openfoodfacts/openfoodfacts-server/blob/main/taxonomies/food/ingredients.txt>
  used as reference for German names, synonyms, plant parts and international
  food vocabulary. Copyright (C) Open Food Facts contributors.
  The OFF terms of use name the database as **ODbL 1.0** and individual
  contents as **DbCL 1.0**:
  <https://world.openfoodfacts.org/terms-of-use>. The OFF server code is
  **AGPL-3.0**. The taxonomy files live in the AGPL repository but have no
  file-specific licence statement; their exact licence assignment is still
  open and must be clarified with Open Food Facts before a public release.
- **Open Food Facts ingredients processing taxonomy**
  <https://github.com/openfoodfacts/openfoodfacts-server/blob/main/taxonomies/ingredients_processing.txt>
  used as reference for processing terms such as `frisch`, `getrocknet`,
  `gemahlen`, `pulverisiert`, `Samen`, `Blätter`, `Wurzel`. The same open
  licence question applies.
- **einkaufslisten-card `kategorien.json`**
  <https://github.com/misterm2310/einkaufslisten-card>
  used for German shopping vocabulary. MIT, Copyright (c) 2026 misterm2310.

Both OFF taxonomies were retrieved from `main` on 2026-11-10; the commit SHAs
should be recorded for reproducibility. The catalogue is a curated, strongly
reduced selection. It is neither a full copy of the taxonomies nor an automatic
import, and it is shipped as source code, so no runtime API or database is
needed.

The **eleven shopping categories are this app's own taxonomy**. They are not
identical to openCook v0.4's twelve `GroceryCategory` values (which include
`pantry`, `snacks` and `pets`) and not identical to einkaufslisten-card's ten
categories. The keyword lists were compiled with reference to these sources and
arranged for this taxonomy.

Attribution is repeated in `NOTICE` and `public/legal/OFF-DATA-NOTICE.txt`.

## 5. Coverage (current catalogue state)

`catalogStats()` currently reports:

| Metric | Count |
| --- | --- |
| Product families | 248 |
| Concrete shopping products | 472 |
| Family-level names / bare synonyms | 925 |
| Explicit product aliases | 2,065 |
| Distinct normalised names in the lookup | 1,998 |
| Legacy keys mapped to a canonical identity | 1,852 |
| Distinct product forms | 17 |

Category distribution of the 472 products: produce 121, spices 130, canned 64,
drinks 32, grains 41, meat 41, dairy 28, bakery 8, frozen 1, other 3,
household 3.

These are catalogue numbers at the time of writing, not a claim of complete
coverage of world cuisine. The tests assert lower bounds and the absence of
alias/key conflicts; they do not pin the exact counts above.

## 6. Existing data

- No database migration was added; schema version 19 is unchanged.
- No cleanup runs at application start.
- Recipes are never rewritten. Shopping derives from the stored `raw` line and
  `reparseStoredIngredient` after a read-only parse.
- Purchases, rules and quantity corrections written under an old key are
  resolved through `catalogShoppingKey()` in `resolveKey()`, so historical rows
  stay attached without a migration. This also covers old composite keys such
  as `kreuzkummelpulv cumi` (from `Kreuzkümmelpulver (Cumin)`): when both key
  parts are catalogue products of the same family, the canonical key is used.
- Shopping list allocations are grouped by canonical identity at read time
  (`resolveShoppingDistribution`), and the move/reset/merge operations query all
  legacy key variants of the identity. Existing list assignments are therefore
  preserved; a subsequent write stores the canonical key.
- User-owned display names and categories still win over the catalogue.

## 7. Tests

- `src/domain/ingredientCatalog.test.ts` — data quality, coverage, synonym and
  form resolution across all requested groups, deliberate separations, legacy
  key mapping.
- `src/domain/ingredientIdentity.test.ts` — complete shopping lists from
  multiple recipes, amount aggregation, quantity-less rows, stored/legacy
  repair, parenthetical synonyms from stored recipes, historical
  purchases/rules, allocation compatibility.
- The existing suite (shopping, page view, list service, backup, migration,
  parser, UI tests) remains green.

## 8. Remaining limitations

- Coverage is curated, not exhaustive. Unknown names keep the previous
  conservative fallback and may still be separate from a known synonym.
- A bare herb name with a spoon unit is interpreted as the dried/ground spice
  (documented unit hint). This is a strong convention, not a proof; recipes that
  really mean fresh leaves measured in teaspoons keep a separate fresh product
  only when they say so.
- Bare names without any form or unit hint use the family default documented in
  the data (e.g. `Kurkuma` → ground, `Koriander` → fresh).
- Legacy allocation rows are displayed under the canonical identity immediately
  but are only physically normalized when the user next moves/resets/merges the
  item. This is intentional: no automatic background rewrite.
- Data is maintained as source code. Adding a new food means extending the
  family/product data and the coverage test, not adding a shopping-code special
  case.
