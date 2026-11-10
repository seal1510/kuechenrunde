/*
 * Küchenrunde (vormals openCook Web)
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Curated German-language ingredient catalogue for Küchenrunde.
 *
 * SOURCES AND LICENCES
 * --------------------
 * 1. Open Food Facts ingredients taxonomies
 *    https://github.com/openfoodfacts/openfoodfacts-server/blob/main/taxonomies/food/ingredients.txt
 *    https://github.com/openfoodfacts/openfoodfacts-server/blob/main/taxonomies/ingredients_processing.txt
 *    Copyright (C) Open Food Facts contributors.
 *    Der daraus abgeleitete, kuratierte Zutatenkatalog wird vorsorglich als
 *    Datenbestand unter der Open Database License (ODbL) 1.0 behandelt:
 *    https://opendatacommons.org/licenses/odbl/1-0/
 *    Die OFF-Dokumentation nennt für die OFF-Datenbank ODbL 1.0 und für
 *    Einzelinhalte DbCL 1.0; der OFF-Servercode steht unter AGPL-3.0.
 *    Quellenangabe: „Open Food Facts contributors“, ODbL 1.0.
 *    Der maschinenlesbare Download wird beim Build aus dieser Datei erzeugt:
 *    /legal/ingredient-catalog.json
 *    Used as the reference for German names, synonyms and processing terms
 *    (frisch, getrocknet, gemahlen, pulverisiert, Samen, Blätter, Wurzel …).
 *    This file is a curated, strongly reduced selection for Küchenrunde's own
 *    eleven shopping categories; it is not a copy of the taxonomies.
 * 2. misterm2310/einkaufslisten-card kategorien.json
 *    https://github.com/misterm2310/einkaufslisten-card
 *    Copyright (c) 2026 misterm2310, MIT licence.
 *    Used as a reference for German shopping vocabulary. The eleven categories
 *    are this app's own taxonomy; they are not identical to openCook's twelve
 *    categories or einkaufslisten-card's ten categories.
 *
 * The catalogue is deliberately static: no online API, no model and no
 * per-ingredient special case in the shopping code. Each entry describes a
 * product family and its concrete shopping products. A product form is only
 * merged when the shopper buys the same thing (dried and ground spices,
 * "Kreuzkümmel" and "Kreuzkümmelpulver"), while genuinely different products
 * (fresh coriander vs. coriander seeds, fresh turmeric root vs. turmeric
 * powder) stay separate.
 */

import type { CatalogFamilySpec } from './ingredientCatalog'

export const CATALOG_FAMILIES: readonly CatalogFamilySpec[] = [
  /* ---------------------------------------------------------------- */
  /* Leaf herbs: fresh produce vs. dried spice vs. seed               */
  /* ---------------------------------------------------------------- */
  {
    id: 'parsley',
    names: ['Petersilie', 'Petersilienkraut', 'Persilie', 'Blattpetersilie'],
    products: [
      { id: 'parsley-fresh', label: 'Petersilie', category: 'produce', forms: ['fresh', 'leaf'], default: true },
      {
        id: 'parsley-dried',
        label: 'Petersilie getrocknet',
        category: 'spices',
        forms: ['dried', 'ground'],
        unitHints: ['spoon', 'pinch'],
        aliases: [
          'getrocknete Petersilie', 'Petersilie getrocknet', 'Petersilienpulver',
          'Petersilie gerebelt', 'gerebelte Petersilie', 'Petersilienflocken',
          'dried parsley', 'parsley flakes',
        ],
      },
      {
        id: 'parsley-root',
        label: 'Petersilienwurzel',
        category: 'produce',
        forms: ['root'],
        aliases: ['Petersilienwurzeln', 'Wurzelpetersilie', 'Petersiliewurzel'],
      },
    ],
  },
  {
    id: 'basil',
    names: ['Basilikum', 'Basilikumblätter', 'Genovese Basilikum', 'Basilienkraut'],
    products: [
      { id: 'basil-fresh', label: 'Basilikum', category: 'produce', forms: ['fresh', 'leaf'], default: true },
      {
        id: 'basil-dried',
        label: 'Basilikum getrocknet',
        category: 'spices',
        forms: ['dried', 'ground'],
        unitHints: ['spoon', 'pinch'],
        aliases: [
          'getrocknetes Basilikum', 'Basilikum getrocknet', 'Basilikumpulver',
          'gerebeltes Basilikum', 'dried basil',
        ],
      },
    ],
  },
  {
    id: 'coriander',
    names: ['Koriander', 'Cilantro', 'Coriander', 'Korianderkraut'],
    products: [
      {
        id: 'coriander-fresh',
        label: 'Koriander',
        category: 'produce',
        forms: ['fresh', 'leaf'],
        default: true,
        aliases: [
          'Korianderblätter', 'frischer Koriander', 'frische Korianderblätter',
          'Koriandergrün', 'Korianderkraut', 'Cilantro', 'coriander leaves',
          'fresh coriander', 'Korianderblätter frisch',
        ],
      },
      {
        id: 'coriander-ground',
        label: 'Koriander gemahlen',
        category: 'spices',
        forms: ['ground', 'dried'],
        unitHints: ['spoon', 'pinch'],
        aliases: [
          'Korianderpulver', 'gemahlener Koriander', 'Koriander gemahlen',
          'getrockneter Koriander', 'Koriander getrocknet', 'Koriandermehl',
          'ground coriander', 'coriander powder', 'gemahlene Koriandersamen',
        ],
      },
      {
        id: 'coriander-seed',
        label: 'Koriandersamen',
        category: 'spices',
        forms: ['seed', 'whole'],
        aliases: [
          'Koriandersamen', 'Koriandersaat', 'Korianderkörner', 'Korianderkörner ganz',
          'ganze Koriandersamen', 'ganzer Koriander', 'Koriander ganz',
          'coriander seeds', 'whole coriander',
        ],
      },
    ],
  },
  {
    id: 'dill',
    names: ['Dill', 'Dillkraut', 'Dillspitzen', 'Gurkenkraut'],
    products: [
      { id: 'dill-fresh', label: 'Dill', category: 'produce', forms: ['fresh', 'leaf'], default: true },
      {
        id: 'dill-dried',
        label: 'Dill getrocknet',
        category: 'spices',
        forms: ['dried', 'ground'],
        unitHints: ['spoon', 'pinch'],
        aliases: ['getrockneter Dill', 'Dill getrocknet', 'Dillspitzen getrocknet', 'Dillpulver', 'dried dill'],
      },
      {
        id: 'dill-seed',
        label: 'Dillsamen',
        category: 'spices',
        forms: ['seed'],
        aliases: ['Dillsamen', 'Dillsaat', 'Dillkörner'],
      },
    ],
  },
  {
    id: 'thyme',
    names: ['Thymian', 'Thymianblättchen', 'Thymianzweige'],
    products: [
      { id: 'thyme-fresh', label: 'Thymian', category: 'produce', forms: ['fresh', 'leaf'], default: true },
      {
        id: 'thyme-dried',
        label: 'Thymian getrocknet',
        category: 'spices',
        forms: ['dried', 'ground'],
        unitHints: ['spoon', 'pinch'],
        aliases: ['getrockneter Thymian', 'Thymian getrocknet', 'Thymianpulver', 'dried thyme'],
      },
    ],
  },
  {
    id: 'rosemary',
    names: ['Rosmarin', 'Rosmarinnadeln', 'Rosmarinzweige'],
    products: [
      { id: 'rosemary-fresh', label: 'Rosmarin', category: 'produce', forms: ['fresh', 'leaf'], default: true },
      {
        id: 'rosemary-dried',
        label: 'Rosmarin getrocknet',
        category: 'spices',
        forms: ['dried', 'ground'],
        unitHints: ['spoon', 'pinch'],
        aliases: ['getrockneter Rosmarin', 'Rosmarin getrocknet', 'Rosmarinpulver', 'dried rosemary'],
      },
    ],
  },
  {
    id: 'oregano',
    names: ['Oregano', 'Origano', 'Oreganoblätter', 'Wilde Oregano'],
    products: [
      { id: 'oregano-fresh', label: 'Oregano', category: 'produce', forms: ['fresh', 'leaf'], default: true },
      {
        id: 'oregano-dried',
        label: 'Oregano getrocknet',
        category: 'spices',
        forms: ['dried', 'ground'],
        unitHints: ['spoon', 'pinch'],
        aliases: ['getrockneter Oregano', 'Oregano getrocknet', 'Oreganopulver', 'dried oregano'],
      },
    ],
  },
  {
    id: 'marjoram',
    names: ['Majoran', 'Majoranblätter'],
    products: [
      { id: 'marjoram-fresh', label: 'Majoran', category: 'produce', forms: ['fresh', 'leaf'], default: true },
      {
        id: 'marjoram-dried',
        label: 'Majoran getrocknet',
        category: 'spices',
        forms: ['dried', 'ground'],
        unitHints: ['spoon', 'pinch'],
        aliases: ['getrockneter Majoran', 'Majoran getrocknet', 'Majoranpulver', 'dried marjoram'],
      },
    ],
  },
  {
    id: 'sage',
    names: ['Salbei', 'Salbeiblätter'],
    products: [
      { id: 'sage-fresh', label: 'Salbei', category: 'produce', forms: ['fresh', 'leaf'], default: true },
      {
        id: 'sage-dried',
        label: 'Salbei getrocknet',
        category: 'spices',
        forms: ['dried', 'ground'],
        unitHints: ['spoon', 'pinch'],
        aliases: ['getrockneter Salbei', 'Salbei getrocknet', 'Salbeipulver', 'dried sage'],
      },
    ],
  },
  {
    id: 'tarragon',
    names: ['Estragon', 'Estragonblätter'],
    products: [
      { id: 'tarragon-fresh', label: 'Estragon', category: 'produce', forms: ['fresh', 'leaf'], default: true },
      {
        id: 'tarragon-dried',
        label: 'Estragon getrocknet',
        category: 'spices',
        forms: ['dried', 'ground'],
        unitHints: ['spoon', 'pinch'],
        aliases: ['getrockneter Estragon', 'Estragon getrocknet', 'Estragonpulver', 'dried tarragon'],
      },
    ],
  },
  {
    id: 'chervil',
    names: ['Kerbel', 'Kerbelkraut'],
    products: [
      { id: 'chervil-fresh', label: 'Kerbel', category: 'produce', forms: ['fresh', 'leaf'], default: true },
      {
        id: 'chervil-dried',
        label: 'Kerbel getrocknet',
        category: 'spices',
        forms: ['dried', 'ground'],
        unitHints: ['spoon', 'pinch'],
        aliases: ['getrockneter Kerbel', 'Kerbel getrocknet', 'Kerbelpulver', 'dried chervil'],
      },
    ],
  },
  {
    id: 'chives',
    names: ['Schnittlauch', 'Schnittlauchröllchen', 'Schnittlauchhalme'],
    products: [
      { id: 'chives-fresh', label: 'Schnittlauch', category: 'produce', forms: ['fresh', 'leaf'], default: true },
      {
        id: 'chives-dried',
        label: 'Schnittlauch getrocknet',
        category: 'spices',
        forms: ['dried', 'ground'],
        unitHints: ['spoon', 'pinch'],
        aliases: ['getrockneter Schnittlauch', 'Schnittlauch getrocknet', 'Schnittlauchpulver', 'dried chives'],
      },
    ],
  },
  {
    id: 'wild-garlic',
    names: ['Bärlauch', 'Barlauch', 'Bärlauchblätter'],
    products: [
      { id: 'wild-garlic-fresh', label: 'Bärlauch', category: 'produce', forms: ['fresh', 'leaf'], default: true },
      {
        id: 'wild-garlic-dried',
        label: 'Bärlauch getrocknet',
        category: 'spices',
        forms: ['dried', 'ground'],
        unitHints: ['spoon', 'pinch'],
        aliases: ['getrockneter Bärlauch', 'Bärlauch getrocknet', 'Bärlauchpulver'],
      },
    ],
  },
  {
    id: 'mint',
    names: ['Minze', 'Pfefferminze', 'Minzblätter', 'Nana', 'Krauseminze'],
    products: [
      { id: 'mint-fresh', label: 'Minze', category: 'produce', forms: ['fresh', 'leaf'], default: true },
      {
        id: 'mint-dried',
        label: 'Minze getrocknet',
        category: 'spices',
        forms: ['dried', 'ground'],
        unitHints: ['spoon', 'pinch'],
        aliases: ['getrocknete Minze', 'Minze getrocknet', 'Minzpulver', 'getrocknete Pfefferminze', 'Pfefferminzblätter'],
      },
    ],
  },
  {
    id: 'lemon-balm',
    names: ['Melisse', 'Zitronenmelisse', 'Melissenblätter'],
    products: [
      { id: 'lemon-balm-fresh', label: 'Zitronenmelisse', category: 'produce', forms: ['fresh', 'leaf'], default: true },
      {
        id: 'lemon-balm-dried',
        label: 'Zitronenmelisse getrocknet',
        category: 'spices',
        forms: ['dried', 'ground'],
        aliases: ['getrocknete Zitronenmelisse', 'Zitronenmelisse getrocknet', 'Melissenpulver'],
      },
    ],
  },
  {
    id: 'lovage',
    names: ['Liebstöckel', 'Liebstoeckel', 'Maggikraut', 'Liebstöckl'],
    products: [
      { id: 'lovage-fresh', label: 'Liebstöckel', category: 'produce', forms: ['fresh', 'leaf'], default: true },
      {
        id: 'lovage-dried',
        label: 'Liebstöckel getrocknet',
        category: 'spices',
        forms: ['dried', 'ground'],
        aliases: ['getrocknetes Liebstöckel', 'Liebstöckel getrocknet', 'Liebstöckelwürze'],
      },
    ],
  },
  {
    id: 'savory',
    names: ['Bohnenkraut', 'Sommerbohnenkraut', 'Winterbohnenkraut'],
    products: [
      { id: 'savory-fresh', label: 'Bohnenkraut', category: 'produce', forms: ['fresh', 'leaf'], default: true },
      {
        id: 'savory-dried',
        label: 'Bohnenkraut getrocknet',
        category: 'spices',
        forms: ['dried', 'ground'],
        aliases: ['getrocknetes Bohnenkraut', 'Bohnenkraut getrocknet'],
      },
    ],
  },
  {
    id: 'burnet',
    names: ['Pimpinelle', 'Kleiner Wiesenknopf'],
    products: [
      { id: 'burnet-fresh', label: 'Pimpinelle', category: 'produce', forms: ['fresh', 'leaf'], default: true },
    ],
  },
  {
    id: 'watercress',
    names: ['Brunnenkresse', 'Wasserkresse'],
    products: [
      { id: 'watercress-fresh', label: 'Brunnenkresse', category: 'produce', forms: ['fresh', 'leaf'], default: true },
    ],
  },
  {
    id: 'garden-cress',
    names: ['Kresse', 'Gartenkresse', 'Senfkresse'],
    products: [
      { id: 'garden-cress-fresh', label: 'Kresse', category: 'produce', forms: ['fresh', 'leaf'], default: true },
    ],
  },
  {
    id: 'lemongrass',
    names: ['Zitronengras', 'Lemongras', 'Zitronenhalme'],
    products: [
      { id: 'lemongrass-fresh', label: 'Zitronengras', category: 'produce', forms: ['fresh', 'stick'], default: true },
      {
        id: 'lemongrass-paste',
        label: 'Zitronengraspaste',
        category: 'spices',
        forms: ['paste'],
        aliases: ['Zitronengraspaste', 'Lemongraspaste', 'Tom-Yam-Paste'],
      },
    ],
  },
  {
    id: 'curry-leaves',
    names: ['Curryblätter', 'Curryblatt', 'Currykraut'],
    products: [
      { id: 'curry-leaves-fresh', label: 'Curryblätter', category: 'produce', forms: ['fresh', 'leaf'], default: true },
      {
        id: 'curry-leaves-dried',
        label: 'Curryblätter getrocknet',
        category: 'spices',
        forms: ['dried'],
        aliases: ['getrocknete Curryblätter'],
      },
    ],
  },
  {
    id: 'bay',
    names: ['Lorbeer', 'Lorbeerblatt', 'Lorbeerblätter', 'Lorbeerbaum', 'Bay Leaf'],
    products: [
      {
        id: 'bay-dried',
        label: 'Lorbeerblätter',
        category: 'spices',
        forms: ['dried', 'leaf', 'whole'],
        default: true,
        aliases: ['Lorbeerblätter', 'getrocknete Lorbeerblätter', 'Lorbeer', 'Lorbeerblatt'],
      },
      {
        id: 'bay-ground',
        label: 'Lorbeer gemahlen',
        category: 'spices',
        forms: ['ground'],
        aliases: ['Lorbeerpulver', 'gemahlener Lorbeer', 'Lorbeer gemahlen'],
      },
    ],
  },
  {
    id: 'lavender',
    names: ['Lavendel', 'Lavendelblüten'],
    products: [
      { id: 'lavender-fresh', label: 'Lavendel', category: 'produce', forms: ['fresh', 'leaf'], default: true },
      {
        id: 'lavender-dried',
        label: 'Lavendelblüten',
        category: 'spices',
        forms: ['dried'],
        aliases: ['getrocknete Lavendelblüten', 'Lavendelblüten getrocknet'],
      },
    ],
  },
  {
    id: 'chamomile',
    names: ['Kamille', 'Kamillenblüten', 'Echte Kamille'],
    products: [
      {
        id: 'chamomile-dried',
        label: 'Kamillenblüten',
        category: 'spices',
        forms: ['dried'],
        default: true,
        aliases: ['Kamille', 'Kamillenblüten', 'getrocknete Kamillenblüten'],
      },
    ],
  },
  {
    id: 'herb-mix-fresh',
    names: ['Kräuter', 'Frische Kräuter', 'Kräuterbund'],
    products: [
      {
        id: 'herb-mix-fresh-product',
        label: 'Kräuter',
        category: 'produce',
        forms: ['fresh', 'leaf'],
        default: true,
        unitHints: ['bunch', 'count'],
        aliases: ['Frische Kräuter', 'Kräuterbund', 'Kräutermischung frisch'],
      },
      {
        id: 'herb-mix-dried',
        label: 'Getrocknete Kräuter',
        category: 'spices',
        forms: ['dried', 'ground'],
        unitHints: ['spoon', 'pinch'],
        aliases: ['Getrocknete Kräuter', 'Kräutermischung', 'Kräuter getrocknet', 'Trockenkräuter'],
      },
    ],
  },

  /* ---------------------------------------------------------------- */
  /* Spices: ground, whole, seeds                                     */
  /* ---------------------------------------------------------------- */
  {
    id: 'salt',
    names: ['Salz', 'Speisesalz', 'Kochsalz', 'Tafelsalz', 'Tischsalz'],
    products: [
      {
        id: 'salt-table',
        label: 'Salz',
        category: 'spices',
        forms: ['ground'],
        default: true,
        aliases: ['Salz', 'Speisesalz', 'Kochsalz', 'Tafelsalz', 'Haushaltssalz'],
      },
      {
        id: 'salt-sea',
        label: 'Meersalz',
        category: 'spices',
        forms: ['ground', 'whole'],
        aliases: ['Meersalz', 'Salzflocken', 'Meersalzflocken', 'Fleur de Sel'],
      },
      {
        id: 'salt-rock',
        label: 'Steinsalz',
        category: 'spices',
        forms: ['ground', 'whole'],
        aliases: ['Steinsalz', 'Himalayasalz', 'Himalaya-Salz', 'Ur-Salz'],
      },
      {
        id: 'salt-iodized',
        label: 'Jodsalz',
        category: 'spices',
        forms: ['ground'],
        aliases: ['Jodsalz', 'jodiertes Salz'],
      },
    ],
  },
  {
    id: 'pepper',
    names: ['Pfeffer', 'Pfefferkörner', 'Pfeffer schwarz'],
    products: [
      {
        id: 'pepper-black',
        label: 'Pfeffer',
        category: 'spices',
        forms: ['ground'],
        default: true,
        qualifiers: ['schwarz'],
        unitHints: ['spoon', 'pinch'],
        aliases: [
          'Pfeffer', 'schwarzer Pfeffer', 'Pfeffer schwarz', 'Pfeffer gemahlen',
          'gemahlener Pfeffer', 'frisch gemahlener Pfeffer', 'Pfefferpulver',
          'schwarzer Pfeffer gemahlen', 'black pepper', 'ground black pepper',
        ],
      },
      {
        id: 'pepper-black-whole',
        label: 'Pfefferkörner',
        category: 'spices',
        forms: ['whole', 'seed'],
        qualifiers: ['schwarz'],
        aliases: ['Pfefferkörner', 'schwarze Pfefferkörner', 'Pfeffer ganz', 'ganzer Pfeffer', 'Pfeffer ungemahlen'],
      },
      {
        id: 'pepper-white',
        label: 'Weißer Pfeffer',
        category: 'spices',
        forms: ['ground'],
        qualifiers: ['weiss'],
        aliases: ['weißer Pfeffer', 'weisser Pfeffer', 'Pfeffer weiß', 'weißer Pfeffer gemahlen', 'white pepper'],
      },
      {
        id: 'pepper-green',
        label: 'Grüner Pfeffer',
        category: 'spices',
        forms: ['whole', 'ground'],
        qualifiers: ['grun'],
        aliases: ['grüner Pfeffer', 'gruener Pfeffer', 'Pfeffer grün', 'grüne Pfefferkörner'],
      },
      {
        id: 'pepper-pink',
        label: 'Rosa Pfeffer',
        category: 'spices',
        forms: ['whole', 'ground'],
        qualifiers: ['rosa'],
        aliases: ['rosa Pfeffer', 'roter Pfeffer', 'Pfeffer rosa', 'rosa Pfefferkörner'],
      },
    ],
  },
  {
    id: 'paprika-spice',
    names: ['Paprikapulver', 'Paprikagewürz', 'Paprika edelsüß', 'Edelsüßpaprika'],
    products: [
      {
        id: 'paprika-spice-sweet',
        label: 'Paprikapulver edelsüß',
        category: 'spices',
        forms: ['ground'],
        default: true,
        qualifiers: ['edelsuss'],
        aliases: [
          'Paprikapulver', 'Paprikapulver edelsüß', 'edelsüßes Paprikapulver',
          'Paprika edelsüß', 'Paprikagewürz', 'Edelsüßpaprika', 'edelsüßer Paprika',
          'Paprika pulver edelsüß', 'sweet paprika', 'paprika powder',
        ],
      },
      {
        id: 'paprika-spice-hot',
        label: 'Paprikapulver rosenscharf',
        category: 'spices',
        forms: ['ground'],
        qualifiers: ['rosenscharf', 'scharf'],
        aliases: [
          'Paprikapulver rosenscharf', 'rosenscharfes Paprikapulver',
          'Paprikapulver scharf', 'scharfes Paprikapulver', 'scharfer Paprika',
          'Paprika rosenscharf', 'hot paprika', 'smoked paprika hot',
        ],
      },
      {
        id: 'paprika-spice-smoked',
        label: 'Paprikapulver geräuchert',
        category: 'spices',
        forms: ['ground'],
        qualifiers: ['gerauchert', 'rauchig'],
        aliases: [
          'Paprikapulver geräuchert', 'geräuchertes Paprikapulver',
          'Paprika geräuchert', 'geräucherter Paprika', 'smoked paprika',
        ],
      },
    ],
  },
  {
    id: 'chili-spice',
    names: ['Chilipulver', 'Chiliflocken', 'Chilipaste'],
    products: [
      {
        id: 'chili-powder',
        label: 'Chilipulver',
        category: 'spices',
        forms: ['ground'],
        default: true,
        unitHints: ['spoon', 'pinch'],
        aliases: [
          'Chilipulver', 'gemahlener Chili', 'Chili gemahlen', 'Chilipfeffer',
          'chili powder',
        ],
      },
      {
        id: 'cayenne-pepper',
        label: 'Cayennepfeffer',
        category: 'spices',
        forms: ['ground'],
        aliases: ['Cayennepfeffer', 'Cayenne', 'Cayenne-Pfeffer', 'cayenne pepper'],
      },
      {
        id: 'chili-flakes',
        label: 'Chiliflocken',
        category: 'spices',
        forms: ['flakes', 'dried'],
        aliases: [
          'Chiliflocken', 'Chili-Flocken', 'Crushed Chili', 'getrocknete Chilischoten',
          'getrockneter Chili', 'Chilischoten getrocknet', 'Chili flakes',
        ],
      },
      {
        id: 'chili-paste',
        label: 'Chilipaste',
        category: 'spices',
        forms: ['paste'],
        aliases: ['Chilipaste', 'Chili-Paste', 'Chili Paste'],
      },
    ],
  },
  {
    id: 'cumin',
    names: ['Kreuzkümmel', 'Kreuzkuemmel', 'Cumin', 'Kumin', 'Römischer Kümmel'],
    products: [
      {
        id: 'cumin-ground',
        label: 'Kreuzkümmel',
        category: 'spices',
        forms: ['ground', 'dried'],
        default: true,
        unitHints: ['spoon', 'pinch'],
        aliases: [
          'Kreuzkümmel', 'Kreuzkuemmel', 'Cumin', 'Kumin', 'römischer Kümmel',
          'Kreuzkümmelpulver', 'gemahlener Kreuzkümmel', 'Kreuzkümmel gemahlen',
          'Cumin gemahlen', 'Cuminpulver', 'gemahlener Cumin', 'ground cumin',
          'cumin powder',
        ],
      },
      {
        id: 'cumin-seed',
        label: 'Kreuzkümmelsamen',
        category: 'spices',
        forms: ['seed', 'whole'],
        aliases: [
          'Kreuzkümmelsamen', 'Kreuzkümmelsaat', 'Kreuzkümmelkörner',
          'ganze Kreuzkümmelsamen', 'ganzer Kreuzkümmel', 'Kreuzkümmel ganz',
          'Kreuzkümmel Samen', 'Cumin Samen', 'Cumin seeds', 'whole cumin',
        ],
      },
    ],
  },
  {
    id: 'caraway',
    names: ['Kümmel', 'Kümmelsamen', 'Kümmelkörner', 'Wiesenkümmel'],
    products: [
      {
        id: 'caraway-ground',
        label: 'Kümmel',
        category: 'spices',
        forms: ['ground', 'dried'],
        default: true,
        aliases: ['Kümmel', 'gemahlener Kümmel', 'Kümmel gemahlen', 'Kümmelpulver', 'ground caraway'],
      },
      {
        id: 'caraway-seed',
        label: 'Kümmelsamen',
        category: 'spices',
        forms: ['seed', 'whole'],
        aliases: ['Kümmelsamen', 'Kümmelkörner', 'Kümmel ganz', 'ganzer Kümmel', 'caraway seeds'],
      },
    ],
  },
  {
    id: 'turmeric',
    names: ['Kurkuma', 'Curcuma', 'Gelbwurz', 'Gelbwurzel'],
    products: [
      {
        id: 'turmeric-ground',
        label: 'Kurkuma',
        category: 'spices',
        forms: ['ground', 'dried'],
        default: true,
        aliases: [
          'Kurkuma', 'Curcuma', 'Kurkumapulver', 'Curcumapulver',
          'gemahlene Kurkuma', 'Kurkuma gemahlen', 'Gelbwurz gemahlen',
          'turmeric', 'turmeric powder', 'ground turmeric',
        ],
      },
      {
        id: 'turmeric-fresh',
        label: 'Kurkuma frisch',
        category: 'produce',
        forms: ['fresh', 'root'],
        unitHints: ['count', 'bunch'],
        aliases: [
          'Kurkumawurzel', 'Kurkuma-Wurzel', 'frische Kurkuma', 'frischer Kurkuma',
          'Kurkuma frisch', 'frische Kurkumawurzel', 'Gelbwurzel frisch',
          'fresh turmeric', 'turmeric root',
        ],
      },
    ],
  },
  {
    id: 'ginger',
    names: ['Ingwer', 'Ingwerwurzel', 'Ingwerknolle'],
    products: [
      {
        id: 'ginger-fresh',
        label: 'Ingwer',
        category: 'produce',
        forms: ['fresh', 'root'],
        default: true,
        aliases: ['Ingwer', 'Ingwerwurzel', 'Ingwerknolle', 'frischer Ingwer', 'frischer Ingwerwurzel', 'fresh ginger'],
      },
      {
        id: 'ginger-ground',
        label: 'Ingwer gemahlen',
        category: 'spices',
        forms: ['ground', 'dried'],
        unitHints: ['spoon', 'pinch'],
        aliases: [
          'Ingwerpulver', 'gemahlener Ingwer', 'Ingwer gemahlen',
          'getrockneter Ingwer', 'ground ginger', 'ginger powder',
        ],
      },
      {
        id: 'ginger-paste',
        label: 'Ingwerpaste',
        category: 'spices',
        forms: ['paste'],
        aliases: ['Ingwerpaste', 'Ingwerpaste', 'Ingwer-Paste', 'ginger paste'],
      },
    ],
  },
  {
    id: 'galangal',
    names: ['Galgant', 'Galangal', 'Galgantwurzel'],
    products: [
      { id: 'galangal-fresh', label: 'Galgant', category: 'produce', forms: ['fresh', 'root'], default: true },
      {
        id: 'galangal-ground',
        label: 'Galgant gemahlen',
        category: 'spices',
        forms: ['ground', 'dried'],
        aliases: ['Galgantpulver', 'gemahlener Galgant', 'Galgant gemahlen'],
      },
    ],
  },
  {
    id: 'cardamom',
    names: ['Kardamom', 'Kardamomkapseln', 'Kardamomsamen'],
    products: [
      {
        id: 'cardamom-ground',
        label: 'Kardamom',
        category: 'spices',
        forms: ['ground', 'dried'],
        default: true,
        aliases: [
          'Kardamom', 'Kardamompulver', 'gemahlener Kardamom', 'Kardamom gemahlen',
          'cardamom', 'ground cardamom',
        ],
      },
      {
        id: 'cardamom-whole',
        label: 'Kardamomkapseln',
        category: 'spices',
        forms: ['whole', 'seed'],
        aliases: ['Kardamomkapseln', 'Kardamomsamen', 'Kardamom ganz', 'grüne Kardamomkapseln', 'cardamom pods'],
      },
    ],
  },
  {
    id: 'cinnamon',
    names: ['Zimt', 'Zimtpulver', 'Zimtstange', 'Ceylon-Zimt', 'Zimtkassie', 'Cassia'],
    products: [
      {
        id: 'cinnamon-ground',
        label: 'Zimt',
        category: 'spices',
        forms: ['ground', 'dried'],
        default: true,
        aliases: [
          'Zimt', 'Zimtpulver', 'gemahlener Zimt', 'Zimt gemahlen',
          'Ceylon-Zimt', 'Ceylonzimt', 'Zimtkassie', 'Cassia', 'cinnamon',
          'ground cinnamon',
        ],
      },
      {
        id: 'cinnamon-stick',
        label: 'Zimtstangen',
        category: 'spices',
        forms: ['stick', 'whole'],
        aliases: ['Zimtstangen', 'Zimtstange', 'Zimtrinde', 'Ceylon-Zimtstangen', 'cinnamon sticks'],
      },
    ],
  },
  {
    id: 'nutmeg',
    names: ['Muskat', 'Muskatnuss', 'Muskatnüsse', 'Muskatblüte', 'Macis'],
    products: [
      {
        id: 'nutmeg-ground',
        label: 'Muskat',
        category: 'spices',
        forms: ['ground', 'dried'],
        default: true,
        aliases: [
          'Muskat', 'Muskatnuss gemahlen', 'gemahlene Muskatnuss', 'Muskat gemahlen',
          'Muskatpulver', 'nutmeg', 'ground nutmeg',
        ],
      },
      {
        id: 'nutmeg-whole',
        label: 'Muskatnuss',
        category: 'spices',
        forms: ['whole'],
        aliases: ['Muskatnuss', 'Muskatnüsse', 'ganze Muskatnuss', 'whole nutmeg'],
      },
      {
        id: 'mace',
        label: 'Macis',
        category: 'spices',
        forms: ['ground', 'whole'],
        aliases: ['Macis', 'Muskatblüte', 'Macisblüte', 'Mace'],
      },
    ],
  },
  {
    id: 'cloves',
    names: ['Nelken', 'Nelke', 'Gewürznelken', 'Gewürznelke'],
    products: [
      {
        id: 'cloves-whole',
        label: 'Nelken',
        category: 'spices',
        forms: ['whole'],
        default: true,
        aliases: ['Nelken', 'Nelke', 'Gewürznelken', 'Gewürznelke', 'cloves'],
      },
      {
        id: 'cloves-ground',
        label: 'Nelken gemahlen',
        category: 'spices',
        forms: ['ground'],
        aliases: ['Nelkenpulver', 'gemahlene Nelken', 'Nelken gemahlen', 'ground cloves'],
      },
    ],
  },
  {
    id: 'star-anise',
    names: ['Sternanis', 'Sternanissterne'],
    products: [
      {
        id: 'star-anise-whole',
        label: 'Sternanis',
        category: 'spices',
        forms: ['whole'],
        default: true,
        aliases: ['Sternanis', 'Sternanissterne', 'Sternanis ganz', 'star anise'],
      },
      {
        id: 'star-anise-ground',
        label: 'Sternanis gemahlen',
        category: 'spices',
        forms: ['ground'],
        aliases: ['Sternanispulver', 'gemahlener Sternanis', 'Sternanis gemahlen'],
      },
    ],
  },
  {
    id: 'anise',
    names: ['Anis', 'Anissamen', 'Aniskörner'],
    products: [
      {
        id: 'anise-ground',
        label: 'Anis',
        category: 'spices',
        forms: ['ground', 'dried'],
        default: true,
        aliases: ['Anis', 'Anispulver', 'gemahlener Anis', 'Anis gemahlen', 'anise', 'ground anise'],
      },
      {
        id: 'anise-seed',
        label: 'Anissamen',
        category: 'spices',
        forms: ['seed', 'whole'],
        aliases: ['Anissamen', 'Aniskörner', 'Anis ganz', 'anise seeds'],
      },
    ],
  },
  {
    id: 'fennel-seed',
    names: ['Fenchelsamen', 'Fenchelsaat', 'Fenchelkörner', 'Fenchelpulver'],
    products: [
      {
        id: 'fennel-seed-whole',
        label: 'Fenchelsamen',
        category: 'spices',
        forms: ['seed', 'whole'],
        default: true,
        aliases: ['Fenchelsamen', 'Fenchelsaat', 'Fenchelkörner', 'Fenchel ganz', 'fennel seeds'],
      },
      {
        id: 'fennel-seed-ground',
        label: 'Fenchel gemahlen',
        category: 'spices',
        forms: ['ground'],
        aliases: ['Fenchelpulver', 'gemahlener Fenchel', 'Fenchel gemahlen', 'ground fennel'],
      },
    ],
  },
  {
    id: 'mustard',
    names: ['Senf', 'Senfkörner', 'Senfsamen', 'Senfsaat', 'Senfpulver'],
    products: [
      {
        id: 'mustard-condiment',
        label: 'Senf',
        category: 'spices',
        forms: ['paste'],
        default: true,
        aliases: [
          'Senf', 'Senf mittelscharf', 'mittelscharfer Senf', 'Dijon-Senf',
          'Dijonsenf', 'Senf scharf', 'scharfer Senf', 'gelber Senf', 'mustard',
        ],
      },
      {
        id: 'mustard-seed',
        label: 'Senfkörner',
        category: 'spices',
        forms: ['seed', 'whole'],
        aliases: ['Senfkörner', 'Senfsamen', 'Senfsaat', 'gelbe Senfkörner', 'braune Senfkörner', 'mustard seeds'],
      },
      {
        id: 'mustard-ground',
        label: 'Senfpulver',
        category: 'spices',
        forms: ['ground'],
        aliases: ['Senfpulver', 'gemahlener Senf', 'Senf gemahlen', 'mustard powder'],
      },
    ],
  },
  {
    id: 'black-cumin',
    names: ['Schwarzkümmel', 'Schwarzkümmelsamen', 'Nigella'],
    products: [
      {
        id: 'black-cumin-seed',
        label: 'Schwarzkümmel',
        category: 'spices',
        forms: ['seed', 'whole'],
        default: true,
        aliases: ['Schwarzkümmel', 'Schwarzkümmelsamen', 'Nigella', 'Nigella sativa', 'black cumin'],
      },
    ],
  },
  {
    id: 'fenugreek',
    names: ['Bockshornklee', 'Bockshornkleesamen', 'Fenugreek'],
    products: [
      {
        id: 'fenugreek-seed',
        label: 'Bockshornkleesamen',
        category: 'spices',
        forms: ['seed', 'whole'],
        default: true,
        aliases: ['Bockshornklee', 'Bockshornkleesamen', 'Fenugreek', 'Bockshornkleeblätter', 'fenugreek seeds'],
      },
      {
        id: 'fenugreek-ground',
        label: 'Bockshornklee gemahlen',
        category: 'spices',
        forms: ['ground'],
        aliases: ['Bockshornkleepulver', 'gemahlener Bockshornklee'],
      },
    ],
  },
  {
    id: 'sumac',
    names: ['Sumach', 'Sumak', 'Sumachgewürz'],
    products: [
      { id: 'sumac-ground', label: 'Sumach', category: 'spices', forms: ['ground'], default: true, aliases: ['Sumach', 'Sumak', 'Sumachgewürz', 'sumac'] },
    ],
  },
  {
    id: 'juniper',
    names: ['Wacholder', 'Wacholderbeeren', 'Wacholderbeere'],
    products: [
      {
        id: 'juniper-berries',
        label: 'Wacholderbeeren',
        category: 'spices',
        forms: ['whole', 'seed'],
        default: true,
        aliases: ['Wacholder', 'Wacholderbeeren', 'Wacholderbeere', 'juniper berries'],
      },
    ],
  },
  {
    id: 'allspice',
    names: ['Piment', 'Neugewürz', 'Allspice', 'Jamaikapfeffer'],
    products: [
      {
        id: 'allspice-whole',
        label: 'Piment',
        category: 'spices',
        forms: ['whole'],
        default: true,
        aliases: ['Piment', 'Neugewürz', 'Allspice', 'Jamaikapfeffer', 'Pimentkörner'],
      },
      {
        id: 'allspice-ground',
        label: 'Piment gemahlen',
        category: 'spices',
        forms: ['ground'],
        aliases: ['Pimentpulver', 'gemahlener Piment', 'Piment gemahlen', 'ground allspice'],
      },
    ],
  },
  {
    id: 'saffron',
    names: ['Safran', 'Safranfäden', 'Safranpulver'],
    products: [
      {
        id: 'saffron-threads',
        label: 'Safran',
        category: 'spices',
        forms: ['whole', 'other'],
        default: true,
        aliases: ['Safran', 'Safranfäden', 'Safranfaden', 'saffron'],
      },
      {
        id: 'saffron-ground',
        label: 'Safranpulver',
        category: 'spices',
        forms: ['ground'],
        aliases: ['Safranpulver', 'gemahlener Safran', 'Safran gemahlen'],
      },
    ],
  },
  {
    id: 'vanilla',
    names: ['Vanille', 'Vanilleschote', 'Vanilleschoten', 'Vanillemark'],
    products: [
      {
        id: 'vanilla-pod',
        label: 'Vanilleschote',
        category: 'spices',
        forms: ['whole', 'stick'],
        default: true,
        aliases: ['Vanille', 'Vanilleschote', 'Vanilleschoten', 'Vanillemark', 'Vanillepulver', 'vanilla'],
      },
    ],
  },
  {
    id: 'poppy-seed',
    names: ['Mohn', 'Mohnsamen', 'Mohnsaat', 'Blütenmohn'],
    products: [
      {
        id: 'poppy-seed-product',
        label: 'Mohn',
        category: 'spices',
        forms: ['seed', 'whole'],
        default: true,
        aliases: ['Mohn', 'Mohnsamen', 'Mohnsaat', 'Blütenmohn', 'poppy seeds'],
      },
    ],
  },
  {
    id: 'sesame',
    names: ['Sesam', 'Sesamsamen', 'Sesamkörner'],
    products: [
      {
        id: 'sesame-seed',
        label: 'Sesam',
        category: 'spices',
        forms: ['seed', 'whole'],
        default: true,
        aliases: ['Sesam', 'Sesamsamen', 'Sesamkörner', 'weißer Sesam', 'schwarzer Sesam', 'sesame seeds'],
      },
      {
        id: 'sesame-oil',
        label: 'Sesamöl',
        category: 'spices',
        forms: ['oil'],
        aliases: ['Sesamöl', 'geröstetes Sesamöl', 'sesame oil', 'toasted sesame oil'],
      },
      {
        id: 'tahini',
        label: 'Tahini',
        category: 'canned',
        forms: ['paste'],
        aliases: ['Tahini', 'Sesammus', 'Sesampaste', 'Tahina', 'tahini'],
      },
    ],
  },
  {
    id: 'coconut',
    names: ['Kokos', 'Kokosnuss', 'Kokosnüsse'],
    products: [
      {
        id: 'coconut-fresh',
        label: 'Kokosnuss',
        category: 'produce',
        forms: ['fresh', 'whole'],
        default: true,
        aliases: ['Kokos', 'Kokosnuss', 'Kokosnüsse', 'frische Kokosnuss', 'coconut'],
      },
      {
        id: 'coconut-milk',
        label: 'Kokosmilch',
        category: 'canned',
        forms: ['milk', 'canned'],
        aliases: ['Kokosmilch', 'Kokosnussmilch', 'Kokoscreme', 'Kokosnusscreme', 'coconut milk', 'coconut cream'],
      },
      {
        id: 'coconut-oil',
        label: 'Kokosöl',
        category: 'spices',
        forms: ['oil'],
        aliases: ['Kokosöl', 'Kokosfett', 'coconut oil'],
      },
      {
        id: 'coconut-flakes',
        label: 'Kokosraspeln',
        category: 'canned',
        forms: ['flakes', 'ground'],
        aliases: ['Kokosraspeln', 'Kokosflocken', 'Kokosraspel', 'desiccated coconut'],
      },
    ],
  },
  {
    id: 'spice-mix-curry',
    names: ['Currypulver', 'Currygewürz', 'Curry', 'Currypaste'],
    products: [
      {
        id: 'curry-powder',
        label: 'Currypulver',
        category: 'spices',
        forms: ['ground'],
        default: true,
        aliases: ['Currypulver', 'Currygewürz', 'Curry', 'Curry Pulver', 'curry powder'],
      },
      {
        id: 'curry-paste',
        label: 'Currypaste',
        category: 'spices',
        forms: ['paste'],
        aliases: ['Currypaste', 'rote Currypaste', 'grüne Currypaste', 'Thai-Currypaste', 'curry paste'],
      },
    ],
  },
  {
    id: 'garam-masala',
    names: ['Garam Masala', 'Garam-Masala'],
    products: [
      { id: 'garam-masala-product', label: 'Garam Masala', category: 'spices', forms: ['ground'], default: true, aliases: ['Garam Masala', 'Garam-Masala', 'garam masala'] },
    ],
  },
  {
    id: 'ras-el-hanout',
    names: ['Ras el Hanout', 'Ras-el-Hanout'],
    products: [
      { id: 'ras-el-hanout-product', label: 'Ras el Hanout', category: 'spices', forms: ['ground'], default: true, aliases: ['Ras el Hanout', 'Ras-el-Hanout', 'ras el hanout'] },
    ],
  },
  {
    id: 'baharat',
    names: ['Baharat', 'Baharat-Gewürz'],
    products: [
      { id: 'baharat-product', label: 'Baharat', category: 'spices', forms: ['ground'], default: true, aliases: ['Baharat', 'Baharat-Gewürz', 'baharat'] },
    ],
  },
  {
    id: 'harissa',
    names: ['Harissa', 'Harissa-Paste'],
    products: [
      { id: 'harissa-paste', label: 'Harissa', category: 'spices', forms: ['paste'], default: true, aliases: ['Harissa', 'Harissa-Paste', 'Harissapaste', 'harissa'] },
    ],
  },
  {
    id: 'gochujang',
    names: ['Gochujang', 'Gochujang-Paste'],
    products: [
      { id: 'gochujang-paste', label: 'Gochujang', category: 'canned', forms: ['paste'], default: true, aliases: ['Gochujang', 'Gochujang-Paste', 'koreanische Chilipaste'] },
    ],
  },
  {
    id: 'miso',
    names: ['Miso', 'Miso-Paste', 'Miso paste'],
    products: [
      { id: 'miso-paste', label: 'Miso', category: 'canned', forms: ['paste'], default: true, aliases: ['Miso', 'Miso-Paste', 'rote Miso-Paste', 'weiße Miso-Paste', 'miso paste'] },
    ],
  },
  {
    id: 'sambal',
    names: ['Sambal Oelek', 'Sambal', 'Sambal Olelek'],
    products: [
      { id: 'sambal-oelek', label: 'Sambal Oelek', category: 'canned', forms: ['paste'], default: true, aliases: ['Sambal Oelek', 'Sambal', 'Sambal Olelek', 'Sambal Olek'] },
    ],
  },
  {
    id: 'sriracha',
    names: ['Sriracha', 'Sriracha-Sauce'],
    products: [
      { id: 'sriracha-sauce', label: 'Sriracha', category: 'canned', forms: ['paste'], default: true, aliases: ['Sriracha', 'Sriracha-Sauce', 'Sriracha Soße'] },
    ],
  },
  {
    id: 'spice-mix-herbs-provence',
    names: ['Kräuter der Provence', 'Provence-Kräuter', 'Kräuter der Provinz'],
    products: [
      { id: 'herbes-de-provence', label: 'Kräuter der Provence', category: 'spices', forms: ['dried'], default: true, aliases: ['Kräuter der Provence', 'Provence-Kräuter', 'Kräuter der Provinz', 'Herbes de Provence'] },
    ],
  },
  {
    id: 'spice-mix-italian',
    names: ['Italienische Kräuter', 'Italienische Kräutermischung'],
    products: [
      { id: 'italian-herbs', label: 'Italienische Kräuter', category: 'spices', forms: ['dried'], default: true, aliases: ['Italienische Kräuter', 'Italienische Kräutermischung', 'italian herbs'] },
    ],
  },
  {
    id: 'spice-mix-grill',
    names: ['Grillgewürz', 'Grillgewürzmischung', 'BBQ-Gewürz'],
    products: [
      { id: 'grill-seasoning', label: 'Grillgewürz', category: 'spices', forms: ['ground'], default: true, aliases: ['Grillgewürz', 'Grillgewürzmischung', 'BBQ-Gewürz', 'Barbecue-Gewürz', 'bbq seasoning'] },
    ],
  },
  {
    id: 'spice-mix-generic',
    names: ['Gewürzmischung', 'Gewürze', 'Gewürz', 'Würzmischung'],
    products: [
      { id: 'spice-mix-generic-product', label: 'Gewürzmischung', category: 'spices', forms: ['ground', 'other'], default: true, aliases: ['Gewürzmischung', 'Gewürze', 'Gewürz', 'Würzmischung', 'Streuwürze'] },
    ],
  },
  {
    id: 'broth',
    names: ['Brühe', 'Bouillon', 'Fond', 'Suppenwürze'],
    products: [
      {
        id: 'broth-vegetable',
        label: 'Gemüsebrühe',
        category: 'canned',
        forms: ['other'],
        aliases: ['Gemüsebrühe', 'Gemüsebouillon', 'Gemüsefond', 'Gemüsebrühepulver', 'vegetable broth'],
      },
      {
        id: 'broth-beef',
        label: 'Rinderbrühe',
        category: 'canned',
        forms: ['other'],
        aliases: ['Rinderbrühe', 'Rinderbouillon', 'Rinderfond', 'Fleischbrühe', 'beef broth'],
      },
      {
        id: 'broth-chicken',
        label: 'Hühnerbrühe',
        category: 'canned',
        forms: ['other'],
        aliases: ['Hühnerbrühe', 'Hühnerbouillon', 'Hühnerfond', 'Hähnchenbrühe', 'Geflügelbrühe', 'chicken broth'],
      },
      {
        id: 'broth-generic',
        label: 'Brühe',
        category: 'canned',
        forms: ['other'],
        default: true,
        aliases: ['Brühe', 'Bouillon', 'Fond', 'Suppenwürze', 'Brühpulver', 'Instantbrühe', 'broth'],
      },
    ],
  },

  /* ---------------------------------------------------------------- */
  /* Aromatics and vegetables                                          */
  /* ---------------------------------------------------------------- */
  {
    id: 'onion',
    names: ['Zwiebel', 'Zwiebeln', 'Speisezwiebel', 'Haushaltszwiebel'],
    products: [
      {
        id: 'onion-fresh',
        label: 'Zwiebeln',
        category: 'produce',
        forms: ['fresh'],
        default: true,
        aliases: ['Zwiebel', 'Zwiebeln', 'Speisezwiebel', 'Haushaltszwiebel', 'Gemüsezwiebel', 'onion', 'onions'],
      },
      {
        id: 'onion-red',
        label: 'Rote Zwiebeln',
        category: 'produce',
        forms: ['fresh'],
        qualifiers: ['rot'],
        aliases: ['rote Zwiebel', 'rote Zwiebeln', 'Rote Zwiebeln', 'Zwiebel rot', 'red onion', 'red onions'],
      },
      {
        id: 'onion-powder',
        label: 'Zwiebelpulver',
        category: 'spices',
        forms: ['ground'],
        aliases: ['Zwiebelpulver', 'gemahlene Zwiebeln', 'Zwiebel gemahlen', 'onion powder'],
      },
    ],
  },
  {
    id: 'shallot',
    names: ['Schalotte', 'Schalotten', 'Echalote'],
    products: [
      { id: 'shallot-fresh', label: 'Schalotten', category: 'produce', forms: ['fresh'], default: true, aliases: ['Schalotte', 'Schalotten', 'Echalote', 'shallots'] },
    ],
  },
  {
    id: 'spring-onion',
    names: ['Frühlingszwiebel', 'Frühlingszwiebeln', 'Lauchzwiebel', 'Lauchzwiebeln', 'Jungzwiebel'],
    products: [
      {
        id: 'spring-onion-fresh',
        label: 'Frühlingszwiebeln',
        category: 'produce',
        forms: ['fresh'],
        default: true,
        aliases: ['Frühlingszwiebel', 'Frühlingszwiebeln', 'Lauchzwiebel', 'Lauchzwiebeln', 'Jungzwiebel', 'Jungzwiebeln', 'Bundzwiebel', 'spring onions', 'scallions'],
      },
    ],
  },
  {
    id: 'leek',
    names: ['Lauch', 'Porree', 'Lauchstange', 'Lauchstangen', 'Breitlauch'],
    products: [
      { id: 'leek-fresh', label: 'Lauch', category: 'produce', forms: ['fresh', 'stick'], default: true, aliases: ['Lauch', 'Porree', 'Lauchstange', 'Lauchstangen', 'Breitlauch', 'leek'] },
    ],
  },
  {
    id: 'garlic',
    names: ['Knoblauch', 'Knoblauchzehe', 'Knoblauchzehen', 'Knoblauchknolle'],
    products: [
      {
        id: 'garlic-fresh',
        label: 'Knoblauch',
        category: 'produce',
        forms: ['fresh'],
        default: true,
        aliases: ['Knoblauch', 'Knoblauchzehe', 'Knoblauchzehen', 'Knoblauchknolle', 'Knoblauchknollen', 'frischer Knoblauch', 'garlic'],
      },
      {
        id: 'garlic-powder',
        label: 'Knoblauchpulver',
        category: 'spices',
        forms: ['ground'],
        aliases: ['Knoblauchpulver', 'gemahlener Knoblauch', 'Knoblauch gemahlen', 'Knoblauchgranulat', 'garlic powder'],
      },
      {
        id: 'garlic-paste',
        label: 'Knoblauchpaste',
        category: 'spices',
        forms: ['paste'],
        aliases: ['Knoblauchpaste', 'Knoblauch-Paste', 'Knoblauchpüree', 'garlic paste'],
      },
      {
        id: 'garlic-oil',
        label: 'Knoblauchöl',
        category: 'spices',
        forms: ['oil'],
        aliases: ['Knoblauchöl', 'Knoblauch-Ol', 'garlic oil'],
      },
    ],
  },
  {
    id: 'tomato',
    names: ['Tomate', 'Tomaten', 'Rispentomate', 'Rispentomaten', 'Fleischtomate', 'Fleischtomaten'],
    products: [
      {
        id: 'tomato-fresh',
        label: 'Tomaten',
        category: 'produce',
        forms: ['fresh'],
        default: true,
        aliases: [
          'Tomate', 'Tomaten', 'Rispentomate', 'Rispentomaten', 'Fleischtomate',
          'Fleischtomaten', 'Strauchtomate', 'Strauchtomaten', 'Ochsenherztomate',
          'Ochsenherztomaten', 'tomato', 'tomatoes',
        ],
      },
      {
        id: 'tomato-cherry',
        label: 'Kirschtomaten',
        category: 'produce',
        forms: ['fresh'],
        aliases: ['Kirschtomate', 'Kirschtomaten', 'Cocktailtomate', 'Cocktailtomaten', 'Minitomate', 'Minitomaten', 'cherry tomatoes'],
      },
      {
        id: 'tomato-canned',
        label: 'Tomaten Dose',
        category: 'canned',
        forms: ['canned'],
        unitHints: ['can', 'jar'],
        aliases: [
          'Tomaten aus der Dose', 'Dosentomaten', 'Tomaten in der Dose', 'Tomaten Dose',
          'Dose Tomaten', 'geschälte Tomaten', 'geschälte Dosentomaten', 'Pelati',
          'ganze Tomaten', 'canned tomatoes', 'whole peeled tomatoes',
        ],
      },
      {
        id: 'tomato-passata',
        label: 'Passierte Tomaten',
        category: 'canned',
        forms: ['canned', 'paste'],
        aliases: [
          'Passierte Tomaten', 'passierte Tomaten', 'Tomaten passiert', 'Passata',
          'Tomatenpassata', 'Tomatenpüree', 'Tomatenpuree', 'Tomatensugo',
          'passata', 'tomato puree',
        ],
      },
      {
        id: 'tomato-chopped',
        label: 'Stückige Tomaten',
        category: 'canned',
        forms: ['canned'],
        aliases: [
          'Stückige Tomaten', 'Stuckige Tomaten', 'Gehackte Tomaten', 'Tomaten gehackt',
          'Tomaten stückig', 'Tomaten stuckig', 'Tomatenwürfel', 'Tomatenwuerfel',
          'Tomatenfruchtfleisch', 'chopped tomatoes',
        ],
      },
      {
        id: 'tomato-paste',
        label: 'Tomatenmark',
        category: 'canned',
        forms: ['paste'],
        aliases: ['Tomatenmark', 'Tomatenkonzentrat', 'Tomatenpaste', 'Tomatenpüree konzentriert', 'tomato paste'],
      },
      {
        id: 'tomato-dried',
        label: 'Getrocknete Tomaten',
        category: 'canned',
        forms: ['dried'],
        aliases: [
          'Getrocknete Tomaten', 'getrocknete Tomaten', 'Sonnengetrocknete Tomaten',
          'sonnengetrocknete Tomaten', 'Tomaten getrocknet', 'Sundried Tomatoes',
          'sun-dried tomatoes',
        ],
      },
      {
        id: 'tomato-sauce',
        label: 'Tomatensauce',
        category: 'canned',
        forms: ['paste', 'other'],
        aliases: ['Tomatensauce', 'Tomatensoße', 'Tomatensoße', 'Pizzasauce', 'Pizzasoße', 'tomato sauce'],
      },
      {
        id: 'tomato-juice',
        label: 'Tomatensaft',
        category: 'drinks',
        forms: ['juice'],
        aliases: ['Tomatensaft', 'tomato juice'],
      },
    ],
  },
  {
    id: 'potato',
    names: ['Kartoffel', 'Kartoffeln', 'Erdapfel', 'Erdäpfel', 'Speisekartoffel'],
    products: [
      {
        id: 'potato-fresh',
        label: 'Kartoffeln',
        category: 'produce',
        forms: ['fresh'],
        default: true,
        aliases: ['Kartoffel', 'Kartoffeln', 'Erdapfel', 'Erdäpfel', 'Speisekartoffel', 'Speisekartoffeln', 'potato', 'potatoes'],
      },
      {
        id: 'potato-floury',
        label: 'Mehligkochende Kartoffeln',
        category: 'produce',
        forms: ['fresh'],
        aliases: ['mehligkochende Kartoffeln', 'Mehligkartoffeln', 'mehlig kochende Kartoffeln', 'floury potatoes'],
      },
      {
        id: 'potato-waxy',
        label: 'Festkochende Kartoffeln',
        category: 'produce',
        forms: ['fresh'],
        aliases: ['festkochende Kartoffeln', 'Festkartoffeln', 'Salatkartoffeln', 'waxy potatoes'],
      },
      {
        id: 'potato-allround',
        label: 'Vorwiegend festkochende Kartoffeln',
        category: 'produce',
        forms: ['fresh'],
        aliases: ['vorwiegend festkochende Kartoffeln', 'allround potatoes'],
      },
      {
        id: 'potato-flakes',
        label: 'Kartoffelpüree',
        category: 'canned',
        forms: ['flakes', 'ground'],
        aliases: ['Kartoffelpüree', 'Kartoffelbrei', 'Kartoffelpüree Pulver', 'Kartoffelstock', 'instant mashed potatoes'],
      },
    ],
  },
  {
    id: 'sweet-potato',
    names: ['Süßkartoffel', 'Süßkartoffeln', 'Batate', 'Bataten'],
    products: [
      { id: 'sweet-potato-fresh', label: 'Süßkartoffeln', category: 'produce', forms: ['fresh'], default: true, aliases: ['Süßkartoffel', 'Süßkartoffeln', 'Süsskartoffel', 'Batate', 'Bataten', 'sweet potato'] },
    ],
  },
  {
    id: 'carrot',
    names: ['Karotte', 'Karotten', 'Möhre', 'Möhren', 'Mohrrübe', 'Mohrrüben'],
    products: [
      {
        id: 'carrot-fresh',
        label: 'Karotten',
        category: 'produce',
        forms: ['fresh'],
        default: true,
        aliases: ['Karotte', 'Karotten', 'Möhre', 'Möhren', 'Mohre', 'Mohren', 'Mohrrübe', 'Mohrrüben', 'carrot', 'carrots'],
      },
      {
        id: 'carrot-juice',
        label: 'Karottensaft',
        category: 'drinks',
        forms: ['juice'],
        aliases: ['Karottensaft', 'Möhrensaft', 'carrot juice'],
      },
    ],
  },
  {
    id: 'celery',
    names: ['Sellerie', 'Staudensellerie', 'Selleriestange', 'Selleriestangen', 'Knollensellerie', 'Sellerieknolle'],
    products: [
      {
        id: 'celery-stalk',
        label: 'Staudensellerie',
        category: 'produce',
        forms: ['fresh', 'stick'],
        default: true,
        aliases: ['Sellerie', 'Staudensellerie', 'Selleriestange', 'Selleriestangen', 'Bleichsellerie', 'celery'],
      },
      {
        id: 'celery-root',
        label: 'Knollensellerie',
        category: 'produce',
        forms: ['fresh', 'root'],
        aliases: ['Knollensellerie', 'Sellerieknolle', 'Sellerieknollen', 'Wurzelsellerie', 'celeriac'],
      },
      {
        id: 'celery-seed',
        label: 'Selleriesamen',
        category: 'spices',
        forms: ['seed'],
        aliases: ['Selleriesamen', 'Selleriesaat', 'celery seeds'],
      },
    ],
  },
  {
    id: 'cucumber',
    names: ['Gurke', 'Gurken', 'Salatgurke', 'Salatgurken', 'Einlegegurke', 'Einlegegurken'],
    products: [
      {
        id: 'cucumber-fresh',
        label: 'Gurken',
        category: 'produce',
        forms: ['fresh'],
        default: true,
        aliases: ['Gurke', 'Gurken', 'Salatgurke', 'Salatgurken', 'Einlegegurke', 'Einlegegurken', 'Minigurke', 'Minigurken', 'cucumber'],
      },
      {
        id: 'cucumber-pickled',
        label: 'Essiggurken',
        category: 'canned',
        forms: ['canned'],
        aliases: ['Essiggurken', 'Essiggurke', 'Gewürzgurken', 'Gewürzgurke', 'saure Gurken', 'Saure Gurken', 'Cornichons', 'pickles'],
      },
    ],
  },
  {
    id: 'bell-pepper',
    names: ['Paprika', 'Paprikaschote', 'Paprikaschoten', 'Spitzpaprika', 'Gemüsepaprika'],
    products: [
      {
        id: 'bell-pepper-fresh',
        label: 'Paprika',
        category: 'produce',
        forms: ['fresh'],
        default: true,
        qualifiers: ['rot', 'grun', 'gelb'],
        aliases: [
          'Paprika', 'Paprikaschote', 'Paprikaschoten', 'Spitzpaprika', 'Gemüsepaprika',
          'rote Paprika', 'rote Paprikaschoten', 'grüne Paprika', 'gelbe Paprika',
          'roter Paprika', 'grüner Paprika', 'gelber Paprika', 'bell pepper', 'bell peppers',
        ],
      },
    ],
  },
  {
    id: 'chili-fresh',
    names: ['Chili', 'Chilischote', 'Chilischoten', 'Chillischote', 'Chillischoten', 'Peperoni', 'Jalapeño', 'Jalapeno'],
    products: [
      {
        id: 'chili-fresh-product',
        label: 'Chili',
        category: 'produce',
        forms: ['fresh'],
        default: true,
        aliases: [
          'Chili', 'Chilischote', 'Chilischoten', 'Chillischote', 'Chillischoten',
          'Peperoni', 'Jalapeño', 'Jalapeno', 'Jalapeños', 'grüne Chilischote',
          'rote Chilischote', 'chilli', 'chili pepper', 'jalapeno',
        ],
      },
      {
        id: 'chili-oil',
        label: 'Chiliöl',
        category: 'spices',
        forms: ['oil'],
        aliases: ['Chiliöl', 'Chili-Ol', 'chili oil'],
      },
      {
        id: 'chili-dried-whole',
        label: 'Getrocknete Chilis',
        category: 'spices',
        forms: ['dried', 'whole'],
        aliases: ['Getrocknete Chilis', 'Ancho', 'Guajillo', 'Chipotle'],
      },
    ],
  },
  {
    id: 'zucchini',
    names: ['Zucchini', 'Zucchino', 'Courgette', 'Courgetten'],
    products: [
      { id: 'zucchini-fresh', label: 'Zucchini', category: 'produce', forms: ['fresh'], default: true, aliases: ['Zucchini', 'Zucchino', 'Courgette', 'Courgetten', 'zucchini'] },
    ],
  },
  {
    id: 'eggplant',
    names: ['Aubergine', 'Auberginen', 'Melanzani'],
    products: [
      { id: 'eggplant-fresh', label: 'Aubergine', category: 'produce', forms: ['fresh'], default: true, aliases: ['Aubergine', 'Auberginen', 'Melanzani', 'eggplant', 'aubergine'] },
    ],
  },
  {
    id: 'pumpkin',
    names: ['Kürbis', 'Kürbisse', 'Hokkaido', 'Butternut', 'Muskatkürbis'],
    products: [
      {
        id: 'pumpkin-fresh',
        label: 'Kürbis',
        category: 'produce',
        forms: ['fresh'],
        default: true,
        aliases: ['Kürbis', 'Kürbisse', 'Hokkaido', 'Hokkaido-Kürbis', 'Butternut', 'Butternut-Kürbis', 'Muskatkürbis', 'pumpkin', 'squash'],
      },
    ],
  },
  {
    id: 'cabbage-white',
    names: ['Weißkohl', 'Weisskohl', 'Weißkraut', 'Kraut'],
    products: [
      { id: 'white-cabbage', label: 'Weißkohl', category: 'produce', forms: ['fresh'], default: true, aliases: ['Weißkohl', 'Weisskohl', 'Weißkraut', 'Kraut', 'white cabbage'] },
    ],
  },
  {
    id: 'cabbage-red',
    names: ['Rotkohl', 'Rotkraut', 'Blaukraut'],
    products: [
      { id: 'red-cabbage', label: 'Rotkohl', category: 'produce', forms: ['fresh'], default: true, aliases: ['Rotkohl', 'Rotkraut', 'Blaukraut', 'red cabbage'] },
    ],
  },
  {
    id: 'cabbage-savoy',
    names: ['Wirsing', 'Wirsingkohl', 'Savoyenkohl'],
    products: [
      { id: 'savoy-cabbage', label: 'Wirsing', category: 'produce', forms: ['fresh'], default: true, aliases: ['Wirsing', 'Wirsingkohl', 'Savoyenkohl', 'savoy cabbage'] },
    ],
  },
  {
    id: 'cabbage-pointed',
    names: ['Spitzkohl', 'Spitzkraut'],
    products: [
      { id: 'pointed-cabbage', label: 'Spitzkohl', category: 'produce', forms: ['fresh'], default: true, aliases: ['Spitzkohl', 'Spitzkraut', 'pointed cabbage'] },
    ],
  },
  {
    id: 'brussels-sprouts',
    names: ['Rosenkohl', 'Rosenkohlsprossen', 'Brüsseler Kohl'],
    products: [
      { id: 'brussels-sprouts-fresh', label: 'Rosenkohl', category: 'produce', forms: ['fresh'], default: true, aliases: ['Rosenkohl', 'Rosenkohlsprossen', 'Brüsseler Kohl', 'Brussels sprouts'] },
    ],
  },
  {
    id: 'kale',
    names: ['Grünkohl', 'Gruenkohl', 'Braunkohl'],
    products: [
      { id: 'kale-fresh', label: 'Grünkohl', category: 'produce', forms: ['fresh'], default: true, aliases: ['Grünkohl', 'Gruenkohl', 'Braunkohl', 'kale'] },
    ],
  },
  {
    id: 'kohlrabi',
    names: ['Kohlrabi', 'Kohlraben'],
    products: [
      { id: 'kohlrabi-fresh', label: 'Kohlrabi', category: 'produce', forms: ['fresh'], default: true, aliases: ['Kohlrabi', 'Kohlraben', 'kohlrabi'] },
    ],
  },
  {
    id: 'cauliflower',
    names: ['Blumenkohl', 'Karfiol', 'Blumenkohlröschen'],
    products: [
      { id: 'cauliflower-fresh', label: 'Blumenkohl', category: 'produce', forms: ['fresh'], default: true, aliases: ['Blumenkohl', 'Karfiol', 'Blumenkohlröschen', 'cauliflower'] },
    ],
  },
  {
    id: 'broccoli',
    names: ['Brokkoli', 'Broccoli', 'Brokkoliröschen'],
    products: [
      { id: 'broccoli-fresh', label: 'Brokkoli', category: 'produce', forms: ['fresh'], default: true, aliases: ['Brokkoli', 'Broccoli', 'Brokkoliröschen', 'broccoli'] },
    ],
  },
  {
    id: 'romanesco',
    names: ['Romanesco', 'Romanesca'],
    products: [
      { id: 'romanesco-fresh', label: 'Romanesco', category: 'produce', forms: ['fresh'], default: true, aliases: ['Romanesco', 'Romanesca', 'romanesco'] },
    ],
  },
  {
    id: 'pak-choi',
    names: ['Pak Choi', 'Pakchoi', 'Bok Choy', 'Pak Choy'],
    products: [
      { id: 'pak-choi-fresh', label: 'Pak Choi', category: 'produce', forms: ['fresh'], default: true, aliases: ['Pak Choi', 'Pakchoi', 'Bok Choy', 'Pak Choy', 'pak choi'] },
    ],
  },
  {
    id: 'chinese-cabbage',
    names: ['Chinakohl', 'China-Kohl'],
    products: [
      { id: 'chinese-cabbage-fresh', label: 'Chinakohl', category: 'produce', forms: ['fresh'], default: true, aliases: ['Chinakohl', 'China-Kohl', 'napa cabbage'] },
    ],
  },
  {
    id: 'spinach',
    names: ['Spinat', 'Blattspinat', 'Babyspinat'],
    products: [
      { id: 'spinach-fresh', label: 'Spinat', category: 'produce', forms: ['fresh', 'leaf'], default: true, aliases: ['Spinat', 'Blattspinat', 'Babyspinat', 'spinat', 'spinach'] },
    ],
  },
  {
    id: 'chard',
    names: ['Mangold', 'Mangoldblätter'],
    products: [
      { id: 'chard-fresh', label: 'Mangold', category: 'produce', forms: ['fresh', 'leaf'], default: true, aliases: ['Mangold', 'Mangoldblätter', 'chard'] },
    ],
  },
  {
    id: 'rucola',
    names: ['Rucola', 'Rukkola', 'Rauke', 'Rucolababys'],
    products: [
      { id: 'rucola-fresh', label: 'Rucola', category: 'produce', forms: ['fresh', 'leaf'], default: true, aliases: ['Rucola', 'Rukkola', 'Rauke', 'Rucolababys', 'arugula', 'rocket'] },
    ],
  },
  {
    id: 'lamb-lettuce',
    names: ['Feldsalat', 'Nüsslisalat', 'Rapunzel'],
    products: [
      { id: 'lamb-lettuce-fresh', label: 'Feldsalat', category: 'produce', forms: ['fresh', 'leaf'], default: true, aliases: ['Feldsalat', 'Nüsslisalat', 'Rapunzel', 'lamb lettuce'] },
    ],
  },
  {
    id: 'lettuce',
    names: ['Kopfsalat', 'Eisbergsalat', 'Römersalat', 'Romanasalat', 'Lollo Rosso', 'Eichblattsalat', 'Bataviasalat'],
    products: [
      { id: 'lettuce-fresh', label: 'Kopfsalat', category: 'produce', forms: ['fresh', 'leaf'], default: true, aliases: ['Kopfsalat', 'Lollo Rosso', 'Eichblattsalat', 'Bataviasalat', 'head lettuce'] },
      { id: 'iceberg-lettuce', label: 'Eisbergsalat', category: 'produce', forms: ['fresh', 'leaf'], aliases: ['Eisbergsalat', 'Eisberg', 'iceberg lettuce'] },
      { id: 'romaine-lettuce', label: 'Römersalat', category: 'produce', forms: ['fresh', 'leaf'], aliases: ['Römersalat', 'Romanasalat', 'Romana', 'romaine lettuce'] },
    ],
  },
  {
    id: 'endive',
    names: ['Endivie', 'Endivien', 'Frisée', 'Frisee'],
    products: [
      { id: 'endive-fresh', label: 'Endivie', category: 'produce', forms: ['fresh', 'leaf'], default: true, aliases: ['Endivie', 'Endivien', 'Frisée', 'Frisee', 'endive'] },
    ],
  },
  {
    id: 'radicchio',
    names: ['Radicchio', 'Radicchios'],
    products: [
      { id: 'radicchio-fresh', label: 'Radicchio', category: 'produce', forms: ['fresh', 'leaf'], default: true, aliases: ['Radicchio', 'Radicchios', 'radicchio'] },
    ],
  },
  {
    id: 'mushroom',
    names: ['Champignon', 'Champignons', 'Pilze', 'Wiesenchampignon'],
    products: [
      {
        id: 'mushroom-fresh',
        label: 'Champignons',
        category: 'produce',
        forms: ['fresh'],
        default: true,
        aliases: ['Champignon', 'Champignons', 'Pilze', 'Wiesenchampignon', 'Braune Champignons', 'braune Champignons', 'weiße Champignons', 'mushrooms', 'button mushrooms'],
      },
      {
        id: 'mushroom-oyster',
        label: 'Austernpilze',
        category: 'produce',
        forms: ['fresh'],
        aliases: ['Austernpilz', 'Austernpilze', 'Kräuterseitling', 'Kräuterseitlinge', 'oyster mushrooms'],
      },
      {
        id: 'mushroom-shiitake',
        label: 'Shiitake',
        category: 'produce',
        forms: ['fresh', 'dried'],
        aliases: ['Shiitake', 'Shiitake-Pilze', 'getrocknete Shiitake', 'shiitake'],
      },
      {
        id: 'mushroom-chanterelle',
        label: 'Pfifferlinge',
        category: 'produce',
        forms: ['fresh'],
        aliases: ['Pfifferling', 'Pfifferlinge', 'Eierschwammerl', 'chanterelles'],
      },
      {
        id: 'mushroom-porcini',
        label: 'Steinpilze',
        category: 'produce',
        forms: ['fresh', 'dried'],
        aliases: ['Steinpilz', 'Steinpilze', 'getrocknete Steinpilze', 'porcini'],
      },
    ],
  },
  {
    id: 'asparagus',
    names: ['Spargel', 'Grüner Spargel', 'Weißer Spargel', 'Spargelstangen'],
    products: [
      { id: 'asparagus-fresh', label: 'Spargel', category: 'produce', forms: ['fresh', 'stick'], default: true, aliases: ['Spargel', 'Grüner Spargel', 'Weißer Spargel', 'Spargelstangen', 'asparagus'] },
    ],
  },
  {
    id: 'artichoke',
    names: ['Artischocke', 'Artischocken', 'Artischockenherzen', 'Artischockenherz'],
    products: [
      { id: 'artichoke-fresh', label: 'Artischocken', category: 'produce', forms: ['fresh'], default: true, aliases: ['Artischocke', 'Artischocken', 'artichokes'] },
      { id: 'artichoke-hearts', label: 'Artischockenherzen', category: 'canned', forms: ['canned', 'other'], aliases: ['Artischockenherzen', 'Artischockenherz', 'Artischockenböden', 'artichoke hearts'] },
    ],
  },
  {
    id: 'okra',
    names: ['Okra', 'Okraschoten', 'Bamija'],
    products: [
      { id: 'okra-fresh', label: 'Okra', category: 'produce', forms: ['fresh'], default: true, aliases: ['Okra', 'Okraschoten', 'Bamija', 'okra'] },
    ],
  },
  {
    id: 'corn',
    names: ['Mais', 'Maiskolben', 'Zuckermais', 'Maiskörner'],
    products: [
      {
        id: 'corn-cob',
        label: 'Maiskolben',
        category: 'produce',
        forms: ['fresh', 'whole'],
        default: true,
        aliases: ['Mais', 'Maiskolben', 'Zuckermais', 'Maiskörner', 'Maiskoerner', 'corn', 'sweet corn'],
      },
      {
        id: 'corn-canned',
        label: 'Mais Dose',
        category: 'canned',
        forms: ['canned'],
        unitHints: ['can', 'jar'],
        aliases: ['Mais aus der Dose', 'Dosenmais', 'Mais Dose', 'canned corn'],
      },
      {
        id: 'cornstarch',
        label: 'Maisstärke',
        category: 'grains',
        forms: ['flour', 'ground'],
        aliases: ['Maisstärke', 'Maisstaerke', 'Speisestärke', 'Speisestaerke', 'Stärke', 'Starke', 'cornstarch', 'corn starch'],
      },
    ],
  },
  {
    id: 'peas',
    names: ['Erbsen', 'Erbse', 'Zuckererbsen', 'Kaiserschoten', 'Markerbsen'],
    products: [
      {
        id: 'peas-fresh',
        label: 'Erbsen',
        category: 'produce',
        forms: ['fresh'],
        default: true,
        aliases: ['Erbse', 'Erbsen', 'Zuckererbsen', 'Kaiserschoten', 'Markerbsen', 'peas', 'green peas'],
      },
      {
        id: 'peas-frozen',
        label: 'Erbsen TK',
        category: 'frozen',
        forms: ['frozen'],
        aliases: ['Erbsen TK', 'TK-Erbsen', 'Tiefkühlerbsen', 'gefrorene Erbsen', 'frozen peas'],
      },
    ],
  },
  {
    id: 'beans-green',
    names: ['Grüne Bohnen', 'Gruene Bohnen', 'Brechbohnen', 'Schnittbohnen', 'Buschbohnen'],
    products: [
      {
        id: 'green-beans-fresh',
        label: 'Grüne Bohnen',
        category: 'produce',
        forms: ['fresh'],
        default: true,
        aliases: ['Grüne Bohnen', 'Gruene Bohnen', 'Brechbohnen', 'Schnittbohnen', 'Buschbohnen', 'Wachsbohnen', 'Prinzessbohnen', 'green beans'],
      },
    ],
  },
  {
    id: 'beans-dried',
    names: ['Kidneybohnen', 'Weiße Bohnen', 'Schwarze Bohnen', 'Cannellini', 'Borlotti', 'Mungbohnen', 'Adzukibohnen'],
    products: [
      {
        id: 'kidney-beans',
        label: 'Kidneybohnen',
        category: 'canned',
        forms: ['canned', 'seed'],
        default: true,
        aliases: ['Kidneybohnen', 'Kidney-Bohnen', 'rote Kidneybohnen', 'kidney beans'],
      },
      { id: 'white-beans', label: 'Weiße Bohnen', category: 'canned', forms: ['canned', 'seed'], aliases: ['Weiße Bohnen', 'Weisse Bohnen', 'weiße Bohnen', 'Cannellini Bohnen', 'Cannellini', 'white beans'] },
      { id: 'black-beans', label: 'Schwarze Bohnen', category: 'canned', forms: ['canned', 'seed'], aliases: ['Schwarze Bohnen', 'schwarze Bohnen', 'black beans'] },
      { id: 'borlotti-beans', label: 'Borlotti Bohnen', category: 'canned', forms: ['canned', 'seed'], aliases: ['Borlotti Bohnen', 'Borlotti', 'borlotti beans'] },
      { id: 'mung-beans', label: 'Mungbohnen', category: 'canned', forms: ['canned', 'seed'], aliases: ['Mungbohnen', 'Mungobohnen', 'Mung Beans', 'mung beans'] },
      { id: 'adzuki-beans', label: 'Adzukibohnen', category: 'canned', forms: ['canned', 'seed'], aliases: ['Adzukibohnen', 'Adzuki', 'adzuki beans'] },
      { id: 'soy-beans', label: 'Sojabohnen', category: 'canned', forms: ['canned', 'seed'], aliases: ['Sojabohnen', 'Sojabohne', 'soybeans'] },
    ],
  },
  {
    id: 'chickpeas',
    names: ['Kichererbsen', 'Kichererbse', 'Chana'],
    products: [
      {
        id: 'chickpeas-product',
        label: 'Kichererbsen',
        category: 'canned',
        forms: ['canned', 'seed'],
        default: true,
        aliases: ['Kichererbsen', 'Kichererbse', 'Chana', 'chickpeas'],
      },
    ],
  },
  {
    id: 'lentils',
    names: ['Linsen', 'Linse', 'Rote Linsen', 'Grüne Linsen', 'Belugalinsen', 'Puy-Linsen'],
    products: [
      { id: 'lentils-brown', label: 'Linsen', category: 'canned', forms: ['canned', 'seed'], default: true, aliases: ['Linsen', 'Linse', 'braune Linsen', 'Tellerlinsen', 'lentils'] },
      { id: 'lentils-red', label: 'Rote Linsen', category: 'canned', forms: ['canned', 'seed'], qualifiers: ['rot'], aliases: ['Rote Linsen', 'rote Linsen', 'rote Lentils', 'red lentils'] },
      { id: 'lentils-green', label: 'Grüne Linsen', category: 'canned', forms: ['canned', 'seed'], qualifiers: ['grun'], aliases: ['Grüne Linsen', 'gruene Linsen', 'Belugalinsen', 'Puy-Linsen', 'green lentils'] },
    ],
  },
  {
    id: 'avocado',
    names: ['Avocado', 'Avocados', 'Avocadoöl'],
    products: [
      { id: 'avocado-fresh', label: 'Avocado', category: 'produce', forms: ['fresh'], default: true, aliases: ['Avocado', 'Avocados', 'avocado'] },
      { id: 'avocado-oil', label: 'Avocadoöl', category: 'spices', forms: ['oil'], aliases: ['Avocadoöl', 'Avocado-Ol', 'avocado oil'] },
    ],
  },
  {
    id: 'lemon',
    names: ['Zitrone', 'Zitronen', 'Zitronensaft', 'Zitronenschale', 'Zitronenabrieb'],
    products: [
      {
        id: 'lemon-fresh',
        label: 'Zitrone',
        category: 'produce',
        forms: ['fresh'],
        default: true,
        aliases: ['Zitrone', 'Zitronen', 'unbehandelte Zitrone', 'Bio-Zitrone', 'lemon', 'lemons'],
      },
      { id: 'lemon-juice', label: 'Zitronensaft', category: 'drinks', forms: ['juice'], aliases: ['Zitronensaft', 'Zitronensaft frisch', 'lemon juice'] },
      { id: 'lemon-zest', label: 'Zitronenschale', category: 'produce', forms: ['other'], aliases: ['Zitronenschale', 'Zitronenabrieb', 'Zitronenzeste', 'Abrieb einer Zitrone', 'lemon zest'] },
    ],
  },
  {
    id: 'lime',
    names: ['Limette', 'Limetten', 'Limettensaft', 'Limettenschale'],
    products: [
      { id: 'lime-fresh', label: 'Limette', category: 'produce', forms: ['fresh'], default: true, aliases: ['Limette', 'Limetten', 'lime', 'limes'] },
      { id: 'lime-juice', label: 'Limettensaft', category: 'drinks', forms: ['juice'], aliases: ['Limettensaft', 'lime juice'] },
      { id: 'lime-zest', label: 'Limettenschale', category: 'produce', forms: ['other'], aliases: ['Limettenschale', 'Limonenabrieb', 'Limettenschale', 'lime zest'] },
    ],
  },
  {
    id: 'orange',
    names: ['Orange', 'Orangen', 'Apfelsine', 'Apfelsinen', 'Orangensaft'],
    products: [
      { id: 'orange-fresh', label: 'Orange', category: 'produce', forms: ['fresh'], default: true, aliases: ['Orange', 'Orangen', 'Apfelsine', 'Apfelsinen', 'orange', 'oranges'] },
      { id: 'orange-juice', label: 'Orangensaft', category: 'drinks', forms: ['juice'], aliases: ['Orangensaft', 'O-Saft', 'orange juice'] },
      { id: 'orange-zest', label: 'Orangenschale', category: 'produce', forms: ['other'], aliases: ['Orangenschale', 'Orangenabrieb', 'Orangenzeste', 'orange zest'] },
    ],
  },
  {
    id: 'mandarin',
    names: ['Mandarine', 'Mandarinen', 'Clementine', 'Clementinen'],
    products: [
      { id: 'mandarin-fresh', label: 'Mandarine', category: 'produce', forms: ['fresh'], default: true, aliases: ['Mandarine', 'Mandarinen', 'Clementine', 'Clementinen', 'mandarin'] },
    ],
  },
  {
    id: 'grapefruit',
    names: ['Grapefruit', 'Grapefruits', 'Pampelmuse'],
    products: [
      { id: 'grapefruit-fresh', label: 'Grapefruit', category: 'produce', forms: ['fresh'], default: true, aliases: ['Grapefruit', 'Grapefruits', 'Pampelmuse', 'grapefruit'] },
    ],
  },
  {
    id: 'apple',
    names: ['Apfel', 'Äpfel', 'Apfelsaft'],
    products: [
      { id: 'apple-fresh', label: 'Apfel', category: 'produce', forms: ['fresh'], default: true, aliases: ['Apfel', 'Äpfel', 'Aepfel', 'apple', 'apples'] },
      { id: 'apple-juice', label: 'Apfelsaft', category: 'drinks', forms: ['juice'], aliases: ['Apfelsaft', 'Apfelsaft naturtrüb', 'apple juice'] },
    ],
  },
  {
    id: 'pear',
    names: ['Birne', 'Birnen'],
    products: [
      { id: 'pear-fresh', label: 'Birne', category: 'produce', forms: ['fresh'], default: true, aliases: ['Birne', 'Birnen', 'pear', 'pears'] },
    ],
  },
  {
    id: 'banana',
    names: ['Banane', 'Bananen'],
    products: [
      { id: 'banana-fresh', label: 'Bananen', category: 'produce', forms: ['fresh'], default: true, aliases: ['Banane', 'Bananen', 'banana', 'bananas'] },
    ],
  },
  {
    id: 'mango',
    names: ['Mango', 'Mangos', 'Mango(s)'],
    products: [
      {
        id: 'mango-fresh',
        label: 'Mangos',
        category: 'produce',
        forms: ['fresh'],
        default: true,
        aliases: ['Mango', 'Mangos', 'Mango(s)', 'frische Mangos', 'mango'],
      },
    ],
  },
  {
    id: 'pineapple',
    names: ['Ananas', 'Ananasscheiben'],
    products: [
      { id: 'pineapple-fresh', label: 'Ananas', category: 'produce', forms: ['fresh'], default: true, aliases: ['Ananas', 'Ananasscheiben', 'pineapple'] },
    ],
  },
  {
    id: 'strawberry',
    names: ['Erdbeere', 'Erdbeeren'],
    products: [
      { id: 'strawberry-fresh', label: 'Erdbeeren', category: 'produce', forms: ['fresh'], default: true, aliases: ['Erdbeere', 'Erdbeeren', 'strawberries'] },
    ],
  },
  {
    id: 'raspberry',
    names: ['Himbeere', 'Himbeeren'],
    products: [
      { id: 'raspberry-fresh', label: 'Himbeeren', category: 'produce', forms: ['fresh'], default: true, aliases: ['Himbeere', 'Himbeeren', 'raspberries'] },
    ],
  },
  {
    id: 'blueberry',
    names: ['Heidelbeere', 'Heidelbeeren', 'Blaubeere', 'Blaubeeren'],
    products: [
      { id: 'blueberry-fresh', label: 'Heidelbeeren', category: 'produce', forms: ['fresh'], default: true, aliases: ['Heidelbeere', 'Heidelbeeren', 'Blaubeere', 'Blaubeeren', 'blueberries'] },
    ],
  },
  {
    id: 'blackberry',
    names: ['Brombeere', 'Brombeeren'],
    products: [
      { id: 'blackberry-fresh', label: 'Brombeeren', category: 'produce', forms: ['fresh'], default: true, aliases: ['Brombeere', 'Brombeeren', 'blackberries'] },
    ],
  },
  {
    id: 'currant',
    names: ['Johannisbeere', 'Johannisbeeren', 'Ribisel'],
    products: [
      { id: 'currant-fresh', label: 'Johannisbeeren', category: 'produce', forms: ['fresh'], default: true, aliases: ['Johannisbeere', 'Johannisbeeren', 'Ribisel', 'currants'] },
    ],
  },
  {
    id: 'cranberry',
    names: ['Cranberry', 'Cranberries', 'Preiselbeere', 'Preiselbeeren'],
    products: [
      { id: 'cranberry-fruit', label: 'Cranberries', category: 'produce', forms: ['fresh'], default: true, aliases: ['Cranberry', 'Cranberries', 'Preiselbeere', 'Preiselbeeren', 'cranberries'] },
      { id: 'cranberry-jam', label: 'Preiselbeerkonfitüre', category: 'canned', forms: ['paste'], aliases: ['Preiselbeerkonfitüre', 'Cranberrysauce', 'Preiselbeermarmelade', 'cranberry sauce'] },
    ],
  },
  {
    id: 'grape',
    names: ['Weintraube', 'Weintrauben', 'Traube', 'Trauben'],
    products: [
      { id: 'grape-fresh', label: 'Weintrauben', category: 'produce', forms: ['fresh'], default: true, aliases: ['Weintraube', 'Weintrauben', 'Traube', 'Trauben', 'grapes'] },
    ],
  },
  {
    id: 'cherry',
    names: ['Kirsche', 'Kirschen', 'Sauerkirsche', 'Sauerkirschen'],
    products: [
      { id: 'cherry-fresh', label: 'Kirschen', category: 'produce', forms: ['fresh'], default: true, aliases: ['Kirsche', 'Kirschen', 'Sauerkirsche', 'Sauerkirschen', 'cherries'] },
    ],
  },
  {
    id: 'plum',
    names: ['Pflaume', 'Pflaumen', 'Zwetschge', 'Zwetschgen'],
    products: [
      { id: 'plum-fresh', label: 'Pflaumen', category: 'produce', forms: ['fresh'], default: true, aliases: ['Pflaume', 'Pflaumen', 'Zwetschge', 'Zwetschgen', 'plums'] },
    ],
  },
  {
    id: 'apricot',
    names: ['Aprikose', 'Aprikosen', 'Marille', 'Marillen'],
    products: [
      { id: 'apricot-fresh', label: 'Aprikosen', category: 'produce', forms: ['fresh'], default: true, aliases: ['Aprikose', 'Aprikosen', 'Marille', 'Marillen', 'apricots'] },
    ],
  },
  {
    id: 'peach',
    names: ['Pfirsich', 'Pfirsiche', 'Nektarine', 'Nektarinen'],
    products: [
      { id: 'peach-fresh', label: 'Pfirsiche', category: 'produce', forms: ['fresh'], default: true, aliases: ['Pfirsich', 'Pfirsiche', 'Nektarine', 'Nektarinen', 'peaches', 'nectarines'] },
    ],
  },
  {
    id: 'melon',
    names: ['Melone', 'Melonen', 'Honigmelone', 'Wassermelone', 'Galia-Melone'],
    products: [
      { id: 'melon-fresh', label: 'Melone', category: 'produce', forms: ['fresh'], default: true, aliases: ['Melone', 'Melonen', 'Honigmelone', 'Wassermelone', 'Galia-Melone', 'melon', 'watermelon'] },
    ],
  },
  {
    id: 'fig',
    names: ['Feige', 'Feigen'],
    products: [
      { id: 'fig-fresh', label: 'Feigen', category: 'produce', forms: ['fresh'], default: true, aliases: ['Feige', 'Feigen', 'figs'] },
    ],
  },
  {
    id: 'date',
    names: ['Dattel', 'Datteln', 'Medjool'],
    products: [
      { id: 'date-dried', label: 'Datteln', category: 'produce', forms: ['dried', 'fresh'], default: true, aliases: ['Dattel', 'Datteln', 'Medjool', 'Medjool-Datteln', 'dates'] },
    ],
  },
  {
    id: 'raisin',
    names: ['Rosinen', 'Rosine', 'Sultaninen', 'Korinthen'],
    products: [
      { id: 'raisins', label: 'Rosinen', category: 'canned', forms: ['dried'], default: true, aliases: ['Rosinen', 'Rosine', 'Sultaninen', 'Korinthen', 'raisins'] },
    ],
  },
  {
    id: 'pomegranate',
    names: ['Granatapfel', 'Granatäpfel', 'Granatapfelkerne'],
    products: [
      { id: 'pomegranate-fresh', label: 'Granatapfel', category: 'produce', forms: ['fresh'], default: true, aliases: ['Granatapfel', 'Granatäpfel', 'Granatapfelkerne', 'pomegranate'] },
    ],
  },
  {
    id: 'kiwi',
    names: ['Kiwi', 'Kiwis', 'Kiwifrucht'],
    products: [
      { id: 'kiwi-fresh', label: 'Kiwi', category: 'produce', forms: ['fresh'], default: true, aliases: ['Kiwi', 'Kiwis', 'Kiwifrucht', 'kiwi'] },
    ],
  },
  {
    id: 'papaya',
    names: ['Papaya', 'Papayas'],
    products: [
      { id: 'papaya-fresh', label: 'Papaya', category: 'produce', forms: ['fresh'], default: true, aliases: ['Papaya', 'Papayas', 'papaya'] },
    ],
  },
  {
    id: 'passion-fruit',
    names: ['Passionsfrucht', 'Passionsfrüchte', 'Maracuja', 'Maracujas'],
    products: [
      { id: 'passion-fruit-fresh', label: 'Passionsfrucht', category: 'produce', forms: ['fresh'], default: true, aliases: ['Passionsfrucht', 'Passionsfrüchte', 'Maracuja', 'Maracujas', 'passion fruit'] },
    ],
  },
  {
    id: 'beetroot',
    names: ['Rote Bete', 'Rote Beete', 'Rote Rübe', 'Randen'],
    products: [
      { id: 'beetroot-fresh', label: 'Rote Bete', category: 'produce', forms: ['fresh', 'root'], default: true, aliases: ['Rote Bete', 'Rote Beete', 'Rote Rübe', 'Randen', 'beetroot'] },
    ],
  },
  {
    id: 'radish',
    names: ['Radieschen', 'Radiesli', 'Rettich', 'Daikon'],
    products: [
      { id: 'radish-fresh', label: 'Radieschen', category: 'produce', forms: ['fresh', 'root'], default: true, aliases: ['Radieschen', 'Radiesli', 'Rettich', 'Daikon', 'radish'] },
    ],
  },
  {
    id: 'parsnip',
    names: ['Pastinake', 'Pastinaken', 'Hammelmöhre'],
    products: [
      { id: 'parsnip-fresh', label: 'Pastinaken', category: 'produce', forms: ['fresh', 'root'], default: true, aliases: ['Pastinake', 'Pastinaken', 'Hammelmöhre', 'parsnips'] },
    ],
  },
  {
    id: 'rutabaga',
    names: ['Steckrübe', 'Steckrüben', 'Kohlrübe', 'Wruke'],
    products: [
      { id: 'rutabaga-fresh', label: 'Steckrüben', category: 'produce', forms: ['fresh', 'root'], default: true, aliases: ['Steckrübe', 'Steckrüben', 'Kohlrübe', 'Wruke', 'rutabaga'] },
    ],
  },
  {
    id: 'fennel-bulb',
    names: ['Fenchel', 'Fenchelknolle', 'Fenchelknollen'],
    products: [
      { id: 'fennel-bulb-fresh', label: 'Fenchel', category: 'produce', forms: ['fresh'], default: true, aliases: ['Fenchel', 'Fenchelknolle', 'Fenchelknollen', 'fennel'] },
    ],
  },
  {
    id: 'horseradish',
    names: ['Meerrettich', 'Kren', 'Meerrettichwurzel'],
    products: [
      { id: 'horseradish-fresh', label: 'Meerrettich', category: 'produce', forms: ['fresh', 'root'], default: true, aliases: ['Meerrettich', 'Kren', 'Meerrettichwurzel', 'horseradish'] },
      { id: 'horseradish-cream', label: 'Meerrettich Creme', category: 'canned', forms: ['paste'], aliases: ['Meerrettich Creme', 'Meerrettichcreme', 'Sahnemeerrettich', 'Meerrettich aus dem Glas', 'cream horseradish'] },
    ],
  },
  {
    id: 'wasabi',
    names: ['Wasabi', 'Wasabipaste'],
    products: [
      { id: 'wasabi-paste', label: 'Wasabi', category: 'spices', forms: ['paste'], default: true, aliases: ['Wasabi', 'Wasabipaste', 'Wasabi-Paste', 'wasabi'] },
    ],
  },
  {
    id: 'tofu',
    names: ['Tofu', 'Tofublock', 'Seidentofu', 'Räuchertofu'],
    products: [
      { id: 'tofu-plain', label: 'Tofu', category: 'other', forms: ['other'], default: true, aliases: ['Tofu', 'Tofublock', 'Seidentofu', 'Räuchertofu', 'Raeuchertofu', 'tofu'] },
    ],
  },
  {
    id: 'tempeh',
    names: ['Tempeh', 'Tempe'],
    products: [
      { id: 'tempeh-product', label: 'Tempeh', category: 'other', forms: ['other'], default: true, aliases: ['Tempeh', 'Tempe', 'tempeh'] },
    ],
  },
  {
    id: 'seitan',
    names: ['Seitan', 'Weizeneiweiß', 'Weizeneiweiss'],
    products: [
      { id: 'seitan-product', label: 'Seitan', category: 'other', forms: ['other'], default: true, aliases: ['Seitan', 'Weizeneiweiß', 'Weizeneiweiss', 'seitan'] },
    ],
  },

  /* ---------------------------------------------------------------- */
  /* Meat, fish and sausage                                            */
  /* ---------------------------------------------------------------- */
  {
    id: 'beef',
    names: ['Rindfleisch', 'Rind', 'Rinder', 'Rinderhack', 'Rinderhackfleisch', 'Rinderfilet', 'Rindersteak', 'Rinderbraten', 'Suppenfleisch'],
    products: [
      { id: 'beef-generic', label: 'Rindfleisch', category: 'meat', forms: ['fresh', 'other'], default: true, aliases: ['Rindfleisch', 'Rind', 'Rinder', 'beef'] },
      { id: 'beef-minced', label: 'Rinderhackfleisch', category: 'meat', forms: ['ground'], aliases: ['Rinderhack', 'Rinderhackfleisch', 'Rinderhackfleisch gemischt', 'ground beef'] },
      { id: 'beef-filet', label: 'Rinderfilet', category: 'meat', forms: ['other'], aliases: ['Rinderfilet', 'Rindersteak', 'Rumpsteak', 'Entrecôte', 'beef fillet'] },
      { id: 'beef-roast', label: 'Rinderbraten', category: 'meat', forms: ['other'], aliases: ['Rinderbraten', 'Rinderschmorbraten', 'Suppenfleisch', 'Rinderbrust', 'beef roast'] },
      { id: 'beef-goulash', label: 'Gulaschfleisch', category: 'meat', forms: ['other'], aliases: ['Gulaschfleisch', 'Rindergulasch', 'Gulasch', 'beef goulash'] },
    ],
  },
  {
    id: 'pork',
    names: ['Schweinefleisch', 'Schwein', 'Schweine', 'Schweinehack', 'Schweinebauch', 'Schweinenacken', 'Schweinefilet', 'Schweinekotelett', 'Schnitzel'],
    products: [
      { id: 'pork-generic', label: 'Schweinefleisch', category: 'meat', forms: ['fresh', 'other'], default: true, aliases: ['Schweinefleisch', 'Schwein', 'Schweine', 'pork'] },
      { id: 'pork-minced', label: 'Schweinehackfleisch', category: 'meat', forms: ['ground'], aliases: ['Schweinehack', 'Schweinehackfleisch', 'ground pork'] },
      { id: 'pork-belly', label: 'Schweinebauch', category: 'meat', forms: ['other'], aliases: ['Schweinebauch', 'Schweinebauchscheiben', 'pork belly'] },
      { id: 'pork-neck', label: 'Schweinenacken', category: 'meat', forms: ['other'], aliases: ['Schweinenacken', 'Nackensteak', 'pork neck'] },
      { id: 'pork-fillet', label: 'Schweinefilet', category: 'meat', forms: ['other'], aliases: ['Schweinefilet', 'Schweinelende', 'pork fillet'] },
      { id: 'pork-chop', label: 'Schweinekotelett', category: 'meat', forms: ['other'], aliases: ['Schweinekotelett', 'Kotelett', 'Koteletts', 'pork chop'] },
      { id: 'pork-schnitzel', label: 'Schnitzel', category: 'meat', forms: ['other'], aliases: ['Schnitzel', 'Schweineschnitzel', 'Jägerschnitzel', 'Wiener Schnitzel', 'schnitzel'] },
    ],
  },
  {
    id: 'chicken',
    names: ['Hähnchen', 'Haehnchen', 'Huhn', 'Hühner', 'Huehner', 'Hähnchenfleisch'],
    products: [
      { id: 'chicken-whole', label: 'Hähnchen', category: 'meat', forms: ['fresh', 'whole'], default: true, aliases: ['Hähnchen', 'Haehnchen', 'Huhn', 'Hühner', 'Huehner', 'Hähnchenfleisch', 'ganzes Hähnchen', 'chicken'] },
      { id: 'chicken-breast', label: 'Hähnchenbrust', category: 'meat', forms: ['other'], aliases: ['Hähnchenbrust', 'Hähnchenbrustfilet', 'Hühnerbrust', 'chicken breast'] },
      { id: 'chicken-fillet', label: 'Hähnchenfilet', category: 'meat', forms: ['other'], aliases: ['Hähnchenfilet', 'Hähnchenfilets', 'Hühnerfilet', 'chicken fillet'] },
      { id: 'chicken-thigh', label: 'Hähnchenschenkel', category: 'meat', forms: ['other'], aliases: ['Hähnchenschenkel', 'Hähnchenkeule', 'Hühnerschenkel', 'Keule', 'chicken thigh'] },
      { id: 'chicken-wing', label: 'Hähnchenflügel', category: 'meat', forms: ['other'], aliases: ['Hähnchenflügel', 'Hühnerflügel', 'Chicken Wings', 'chicken wings'] },
    ],
  },
  {
    id: 'turkey',
    names: ['Pute', 'Puten', 'Putenfleisch', 'Truthahn', 'Putenbrust', 'Putenfilet', 'Putenhack'],
    products: [
      { id: 'turkey-generic', label: 'Putenfleisch', category: 'meat', forms: ['fresh', 'other'], default: true, aliases: ['Pute', 'Puten', 'Putenfleisch', 'Truthahn', 'turkey'] },
      { id: 'turkey-breast', label: 'Putenbrust', category: 'meat', forms: ['other'], aliases: ['Putenbrust', 'Putenbrustfilet', 'Putenfilet', 'turkey breast'] },
      { id: 'turkey-minced', label: 'Putenhackfleisch', category: 'meat', forms: ['ground'], aliases: ['Putenhack', 'Putenhackfleisch', 'ground turkey'] },
    ],
  },
  {
    id: 'lamb',
    names: ['Lamm', 'Lammfleisch', 'Lammhack', 'Lammkotelett', 'Lammkeule'],
    products: [
      { id: 'lamb-generic', label: 'Lammfleisch', category: 'meat', forms: ['fresh', 'other'], default: true, aliases: ['Lamm', 'Lammfleisch', 'lamb'] },
      { id: 'lamb-minced', label: 'Lammhackfleisch', category: 'meat', forms: ['ground'], aliases: ['Lammhack', 'Lammhackfleisch', 'ground lamb'] },
      { id: 'lamb-chop', label: 'Lammkotelett', category: 'meat', forms: ['other'], aliases: ['Lammkotelett', 'Lammkoteletts', 'lamb chops'] },
      { id: 'lamb-leg', label: 'Lammkeule', category: 'meat', forms: ['other'], aliases: ['Lammkeule', 'Lammkeulen', 'leg of lamb'] },
    ],
  },
  {
    id: 'veal',
    names: ['Kalb', 'Kalbfleisch', 'Kalbsschnitzel'],
    products: [
      { id: 'veal-generic', label: 'Kalbfleisch', category: 'meat', forms: ['fresh', 'other'], default: true, aliases: ['Kalb', 'Kalbfleisch', 'Kalbsschnitzel', 'veal'] },
    ],
  },
  {
    id: 'bacon',
    names: ['Speck', 'Bauchspeck', 'Räucherspeck', 'Pancetta', 'Guanciale'],
    products: [
      { id: 'bacon-product', label: 'Speck', category: 'meat', forms: ['other'], default: true, aliases: ['Speck', 'Bauchspeck', 'Räucherspeck', 'Raeucherspeck', 'Pancetta', 'Guanciale', 'bacon'] },
    ],
  },
  {
    id: 'ham',
    names: ['Schinken', 'Kochschinken', 'Rohschinken', 'Prosciutto', 'Serrano'],
    products: [
      { id: 'ham-product', label: 'Schinken', category: 'meat', forms: ['other'], default: true, aliases: ['Schinken', 'Kochschinken', 'Rohschinken', 'Prosciutto', 'Serrano', 'Prosciutto di Parma', 'ham'] },
    ],
  },
  {
    id: 'salami',
    names: ['Salami', 'Salamischeiben', 'Salamiwurst'],
    products: [
      { id: 'salami-product', label: 'Salami', category: 'meat', forms: ['other'], default: true, aliases: ['Salami', 'Salamischeiben', 'Salamiwurst', 'salami'] },
    ],
  },
  {
    id: 'chorizo',
    names: ['Chorizo', 'Chorizos'],
    products: [
      { id: 'chorizo-product', label: 'Chorizo', category: 'meat', forms: ['other'], default: true, aliases: ['Chorizo', 'Chorizos', 'chorizo'] },
    ],
  },
  {
    id: 'sucuk',
    names: ['Sucuk', 'Sujuk'],
    products: [
      { id: 'sucuk-product', label: 'Sucuk', category: 'meat', forms: ['other'], default: true, aliases: ['Sucuk', 'Sujuk', 'sucuk'] },
    ],
  },
  {
    id: 'bratwurst',
    names: ['Bratwurst', 'Bratwürste', 'Wurst'],
    products: [
      { id: 'bratwurst-product', label: 'Bratwurst', category: 'meat', forms: ['other'], default: true, aliases: ['Bratwurst', 'Bratwürste', 'Bratwuerste', 'Wurst', 'Würste', 'bratwurst'] },
    ],
  },
  {
    id: 'salmon',
    names: ['Lachs', 'Lachsfilet', 'Räucherlachs', 'Wildlachs'],
    products: [
      { id: 'salmon-fresh', label: 'Lachs', category: 'meat', forms: ['fresh', 'other'], default: true, aliases: ['Lachs', 'Lachsfilet', 'Wildlachs', 'salmon'] },
      { id: 'salmon-smoked', label: 'Räucherlachs', category: 'meat', forms: ['other'], aliases: ['Räucherlachs', 'Raeucherlachs', 'Graved Lachs', 'smoked salmon'] },
    ],
  },
  {
    id: 'tuna',
    names: ['Thunfisch', 'Thunfischdose', 'Thunfischfilet'],
    products: [
      { id: 'tuna-fresh', label: 'Thunfisch', category: 'meat', forms: ['fresh', 'other'], default: true, aliases: ['Thunfisch', 'Thunfischfilet', 'tuna'] },
      { id: 'tuna-canned', label: 'Thunfischdose', category: 'canned', forms: ['canned'], aliases: ['Thunfischdose', 'Thunfisch aus der Dose', 'Dosenthunfisch', 'canned tuna'] },
    ],
  },
  {
    id: 'cod',
    names: ['Kabeljau', 'Dorsch', 'Kabeljaufilet', 'Dorschfilet'],
    products: [
      { id: 'cod-fresh', label: 'Kabeljau', category: 'meat', forms: ['fresh', 'other'], default: true, aliases: ['Kabeljau', 'Dorsch', 'Kabeljaufilet', 'Dorschfilet', 'cod'] },
    ],
  },
  {
    id: 'trout',
    names: ['Forelle', 'Forellen', 'Forellenfilet', 'Regenbogenforelle'],
    products: [
      { id: 'trout-fresh', label: 'Forelle', category: 'meat', forms: ['fresh', 'other'], default: true, aliases: ['Forelle', 'Forellen', 'Forellenfilet', 'Regenbogenforelle', 'trout'] },
    ],
  },
  {
    id: 'mackerel',
    names: ['Makrele', 'Makrelen', 'Makrelenfilet'],
    products: [
      { id: 'mackerel-fresh', label: 'Makrele', category: 'meat', forms: ['fresh', 'other'], default: true, aliases: ['Makrele', 'Makrelen', 'Makrelenfilet', 'mackerel'] },
    ],
  },
  {
    id: 'herring',
    names: ['Hering', 'Heringsfilet', 'Matjes', 'Matjesfilet'],
    products: [
      { id: 'herring-product', label: 'Hering', category: 'meat', forms: ['fresh', 'other'], default: true, aliases: ['Hering', 'Heringsfilet', 'Matjes', 'Matjesfilet', 'herring'] },
    ],
  },
  {
    id: 'sardine',
    names: ['Sardine', 'Sardinen', 'Sardellen', 'Sardellenfilet'],
    products: [
      { id: 'sardines-canned', label: 'Sardinen', category: 'canned', forms: ['canned'], default: true, aliases: ['Sardine', 'Sardinen', 'Sardellen', 'Sardellenfilet', 'Anchovis', 'sardines', 'anchovies'] },
    ],
  },
  {
    id: 'shrimp',
    names: ['Garnele', 'Garnelen', 'Shrimps', 'Krabben', 'Scampi', 'Crevetten'],
    products: [
      { id: 'shrimp-fresh', label: 'Garnelen', category: 'meat', forms: ['fresh', 'frozen'], default: true, aliases: ['Garnele', 'Garnelen', 'Shrimps', 'Krabben', 'Scampi', 'Crevetten', 'Prawns', 'shrimp', 'prawns'] },
    ],
  },
  {
    id: 'mussels',
    names: ['Muschel', 'Muscheln', 'Miesmuscheln'],
    products: [
      { id: 'mussels-product', label: 'Muscheln', category: 'meat', forms: ['fresh'], default: true, aliases: ['Muschel', 'Muscheln', 'Miesmuscheln', 'mussels'] },
    ],
  },
  {
    id: 'squid',
    names: ['Tintenfisch', 'Tintenfische', 'Calamari', 'Kalamari'],
    products: [
      { id: 'squid-product', label: 'Tintenfisch', category: 'meat', forms: ['fresh', 'frozen'], default: true, aliases: ['Tintenfisch', 'Tintenfische', 'Calamari', 'Kalamari', 'squid'] },
    ],
  },

  /* ---------------------------------------------------------------- */
  /* Dairy and eggs                                                    */
  /* ---------------------------------------------------------------- */
  {
    id: 'milk',
    names: ['Milch', 'Vollmilch', 'Frischmilch', 'H-Milch'],
    products: [
      {
        id: 'milk-whole',
        label: 'Milch',
        category: 'dairy',
        forms: ['other'],
        default: true,
        aliases: ['Milch', 'Vollmilch', 'Frischmilch', 'H-Milch', 'Weidemilch', 'milk', 'whole milk'],
      },
      { id: 'milk-plant', label: 'Pflanzenmilch', category: 'dairy', forms: ['milk'], aliases: ['Pflanzenmilch', 'Hafermilch', 'Mandelmilch', 'Sojamilch', 'Reismilch', 'plant milk', 'oat milk'] },
    ],
  },
  {
    id: 'butter',
    names: ['Butter', 'Süßrahmbutter', 'Salzbutter'],
    products: [
      { id: 'butter-product', label: 'Butter', category: 'dairy', forms: ['other'], default: true, aliases: ['Butter', 'Süßrahmbutter', 'Salzbutter', 'Kochbutter', 'butter'] },
    ],
  },
  {
    id: 'cream',
    names: ['Sahne', 'Schlagsahne', 'Kochsahne', 'Süße Sahne', 'Sahne zum Kochen'],
    products: [
      { id: 'cream-product', label: 'Sahne', category: 'dairy', forms: ['other'], default: true, aliases: ['Sahne', 'Schlagsahne', 'Kochsahne', 'Süße Sahne', 'Sahne zum Kochen', 'Crème double', 'Creme double', 'cream'] },
    ],
  },
  {
    id: 'creme-fraiche',
    names: ['Crème fraîche', 'Creme fraiche', 'Crème fraiche'],
    products: [
      { id: 'creme-fraiche-product', label: 'Crème fraîche', category: 'dairy', forms: ['other'], default: true, aliases: ['Crème fraîche', 'Creme fraiche', 'Crème fraiche', 'Creme fraîche', 'creme fraiche'] },
    ],
  },
  {
    id: 'sour-cream',
    names: ['Schmand', 'Sauerrahm', 'Saure Sahne'],
    products: [
      { id: 'sour-cream-product', label: 'Schmand', category: 'dairy', forms: ['other'], default: true, aliases: ['Schmand', 'Sauerrahm', 'Saure Sahne', 'sour cream'] },
    ],
  },
  {
    id: 'yogurt',
    names: ['Joghurt', 'Jogurt', 'Naturjoghurt', 'Griechischer Joghurt', 'Skyr'],
    products: [
      { id: 'yogurt-natural', label: 'Joghurt', category: 'dairy', forms: ['other'], default: true, aliases: ['Joghurt', 'Jogurt', 'Naturjoghurt', 'yogurt'] },
      { id: 'yogurt-greek', label: 'Griechischer Joghurt', category: 'dairy', forms: ['other'], aliases: ['Griechischer Joghurt', 'Griechisches Joghurt', 'greek yogurt'] },
      { id: 'skyr', label: 'Skyr', category: 'dairy', forms: ['other'], aliases: ['Skyr', 'skyr'] },
    ],
  },
  {
    id: 'quark',
    names: ['Quark', 'Speisequark', 'Magerquark', 'Sahnequark'],
    products: [
      { id: 'quark-product', label: 'Quark', category: 'dairy', forms: ['other'], default: true, aliases: ['Quark', 'Speisequark', 'Magerquark', 'Sahnequark', 'quark'] },
    ],
  },
  {
    id: 'cream-cheese',
    names: ['Frischkäse', 'Frischkase', 'Philadelphia', 'Doppelrahmfrischkäse'],
    products: [
      { id: 'cream-cheese-product', label: 'Frischkäse', category: 'dairy', forms: ['other'], default: true, aliases: ['Frischkäse', 'Frischkase', 'Doppelrahmfrischkäse', 'cream cheese'] },
    ],
  },
  {
    id: 'cheese',
    names: ['Käse', 'Kase', 'Gouda', 'Emmentaler', 'Parmesan', 'Mozzarella', 'Feta', 'Halloumi', 'Cheddar', 'Mascarpone', 'Ricotta', 'Camembert', 'Gorgonzola', 'Blauschimmelkäse'],
    products: [
      { id: 'cheese-generic', label: 'Käse', category: 'dairy', forms: ['other'], default: true, aliases: ['Käse', 'Kase', 'Käse gerieben', 'Reibekäse', 'cheese', 'grated cheese'] },
      { id: 'gouda', label: 'Gouda', category: 'dairy', forms: ['other'], aliases: ['Gouda', 'Goudakäse', 'gouda'] },
      { id: 'emmentaler', label: 'Emmentaler', category: 'dairy', forms: ['other'], aliases: ['Emmentaler', 'Emmental', 'emmental'] },
      { id: 'parmesan', label: 'Parmesan', category: 'dairy', forms: ['other'], aliases: ['Parmesan', 'Parmigiano Reggiano', 'Parmesan gerieben', 'parmesan'] },
      { id: 'mozzarella', label: 'Mozzarella', category: 'dairy', forms: ['other'], aliases: ['Mozzarella', 'Büffelmozzarella', 'mozzarella'] },
      { id: 'feta', label: 'Feta', category: 'dairy', forms: ['other'], aliases: ['Feta', 'Fetakäse', 'Schafskäse', 'feta'] },
      { id: 'halloumi', label: 'Halloumi', category: 'dairy', forms: ['other'], aliases: ['Halloumi', 'Grillkäse', 'halloumi'] },
      { id: 'cheddar', label: 'Cheddar', category: 'dairy', forms: ['other'], aliases: ['Cheddar', 'Cheddar cheese', 'cheddar'] },
      { id: 'mascarpone', label: 'Mascarpone', category: 'dairy', forms: ['other'], aliases: ['Mascarpone', 'mascarpone'] },
      { id: 'ricotta', label: 'Ricotta', category: 'dairy', forms: ['other'], aliases: ['Ricotta', 'ricotta'] },
      { id: 'camembert', label: 'Camembert', category: 'dairy', forms: ['other'], aliases: ['Camembert', 'camembert'] },
      { id: 'gorgonzola', label: 'Gorgonzola', category: 'dairy', forms: ['other'], aliases: ['Gorgonzola', 'Blauschimmelkäse', 'Blauschimmelkase', 'gorgonzola'] },
    ],
  },
  {
    id: 'buttermilk',
    names: ['Buttermilch', 'Kefir', 'Dickmilch'],
    products: [
      { id: 'buttermilk-product', label: 'Buttermilch', category: 'dairy', forms: ['other'], default: true, aliases: ['Buttermilch', 'Kefir', 'Dickmilch', 'buttermilk', 'kefir'] },
    ],
  },
  {
    id: 'condensed-milk',
    names: ['Kondensmilch', 'Evaporated Milk', 'Dosenmilch'],
    products: [
      { id: 'condensed-milk-product', label: 'Kondensmilch', category: 'dairy', forms: ['milk'], default: true, aliases: ['Kondensmilch', 'Dosenmilch', 'Evaporated Milk', 'condensed milk'] },
    ],
  },
  {
    id: 'egg',
    names: ['Ei', 'Eier', 'Hühnerei', 'Hühnereier', 'Eigelb', 'Eiweiß'],
    products: [
      { id: 'egg-whole', label: 'Eier', category: 'dairy', forms: ['other'], default: true, aliases: ['Ei', 'Eier', 'Hühnerei', 'Hühnereier', 'Vollei', 'eggs'] },
      { id: 'egg-yolk', label: 'Eigelb', category: 'dairy', forms: ['other'], aliases: ['Eigelb', 'Eidotter', 'Eigelbe', 'egg yolk'] },
      { id: 'egg-white', label: 'Eiweiß', category: 'dairy', forms: ['other'], aliases: ['Eiweiß', 'Eiweiss', 'Eiklar', 'egg white'] },
    ],
  },

  /* ---------------------------------------------------------------- */
  /* Bakery                                                            */
  /* ---------------------------------------------------------------- */
  {
    id: 'bread',
    names: ['Brot', 'Brote', 'Bauernbrot', 'Mischbrot', 'Vollkornbrot', 'Graubrot'],
    products: [
      { id: 'bread-loaf', label: 'Brot', category: 'bakery', forms: ['other'], default: true, aliases: ['Brot', 'Brote', 'Bauernbrot', 'Mischbrot', 'Vollkornbrot', 'Graubrot', 'bread'] },
      { id: 'bread-toast', label: 'Toastbrot', category: 'bakery', forms: ['other'], aliases: ['Toastbrot', 'Toast', 'Weißbrot', 'Weissbrot', 'toast'] },
      { id: 'bread-roll', label: 'Brötchen', category: 'bakery', forms: ['other'], aliases: ['Brötchen', 'Brotchen', 'Semmel', 'Semmeln', 'Schrippe', 'Wecken', 'rolls'] },
      { id: 'baguette', label: 'Baguette', category: 'bakery', forms: ['other'], aliases: ['Baguette', 'Baguettes', 'Ciabatta', 'baguette'] },
      { id: 'bread-pita', label: 'Fladenbrot', category: 'bakery', forms: ['other'], aliases: ['Fladenbrot', 'Pita', 'Pita-Brot', 'Wrap', 'Tortilla', 'fladenbrot'] },
    ],
  },
  {
    id: 'cake',
    names: ['Kuchen', 'Torte', 'Gebäck', 'Geback'],
    products: [
      { id: 'cake-product', label: 'Kuchen', category: 'bakery', forms: ['other'], default: true, aliases: ['Kuchen', 'Torte', 'Gebäck', 'Geback', 'cake'] },
    ],
  },
  {
    id: 'croissant',
    names: ['Croissant', 'Croissants', 'Hörnchen'],
    products: [
      { id: 'croissant-product', label: 'Croissant', category: 'bakery', forms: ['other'], default: true, aliases: ['Croissant', 'Croissants', 'Hörnchen', 'croissant'] },
    ],
  },
  {
    id: 'pretzel',
    names: ['Brezel', 'Brezeln', 'Laugenbrezel'],
    products: [
      { id: 'pretzel-product', label: 'Brezel', category: 'bakery', forms: ['other'], default: true, aliases: ['Brezel', 'Brezeln', 'Laugenbrezel', 'pretzel'] },
    ],
  },

  /* ---------------------------------------------------------------- */
  /* Grains, pasta, baking staples                                     */
  /* ---------------------------------------------------------------- */
  {
    id: 'flour',
    names: ['Mehl', 'Weizenmehl', 'Dinkelmehl', 'Vollkornmehl', 'Type 405', 'Type 550', 'Type 1050'],
    products: [
      { id: 'flour-wheat', label: 'Mehl', category: 'grains', forms: ['flour', 'ground'], default: true, aliases: ['Mehl', 'Weizenmehl', 'Vollkornmehl', 'flour', 'wheat flour'] },
      { id: 'flour-405', label: 'Mehl Type 405', category: 'grains', forms: ['flour'], qualifiers: ['405'], aliases: ['Mehl Type 405', 'Weizenmehl Type 405', 'Weizenmehl 405', 'Type 405'] },
      { id: 'flour-550', label: 'Mehl Type 550', category: 'grains', forms: ['flour'], qualifiers: ['550'], aliases: ['Mehl Type 550', 'Weizenmehl Type 550', 'Weizenmehl 550', 'Type 550'] },
      { id: 'flour-1050', label: 'Mehl Type 1050', category: 'grains', forms: ['flour'], qualifiers: ['1050'], aliases: ['Mehl Type 1050', 'Weizenmehl Type 1050', 'Weizenmehl 1050', 'Type 1050'] },
      { id: 'flour-spelt', label: 'Dinkelmehl', category: 'grains', forms: ['flour'], aliases: ['Dinkelmehl', 'Dinkelmehl Type 630', 'spelt flour'] },
      { id: 'flour-rye', label: 'Roggenmehl', category: 'grains', forms: ['flour'], aliases: ['Roggenmehl', 'Roggenmehl Type 1150', 'rye flour'] },
      { id: 'flour-corn', label: 'Maismehl', category: 'grains', forms: ['flour'], aliases: ['Maismehl', 'Polenta', 'Maisgrieß', 'Maisgriess', 'cornmeal', 'polenta'] },
      { id: 'flour-rice', label: 'Reismehl', category: 'grains', forms: ['flour'], aliases: ['Reismehl', 'rice flour'] },
      { id: 'flour-chickpea', label: 'Kichererbsenmehl', category: 'grains', forms: ['flour'], aliases: ['Kichererbsenmehl', 'Besan', 'gram flour', 'chickpea flour'] },
      { id: 'flour-almond', label: 'Mandelmehl', category: 'grains', forms: ['flour'], aliases: ['Mandelmehl', 'almond flour', 'ground almonds'] },
    ],
  },
  {
    id: 'semolina',
    names: ['Grieß', 'Griess', 'Hartweizengrieß', 'Weizengrieß'],
    products: [
      { id: 'semolina-product', label: 'Grieß', category: 'grains', forms: ['flour', 'ground'], default: true, aliases: ['Grieß', 'Griess', 'Hartweizengrieß', 'Weizengrieß', 'semolina'] },
    ],
  },
  {
    id: 'oats',
    names: ['Hafer', 'Haferflocken', 'Haferkern', 'Haferkleie', 'Schmelzflocken'],
    products: [
      { id: 'oats-flakes', label: 'Haferflocken', category: 'grains', forms: ['flakes'], default: true, aliases: ['Hafer', 'Haferflocken', 'Haferkern', 'Haferkleie', 'Schmelzflocken', 'zarte Haferflocken', 'kernige Haferflocken', 'oats', 'oat flakes'] },
    ],
  },
  {
    id: 'muesli',
    names: ['Müsli', 'Musli', 'Granola', 'Cornflakes'],
    products: [
      { id: 'muesli-product', label: 'Müsli', category: 'grains', forms: ['flakes', 'other'], default: true, aliases: ['Müsli', 'Musli', 'Granola', 'Cornflakes', 'muesli'] },
    ],
  },
  {
    id: 'rice',
    names: ['Reis'],
    products: [
      { id: 'rice-generic', label: 'Reis', category: 'grains', forms: ['other'], default: true, aliases: ['Reis', 'rice'] },
      { id: 'rice-basmati', label: 'Basmatireis', category: 'grains', forms: ['other'], aliases: ['Basmatireis', 'Basmati', 'basmati rice'] },
      { id: 'rice-jasmine', label: 'Jasminreis', category: 'grains', forms: ['other'], aliases: ['Jasminreis', 'Jasmin', 'jasmine rice'] },
      { id: 'rice-risotto', label: 'Risottoreis', category: 'grains', forms: ['other'], aliases: ['Risottoreis', 'Arborio', 'Carnaroli', 'risotto rice'] },
      { id: 'rice-wholegrain', label: 'Vollkornreis', category: 'grains', forms: ['other'], aliases: ['Vollkornreis', 'brauner Reis', 'Naturreis', 'brown rice'] },
      { id: 'rice-pudding', label: 'Milchreis', category: 'grains', forms: ['other'], aliases: ['Milchreis', 'pudding rice'] },
      { id: 'rice-wild', label: 'Wildreis', category: 'grains', forms: ['other'], aliases: ['Wildreis', 'wild rice'] },
      { id: 'rice-noodles', label: 'Reisnudeln', category: 'grains', forms: ['other'], aliases: ['Reisnudeln', 'Reisnudel', 'Glasnudeln', 'Reisbandnudeln', 'rice noodles'] },
    ],
  },
  {
    id: 'pasta',
    names: ['Nudeln', 'Nudel', 'Pasta', 'Teigwaren', 'Spaghetti', 'Penne', 'Fusilli', 'Makkaroni', 'Lasagne', 'Tagliatelle', 'Linguine', 'Rigatoni', 'Farfalle', 'Tortellini', 'Ravioli', 'Gnocchi'],
    products: [
      { id: 'pasta-generic', label: 'Nudeln', category: 'grains', forms: ['other'], default: true, aliases: ['Nudeln', 'Nudel', 'Pasta', 'Teigwaren', 'pasta'] },
      { id: 'pasta-spaghetti', label: 'Spaghetti', category: 'grains', forms: ['other'], aliases: ['Spaghetti', 'Spagetti', 'spaghetti'] },
      { id: 'pasta-penne', label: 'Penne', category: 'grains', forms: ['other'], aliases: ['Penne', 'Penne rigate', 'penne'] },
      { id: 'pasta-fusilli', label: 'Fusilli', category: 'grains', forms: ['other'], aliases: ['Fusilli', 'fusilli'] },
      { id: 'pasta-macaroni', label: 'Makkaroni', category: 'grains', forms: ['other'], aliases: ['Makkaroni', 'Maccaroni', 'macaroni'] },
      { id: 'pasta-lasagne', label: 'Lasagneplatten', category: 'grains', forms: ['other'], aliases: ['Lasagne', 'Lasagneplatten', 'Lasagneblätter', 'lasagna'] },
      { id: 'pasta-tagliatelle', label: 'Tagliatelle', category: 'grains', forms: ['other'], aliases: ['Tagliatelle', 'Bandnudeln', 'tagliatelle'] },
      { id: 'pasta-linguine', label: 'Linguine', category: 'grains', forms: ['other'], aliases: ['Linguine', 'linguine'] },
      { id: 'pasta-rigatoni', label: 'Rigatoni', category: 'grains', forms: ['other'], aliases: ['Rigatoni', 'rigatoni'] },
      { id: 'pasta-farfalle', label: 'Farfalle', category: 'grains', forms: ['other'], aliases: ['Farfalle', 'Schmetterlingsnudeln', 'farfalle'] },
      { id: 'pasta-tortellini', label: 'Tortellini', category: 'grains', forms: ['other'], aliases: ['Tortellini', 'tortellini'] },
      { id: 'pasta-ravioli', label: 'Ravioli', category: 'grains', forms: ['other'], aliases: ['Ravioli', 'ravioli'] },
      { id: 'gnocchi', label: 'Gnocchi', category: 'grains', forms: ['other'], aliases: ['Gnocchi', 'gnocchi'] },
    ],
  },
  {
    id: 'couscous',
    names: ['Couscous', 'Cous Cous'],
    products: [
      { id: 'couscous-product', label: 'Couscous', category: 'grains', forms: ['other'], default: true, aliases: ['Couscous', 'Cous Cous', 'couscous'] },
    ],
  },
  {
    id: 'bulgur',
    names: ['Bulgur', 'Bulgurweizen'],
    products: [
      { id: 'bulgur-product', label: 'Bulgur', category: 'grains', forms: ['other'], default: true, aliases: ['Bulgur', 'Bulgurweizen', 'bulgur'] },
    ],
  },
  {
    id: 'quinoa',
    names: ['Quinoa', 'Quinoa-Samen'],
    products: [
      { id: 'quinoa-product', label: 'Quinoa', category: 'grains', forms: ['other'], default: true, aliases: ['Quinoa', 'Quinoa-Samen', 'quinoa'] },
    ],
  },
  {
    id: 'millet',
    names: ['Hirse', 'Hirseflocken'],
    products: [
      { id: 'millet-product', label: 'Hirse', category: 'grains', forms: ['other'], default: true, aliases: ['Hirse', 'Hirseflocken', 'millet'] },
    ],
  },
  {
    id: 'barley',
    names: ['Gerste', 'Graupen', 'Rollgerste'],
    products: [
      { id: 'barley-product', label: 'Gerste', category: 'grains', forms: ['other'], default: true, aliases: ['Gerste', 'Graupen', 'Rollgerste', 'barley'] },
    ],
  },
  {
    id: 'buckwheat',
    names: ['Buchweizen', 'Buchweizenmehl'],
    products: [
      { id: 'buckwheat-product', label: 'Buchweizen', category: 'grains', forms: ['other'], default: true, aliases: ['Buchweizen', 'Buchweizenmehl', 'buckwheat'] },
    ],
  },
  {
    id: 'sugar',
    names: ['Zucker', 'Weißzucker', 'Brauner Zucker', 'Rohrzucker', 'Puderzucker', 'Haushaltszucker'],
    products: [
      { id: 'sugar-white', label: 'Zucker', category: 'spices', forms: ['other'], default: true, aliases: ['Zucker', 'Weißzucker', 'Weisszucker', 'Haushaltszucker', 'Kristallzucker', 'sugar'] },
      { id: 'sugar-brown', label: 'Brauner Zucker', category: 'spices', forms: ['other'], qualifiers: ['braun'], aliases: ['Brauner Zucker', 'brauner Zucker', 'Rohrzucker', 'Muscovado', 'brauner Rohrzucker', 'brown sugar'] },
      { id: 'sugar-powdered', label: 'Puderzucker', category: 'spices', forms: ['ground'], aliases: ['Puderzucker', 'Staubzucker', 'Icing Sugar', 'powdered sugar'] },
      { id: 'sugar-vanilla', label: 'Vanillezucker', category: 'spices', forms: ['ground'], aliases: ['Vanillezucker', 'Vanillinzucker', 'Vanille-Zucker', 'vanilla sugar'] },
    ],
  },
  {
    id: 'yeast',
    names: ['Hefe', 'Frischhefe', 'Hefewürfel', 'Frische Hefe'],
    products: [
      { id: 'yeast-fresh', label: 'Frische Hefe', category: 'spices', forms: ['fresh'], default: true, aliases: ['Hefe', 'Frischhefe', 'Frische Hefe', 'Hefewürfel', 'frische Hefe', 'fresh yeast'] },
      { id: 'yeast-dry', label: 'Trockenhefe', category: 'spices', forms: ['dried', 'ground'], aliases: ['Trockenhefe', 'Instanthefe', 'Trockengerm', 'dry yeast'] },
    ],
  },
  {
    id: 'baking-powder',
    names: ['Backpulver', 'Natron'],
    products: [
      { id: 'baking-powder-product', label: 'Backpulver', category: 'spices', forms: ['other'], default: true, aliases: ['Backpulver', 'Weinsteinbackpulver', 'baking powder'] },
      { id: 'baking-soda', label: 'Natron', category: 'spices', forms: ['other'], aliases: ['Natron', 'Backnatron', 'Natriumhydrogencarbonat', 'baking soda'] },
    ],
  },
  {
    id: 'gelatin',
    names: ['Gelatine', 'Agar', 'Agar-Agar', 'Geliermittel'],
    products: [
      { id: 'gelatin-product', label: 'Gelatine', category: 'spices', forms: ['other'], default: true, aliases: ['Gelatine', 'Gelantine', 'Agar', 'Agar-Agar', 'gelatin', 'agar'] },
    ],
  },
  {
    id: 'cocoa',
    names: ['Kakao', 'Kakaopulver', 'Backkakao'],
    products: [
      { id: 'cocoa-powder', label: 'Kakaopulver', category: 'spices', forms: ['ground'], default: true, aliases: ['Kakao', 'Kakaopulver', 'Backkakao', 'cocoa', 'cocoa powder'] },
    ],
  },
  {
    id: 'chocolate',
    names: ['Schokolade', 'Zartbitterschokolade', 'Vollmilchschokolade', 'Kuvertüre', 'Schokodrops'],
    products: [
      { id: 'chocolate-dark', label: 'Zartbitterschokolade', category: 'spices', forms: ['other'], default: true, aliases: ['Schokolade', 'Zartbitterschokolade', 'Kuvertüre', 'Schokodrops', 'dunkle Schokolade', 'chocolate'] },
      { id: 'chocolate-milk', label: 'Vollmilchschokolade', category: 'spices', forms: ['other'], aliases: ['Vollmilchschokolade', 'Milchschokolade', 'milk chocolate'] },
    ],
  },
  {
    id: 'marzipan',
    names: ['Marzipan', 'Marzipanrohmasse', 'Mazipan'],
    products: [
      { id: 'marzipan-product', label: 'Marzipan', category: 'spices', forms: ['other'], default: true, aliases: ['Marzipan', 'Marzipanrohmasse', 'Mazipan', 'marzipan'] },
    ],
  },
  {
    id: 'nuts',
    names: ['Mandeln', 'Mandel', 'Walnüsse', 'Walnuss', 'Haselnüsse', 'Haselnuss', 'Cashewkerne', 'Cashew', 'Pistazien', 'Pistazie', 'Erdnüsse', 'Erdnuss', 'Pekannüsse', 'Pekannuss', 'Macadamianüsse', 'Pinienkerne', 'Paranüsse'],
    products: [
      { id: 'almonds', label: 'Mandeln', category: 'canned', forms: ['whole', 'ground'], default: true, aliases: ['Mandeln', 'Mandel', 'Mandelkerne', 'gemahlene Mandeln', 'Mandelsplitter', 'Mandelblättchen', 'Mandelstifte', 'almonds'] },
      { id: 'walnuts', label: 'Walnüsse', category: 'canned', forms: ['whole'], aliases: ['Walnüsse', 'Walnuss', 'Walnusskerne', 'Baumnüsse', 'walnuts'] },
      { id: 'hazelnuts', label: 'Haselnüsse', category: 'canned', forms: ['whole', 'ground'], aliases: ['Haselnüsse', 'Haselnuss', 'Haselnusskerne', 'gemahlene Haselnüsse', 'hazelnuts'] },
      { id: 'cashews', label: 'Cashewkerne', category: 'canned', forms: ['whole'], aliases: ['Cashewkerne', 'Cashew', 'Cashewnüsse', 'cashews'] },
      { id: 'pistachios', label: 'Pistazien', category: 'canned', forms: ['whole'], aliases: ['Pistazien', 'Pistazie', 'Pistazienkerne', 'pistachios'] },
      { id: 'peanuts', label: 'Erdnüsse', category: 'canned', forms: ['whole'], aliases: ['Erdnüsse', 'Erdnuss', 'Erdnusskerne', 'peanuts'] },
      { id: 'pecans', label: 'Pekannüsse', category: 'canned', forms: ['whole'], aliases: ['Pekannüsse', 'Pekannuss', 'pecans'] },
      { id: 'macadamia', label: 'Macadamianüsse', category: 'canned', forms: ['whole'], aliases: ['Macadamianüsse', 'Macadamia', 'macadamia nuts'] },
      { id: 'pine-nuts', label: 'Pinienkerne', category: 'canned', forms: ['whole'], aliases: ['Pinienkerne', 'Pignoli', 'pine nuts'] },
      { id: 'brazil-nuts', label: 'Paranüsse', category: 'canned', forms: ['whole'], aliases: ['Paranüsse', 'Paranuss', 'brazil nuts'] },
    ],
  },
  {
    id: 'peanut-butter',
    names: ['Erdnussbutter', 'Erdnussmus', 'Peanut Butter'],
    products: [
      { id: 'peanut-butter-product', label: 'Erdnussbutter', category: 'canned', forms: ['paste'], default: true, aliases: ['Erdnussbutter', 'Erdnussmus', 'Peanut Butter', 'peanut butter'] },
    ],
  },
  {
    id: 'nut-butter',
    names: ['Mandelmus', 'Nussmus', 'Cashewmus', 'Haselnussmus'],
    products: [
      { id: 'nut-butter-product', label: 'Nussmus', category: 'canned', forms: ['paste'], default: true, aliases: ['Mandelmus', 'Nussmus', 'Cashewmus', 'Haselnussmus', 'nut butter'] },
    ],
  },
  {
    id: 'seeds',
    names: ['Sonnenblumenkerne', 'Sonnenblumenkern', 'Chiasamen', 'Leinsamen', 'Hanfsamen', 'Kürbiskerne', 'Kürbiskern'],
    products: [
      { id: 'sunflower-seeds', label: 'Sonnenblumenkerne', category: 'canned', forms: ['seed'], default: true, aliases: ['Sonnenblumenkerne', 'Sonnenblumenkern', 'Sonnenblumensamen', 'sunflower seeds'] },
      { id: 'chia-seeds', label: 'Chiasamen', category: 'canned', forms: ['seed'], aliases: ['Chiasamen', 'Chia', 'chia seeds'] },
      { id: 'flax-seeds', label: 'Leinsamen', category: 'canned', forms: ['seed'], aliases: ['Leinsamen', 'Flachssamen', 'Leinsaat', 'flax seeds'] },
      { id: 'hemp-seeds', label: 'Hanfsamen', category: 'canned', forms: ['seed'], aliases: ['Hanfsamen', 'Hanfkerne', 'hemp seeds'] },
      { id: 'pumpkin-seeds', label: 'Kürbiskerne', category: 'canned', forms: ['seed'], aliases: ['Kürbiskerne', 'Kürbiskern', 'Kürbissamen', 'pumpkin seeds'] },
      { id: 'pumpkin-seed-oil', label: 'Kürbiskernöl', category: 'spices', forms: ['oil'], aliases: ['Kürbiskernöl', 'Kürbiskeröl', 'pumpkin seed oil'] },
    ],
  },

  /* ---------------------------------------------------------------- */
  /* Oils, vinegar and condiments                                      */
  /* ---------------------------------------------------------------- */
  {
    id: 'olive-oil',
    names: ['Olivenöl', 'Natives Olivenöl', 'Olivenöl extra vergine', 'Olivenöl nativ extra'],
    products: [
      { id: 'olive-oil-product', label: 'Olivenöl', category: 'spices', forms: ['oil'], default: true, aliases: ['Olivenöl', 'Natives Olivenöl', 'natives Olivenöl extra', 'Olivenöl nativ extra', 'extra natives Olivenöl', 'Olivenöl extra vergine', 'olive oil'] },
    ],
  },
  {
    id: 'rapeseed-oil',
    names: ['Rapsöl', 'Rapskernöl', 'Canolaöl'],
    products: [
      { id: 'rapeseed-oil-product', label: 'Rapsöl', category: 'spices', forms: ['oil'], default: true, aliases: ['Rapsöl', 'Rapskernöl', 'Canolaöl', 'rapeseed oil', 'canola oil'] },
    ],
  },
  {
    id: 'sunflower-oil',
    names: ['Sonnenblumenöl', 'Sonnenblumenkernöl'],
    products: [
      { id: 'sunflower-oil-product', label: 'Sonnenblumenöl', category: 'spices', forms: ['oil'], default: true, aliases: ['Sonnenblumenöl', 'Sonnenblumenkernöl', 'sunflower oil'] },
    ],
  },
  {
    id: 'vegetable-oil',
    names: ['Pflanzenöl', 'Pflanzenöl neutral', 'Öl', 'Neutrales Öl', 'Keimöl'],
    products: [
      { id: 'vegetable-oil-product', label: 'Öl', category: 'spices', forms: ['oil'], default: true, aliases: ['Öl', 'Pflanzenöl', 'Pflanzliches Öl', 'Pflanzenöle', 'Neutrales Öl', 'Keimöl', 'vegetable oil'] },
    ],
  },
  {
    id: 'peanut-oil',
    names: ['Erdnussöl', 'Erdnusskernöl'],
    products: [
      { id: 'peanut-oil-product', label: 'Erdnussöl', category: 'spices', forms: ['oil'], default: true, aliases: ['Erdnussöl', 'Erdnusskernöl', 'peanut oil'] },
    ],
  },
  {
    id: 'linseed-oil',
    names: ['Leinöl', 'Leinsamenöl'],
    products: [
      { id: 'linseed-oil-product', label: 'Leinöl', category: 'spices', forms: ['oil'], default: true, aliases: ['Leinöl', 'Leinsamenöl', 'flaxseed oil'] },
    ],
  },
  {
    id: 'walnut-oil',
    names: ['Walnussöl', 'Walnusskernöl'],
    products: [
      { id: 'walnut-oil-product', label: 'Walnussöl', category: 'spices', forms: ['oil'], default: true, aliases: ['Walnussöl', 'Walnusskernöl', 'walnut oil'] },
    ],
  },
  {
    id: 'grapeseed-oil',
    names: ['Traubenkernöl', 'Weintraubenkernöl'],
    products: [
      { id: 'grapeseed-oil-product', label: 'Traubenkernöl', category: 'spices', forms: ['oil'], default: true, aliases: ['Traubenkernöl', 'Weintraubenkernöl', 'grapeseed oil'] },
    ],
  },
  {
    id: 'thistle-oil',
    names: ['Distelöl', 'Safloröl'],
    products: [
      { id: 'thistle-oil-product', label: 'Distelöl', category: 'spices', forms: ['oil'], default: true, aliases: ['Distelöl', 'Safloröl', 'safflower oil'] },
    ],
  },
  {
    id: 'corn-oil',
    names: ['Maiskeimöl', 'Maisöl'],
    products: [
      { id: 'corn-oil-product', label: 'Maiskeimöl', category: 'spices', forms: ['oil'], default: true, aliases: ['Maiskeimöl', 'Maisöl', 'corn oil'] },
    ],
  },
  {
    id: 'vinegar',
    names: ['Essig', 'Weißweinessig', 'Rotweinessig', 'Apfelessig', 'Balsamico', 'Balsamicoessig', 'Reisessig', 'Sherryessig'],
    products: [
      { id: 'vinegar-generic', label: 'Essig', category: 'spices', forms: ['other'], default: true, aliases: ['Essig', 'Weißweinessig', 'Weissweinessig', 'Rotweinessig', 'Apfelessig', 'Reisessig', 'Sherryessig', 'Weinessig', 'vinegar'] },
      { id: 'vinegar-balsamic', label: 'Balsamico', category: 'spices', forms: ['other'], aliases: ['Balsamico', 'Balsamicoessig', 'Balsamico-Essig', 'Aceto Balsamico', 'balsamic vinegar'] },
    ],
  },
  {
    id: 'soy-sauce',
    names: ['Sojasauce', 'Sojasoße', 'Sojasosse', 'Tamari', 'Shoyu'],
    products: [
      { id: 'soy-sauce-product', label: 'Sojasauce', category: 'spices', forms: ['other'], default: true, aliases: ['Sojasauce', 'Sojasoße', 'Sojasosse', 'Tamari', 'Shoyu', 'helle Sojasauce', 'dunkle Sojasauce', 'soy sauce'] },
    ],
  },
  {
    id: 'fish-sauce',
    names: ['Fischsauce', 'Fischsoße', 'Nuoc Mam', 'Nam Pla'],
    products: [
      { id: 'fish-sauce-product', label: 'Fischsauce', category: 'spices', forms: ['other'], default: true, aliases: ['Fischsauce', 'Fischsoße', 'Fischsosse', 'Nuoc Mam', 'Nam Pla', 'fish sauce'] },
    ],
  },
  {
    id: 'worcestershire',
    names: ['Worcestersauce', 'Worcestershire Sauce', 'Worcester'],
    products: [
      { id: 'worcestershire-product', label: 'Worcestersauce', category: 'spices', forms: ['other'], default: true, aliases: ['Worcestersauce', 'Worcestershire Sauce', 'Worcester', 'Worcester Sauce', 'worcestershire sauce'] },
    ],
  },
  {
    id: 'ketchup',
    names: ['Ketchup', 'Tomatenketchup'],
    products: [
      { id: 'ketchup-product', label: 'Ketchup', category: 'canned', forms: ['paste'], default: true, aliases: ['Ketchup', 'Tomatenketchup', 'Curryketchup', 'ketchup'] },
    ],
  },
  {
    id: 'mayonnaise',
    names: ['Mayonnaise', 'Mayo', 'Majonaise', 'Salatmayonnaise'],
    products: [
      { id: 'mayonnaise-product', label: 'Mayonnaise', category: 'canned', forms: ['paste'], default: true, aliases: ['Mayonnaise', 'Mayo', 'Majonaise', 'Salatmayonnaise', 'mayonnaise'] },
    ],
  },
  {
    id: 'olives',
    names: ['Oliven', 'Olive', 'Grüne Oliven', 'Schwarze Oliven', 'Kalamata-Oliven'],
    products: [
      { id: 'olives-product', label: 'Oliven', category: 'canned', forms: ['other'], default: true, aliases: ['Oliven', 'Olive', 'Grüne Oliven', 'Schwarze Oliven', 'Kalamata-Oliven', 'Kalamata', 'olives'] },
    ],
  },
  {
    id: 'capers',
    names: ['Kapern', 'Kaper', 'Kapernäpfel'],
    products: [
      { id: 'capers-product', label: 'Kapern', category: 'canned', forms: ['other'], default: true, aliases: ['Kapern', 'Kaper', 'Kapernäpfel', 'capers'] },
    ],
  },
  {
    id: 'sauerkraut',
    names: ['Sauerkraut', 'Sauerkohl'],
    products: [
      { id: 'sauerkraut-product', label: 'Sauerkraut', category: 'canned', forms: ['canned'], default: true, aliases: ['Sauerkraut', 'Sauerkohl', 'sauerkraut'] },
    ],
  },
  {
    id: 'ajvar',
    names: ['Ajvar', 'Ajvar mild', 'Ajvar scharf'],
    products: [
      { id: 'ajvar-product', label: 'Ajvar', category: 'canned', forms: ['paste'], default: true, aliases: ['Ajvar', 'Ajvar mild', 'Ajvar scharf', 'ajvar'] },
    ],
  },
  {
    id: 'honey',
    names: ['Honig', 'Blütenhonig', 'Waldhonig', 'Akazienhonig'],
    products: [
      { id: 'honey-product', label: 'Honig', category: 'canned', forms: ['other'], default: true, aliases: ['Honig', 'Blütenhonig', 'Waldhonig', 'Akazienhonig', 'Manukahonig', 'honey'] },
    ],
  },
  {
    id: 'jam',
    names: ['Marmelade', 'Konfitüre', 'Konfiture', 'Gelee', 'Fruchtaufstrich'],
    products: [
      { id: 'jam-product', label: 'Marmelade', category: 'canned', forms: ['paste'], default: true, aliases: ['Marmelade', 'Konfitüre', 'Konfiture', 'Gelee', 'Fruchtaufstrich', 'jam'] },
    ],
  },
  {
    id: 'chutney',
    names: ['Chutney', 'Mangochutney', 'Tomatenchutney'],
    products: [
      { id: 'chutney-product', label: 'Chutney', category: 'canned', forms: ['paste'], default: true, aliases: ['Chutney', 'Mangochutney', 'Tomatenchutney', 'chutney'] },
    ],
  },
  {
    id: 'kimchi',
    names: ['Kimchi', 'Kimtschi'],
    products: [
      { id: 'kimchi-product', label: 'Kimchi', category: 'canned', forms: ['other'], default: true, aliases: ['Kimchi', 'Kimtschi', 'kimchi'] },
    ],
  },

  /* ---------------------------------------------------------------- */
  /* Drinks                                                            */
  /* ---------------------------------------------------------------- */
  {
    id: 'water',
    names: ['Wasser', 'Leitungswasser', 'Trinkwasser'],
    products: [
      { id: 'water-tap', label: 'Wasser', category: 'drinks', forms: ['other'], default: true, aliases: ['Wasser', 'Leitungswasser', 'Trinkwasser', 'water'] },
      { id: 'water-mineral', label: 'Mineralwasser', category: 'drinks', forms: ['other'], aliases: ['Mineralwasser', 'Sprudelwasser', 'Sprudel', 'Mineral water', 'sparkling water'] },
    ],
  },
  {
    id: 'coffee',
    names: ['Kaffee', 'Kaffeebohnen', 'Kaffeepulver'],
    products: [
      { id: 'coffee-product', label: 'Kaffee', category: 'drinks', forms: ['other'], default: true, aliases: ['Kaffee', 'Kaffeebohnen', 'Kaffeepulver', 'Filterkaffee', 'coffee'] },
      { id: 'coffee-espresso', label: 'Espresso', category: 'drinks', forms: ['other'], aliases: ['Espresso', 'Espressobohnen', 'Espressopulver', 'espresso'] },
    ],
  },
  {
    id: 'tea',
    names: ['Tee', 'Teebeutel'],
    products: [
      { id: 'tea-product', label: 'Tee', category: 'drinks', forms: ['other'], default: true, aliases: ['Tee', 'Teebeutel', 'tea'] },
      { id: 'tea-black', label: 'Schwarztee', category: 'drinks', forms: ['other'], aliases: ['Schwarztee', 'schwarzer Tee', 'English Breakfast', 'black tea'] },
      { id: 'tea-green', label: 'Grüntee', category: 'drinks', forms: ['other'], aliases: ['Grüntee', 'Gruentee', 'grüner Tee', 'green tea'] },
      { id: 'tea-herbal', label: 'Kräutertee', category: 'drinks', forms: ['other'], aliases: ['Kräutertee', 'Kraeutertee', 'herbal tea'] },
    ],
  },
  {
    id: 'juice',
    names: ['Saft'],
    products: [
      { id: 'juice-generic', label: 'Saft', category: 'drinks', forms: ['juice'], default: true, aliases: ['Saft', 'Fruchtsaft', 'juice'] },
      { id: 'juice-grape', label: 'Traubensaft', category: 'drinks', forms: ['juice'], aliases: ['Traubensaft', 'grape juice'] },
      { id: 'juice-cherry', label: 'Kirschsaft', category: 'drinks', forms: ['juice'], aliases: ['Kirschsaft', 'cherry juice'] },
      { id: 'juice-multivitamin', label: 'Multivitaminsaft', category: 'drinks', forms: ['juice'], aliases: ['Multivitaminsaft', 'Mehrfruchtsaft', 'multi vitamin juice'] },
    ],
  },
  {
    id: 'wine',
    names: ['Wein'],
    products: [
      { id: 'wine-generic', label: 'Wein', category: 'drinks', forms: ['other'], default: true, aliases: ['Wein', 'Tafelwein', 'Kochwein', 'wine'] },
      { id: 'wine-red', label: 'Rotwein', category: 'drinks', forms: ['other'], qualifiers: ['rot'], aliases: ['Rotwein', 'roter Wein', 'Rotwein trocken', 'red wine'] },
      { id: 'wine-white', label: 'Weißwein', category: 'drinks', forms: ['other'], qualifiers: ['weiss'], aliases: ['Weißwein', 'Weisswein', 'weißer Wein', 'white wine'] },
      { id: 'wine-rose', label: 'Roséwein', category: 'drinks', forms: ['other'], qualifiers: ['rosa'], aliases: ['Roséwein', 'Rosewein', 'rosé wine'] },
      { id: 'sekt', label: 'Sekt', category: 'drinks', forms: ['other'], aliases: ['Sekt', 'Prosecco', 'Champagner', 'Crémant', 'sparkling wine'] },
    ],
  },
  {
    id: 'beer',
    names: ['Bier'],
    products: [
      { id: 'beer-product', label: 'Bier', category: 'drinks', forms: ['other'], default: true, aliases: ['Bier', 'Lager', 'Helles', 'beer'] },
      { id: 'beer-pils', label: 'Pils', category: 'drinks', forms: ['other'], aliases: ['Pils', 'Pilsner', 'pilsner'] },
      { id: 'beer-weizen', label: 'Weizenbier', category: 'drinks', forms: ['other'], aliases: ['Weizenbier', 'Weißbier', 'Weissbier', 'Weizen', 'wheat beer'] },
      { id: 'beer-radler', label: 'Radler', category: 'drinks', forms: ['other'], aliases: ['Radler', 'Alsterwasser', 'Panaché', 'radler'] },
    ],
  },
  {
    id: 'soft-drink',
    names: ['Limonade', 'Limo'],
    products: [
      { id: 'soft-drink-product', label: 'Limonade', category: 'drinks', forms: ['other'], default: true, aliases: ['Limonade', 'Limo', 'Fanta', 'Sprite', 'Zitronenlimonade', 'soda', 'lemonade'] },
      { id: 'soft-drink-cola', label: 'Cola', category: 'drinks', forms: ['other'], aliases: ['Cola', 'Coca-Cola', 'Pepsi', 'cola'] },
      { id: 'soft-drink-schorle', label: 'Schorle', category: 'drinks', forms: ['other'], aliases: ['Schorle', 'Apfelschorle', 'Weinschorle', 'spritzer'] },
      { id: 'soft-drink-iced-tea', label: 'Eistee', category: 'drinks', forms: ['other'], aliases: ['Eistee', 'Ice Tea', 'iced tea'] },
    ],
  },
  {
    id: 'coconut-water',
    names: ['Kokoswasser', 'Kokosnusswasser'],
    products: [
      { id: 'coconut-water-product', label: 'Kokoswasser', category: 'drinks', forms: ['other'], default: true, aliases: ['Kokoswasser', 'Kokosnusswasser', 'coconut water'] },
    ],
  },

  /* ---------------------------------------------------------------- */
  /* Household (kept complete enough for the category vocabulary)      */
  /* ---------------------------------------------------------------- */
  {
    id: 'household-paper',
    names: ['Toilettenpapier', 'Klopapier', 'Küchenrolle', 'Kuchenrolle', 'Taschentücher', 'Servietten'],
    products: [
      { id: 'household-paper-product', label: 'Toilettenpapier', category: 'household', forms: ['other'], default: true, aliases: ['Toilettenpapier', 'Klopapier', 'Küchenrolle', 'Kuchenrolle', 'Taschentücher', 'Taschentucher', 'Servietten', 'toilet paper'] },
    ],
  },
  {
    id: 'household-cleaning',
    names: ['Spülmittel', 'Spulmittel', 'Putzmittel', 'Waschmittel', 'Reiniger', 'Glasreiniger'],
    products: [
      { id: 'household-cleaning-product', label: 'Spülmittel', category: 'household', forms: ['other'], default: true, aliases: ['Spülmittel', 'Spulmittel', 'Putzmittel', 'Waschmittel', 'Reiniger', 'Glasreiniger', 'dish soap'] },
    ],
  },
  {
    id: 'household-hygiene',
    names: ['Zahnpasta', 'Zahnbürste', 'Zahnburste', 'Duschgel', 'Shampoo', 'Seife', 'Deo', 'Deodorant'],
    products: [
      { id: 'household-hygiene-product', label: 'Zahnpasta', category: 'household', forms: ['other'], default: true, aliases: ['Zahnpasta', 'Zahnbürste', 'Zahnburste', 'Duschgel', 'Shampoo', 'Seife', 'Deo', 'Deodorant', 'toothpaste'] },
    ],
  },
]
