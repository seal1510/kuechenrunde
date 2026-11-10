import { describe, expect, it } from 'vitest'
import {
  catalogConflicts,
  catalogFamilies,
  catalogKeyVariants,
  catalogShoppingKey,
  catalogStats,
  resolveCatalogMatch,
  type CatalogCategory,
} from './ingredientCatalog'
import { shoppingItemKey } from './ingredientNames'
import { guessShoppingCategory } from './shopping'

function match(name: string, unit?: string | null) {
  const result = resolveCatalogMatch(name, { unit })
  if (!result) throw new Error(`No catalogue match for ${name}`)
  return result
}

function sameProduct(names: readonly string[], category?: CatalogCategory, unit?: string | null) {
  const matches = names.map((name) => match(name, unit))
  const first = matches[0]!
  for (const entry of matches) {
    expect(entry.productId, `${entry.label} should be ${first.label}`).toBe(first.productId)
    expect(entry.key).toBe(first.key)
  }
  if (category) {
    for (const entry of matches) expect(entry.category).toBe(category)
  }
}

function differentProducts(left: string, right: string) {
  const a = match(left)
  const b = match(right)
  expect(a.productId, `${left} must not merge with ${right}`).not.toBe(b.productId)
  expect(a.key).not.toBe(b.key)
}

describe('ingredient catalogue data quality', () => {
  it('has no duplicate names or product keys', () => {
    expect(catalogConflicts()).toEqual([])
  })

  it('makes every canonical label resolvable with its own category and key', () => {
    for (const family of catalogFamilies()) {
      for (const product of family.products) {
        const resolved = resolveCatalogMatch(product.label)
        expect(resolved, product.label).not.toBeNull()
        expect(resolved?.productId).toBe(product.id)
        expect(resolved?.category).toBe(product.category)
        expect(guessShoppingCategory(product.label)).toBe(product.category)
        const key = shoppingItemKey(product.label)
        expect(catalogShoppingKey(key)).toBe(key)
      }
    }
  })

  it('covers a broad, documented ingredient vocabulary', () => {
    const stats = catalogStats()
    // Exact counts are reported in the project documentation. These lower
    // bounds protect the catalogue against accidental truncation.
    expect(stats.families).toBeGreaterThanOrEqual(240)
    expect(stats.products).toBeGreaterThanOrEqual(450)
    expect(stats.names).toBeGreaterThanOrEqual(900)
    expect(stats.explicitAliases).toBeGreaterThanOrEqual(2000)
    expect(stats.distinctNames).toBeGreaterThanOrEqual(1950)
    expect(stats.legacyKeys).toBeGreaterThanOrEqual(1800)
    expect(stats.forms).toBeGreaterThanOrEqual(15)
    expect(stats.categories.spices).toBeGreaterThanOrEqual(120)
    expect(stats.categories.produce).toBeGreaterThanOrEqual(110)
    expect(stats.categories.meat).toBeGreaterThanOrEqual(35)
    expect(stats.categories.dairy).toBeGreaterThanOrEqual(25)
    expect(stats.categories.drinks).toBeGreaterThanOrEqual(30)
    expect(stats.categories.grains).toBeGreaterThanOrEqual(40)
  })
})

describe('leaf herbs: fresh leaves, dried spice and seeds', () => {
  it('merges German and English names of the same fresh herb', () => {
    sameProduct(['Petersilie', 'Petersilienkraut', 'Blattpetersilie'], 'produce')
    sameProduct(['Basilikum', 'Basilikumblätter', 'Genovese Basilikum'], 'produce')
    sameProduct(['Koriander', 'Korianderblätter', 'frischer Koriander', 'Cilantro'], 'produce')
    sameProduct(['Dill', 'Dillspitzen', 'Gurkenkraut'], 'produce')
    sameProduct(['Thymian', 'Thymianblättchen'], 'produce')
    sameProduct(['Rosmarin', 'Rosmarinnadeln'], 'produce')
    sameProduct(['Oregano', 'Origano'], 'produce')
    sameProduct(['Salbei', 'Salbeiblätter'], 'produce')
    sameProduct(['Estragon', 'Estragonblätter'], 'produce')
    sameProduct(['Kerbel', 'Kerbelkraut'], 'produce')
    sameProduct(['Schnittlauch', 'Schnittlauchröllchen'], 'produce')
    sameProduct(['Minze', 'Pfefferminze', 'Minzblätter'], 'produce')
    sameProduct(['Zitronenmelisse', 'Melisse'], 'produce')
    sameProduct(['Liebstöckel', 'Maggikraut'], 'produce')
    sameProduct(['Bohnenkraut', 'Sommerbohnenkraut'], 'produce')
    sameProduct(['Bärlauch', 'Barlauch'], 'produce')
    sameProduct(['Kresse', 'Gartenkresse'], 'produce')
    sameProduct(['Zitronengras', 'Lemongras'], 'produce')
    sameProduct(['Curryblätter', 'Curryblatt'], 'produce')
    sameProduct(['Lorbeer', 'Lorbeerblatt', 'Lorbeerblätter'], 'spices')
    sameProduct(['Kräuter', 'Frische Kräuter', 'Kräuterbund'], 'produce')
    expect(match('Kräuter', 'Bund').category).toBe('produce')
    sameProduct(['Getrocknete Kräuter', 'Kräutermischung', 'Trockenkräuter'], 'spices')
    expect(match('Kräuter', 'TL').category).toBe('spices')
    differentProducts('Kräuter', 'Kräutermischung')
  })

  it('keeps fresh herbs apart from their dried and ground spice', () => {
    differentProducts('Koriander', 'Koriander gemahlen')
    differentProducts('Petersilie', 'Petersilie getrocknet')
    differentProducts('Thymian', 'Thymian getrocknet')
    differentProducts('Basilikum', 'Basilikum getrocknet')
    differentProducts('Dill', 'Dill getrocknet')
    expect(match('Koriander', 'Bund').category).toBe('produce')
    expect(match('Koriander', 'TL').category).toBe('spices')
    expect(match('Petersilie', 'TL').category).toBe('spices')
    expect(match('Thymian', 'Prise').category).toBe('spices')
    expect(match('Koriander', 'Bund').viaUnitHint).toBe(false)
    expect(match('Koriander', 'TL').viaUnitHint).toBe(true)
  })

  it('keeps whole seeds apart from the ground spice', () => {
    sameProduct(['Koriandersamen', 'Koriandersaat', 'Korianderkörner'], 'spices')
    differentProducts('Koriandersamen', 'Koriander gemahlen')
    sameProduct(['gemahlene Koriandersamen', 'Koriander gemahlen'], 'spices')
    sameProduct(['Dillsamen', 'Dillsaat'], 'spices')
    differentProducts('Dillsamen', 'Dill')
  })
})

describe('spices: synonyms, powders and whole forms', () => {
  it('merges cumin synonyms and powder spellings', () => {
    sameProduct(
      [
        'Kreuzkümmel',
        'Kreuzkümmelpulver',
        'Cumin',
        'Cumin gemahlen',
        'gemahlener Kreuzkümmel',
        'Kreuzkümmel gemahlen',
      ],
      'spices',
    )
    sameProduct(['Kreuzkümmelsamen', 'Kreuzkümmelsaat', 'ganze Kreuzkümmelsamen'], 'spices')
    differentProducts('Kreuzkümmel', 'Kreuzkümmelsamen')
    differentProducts('Kümmel', 'Kreuzkümmel')
    sameProduct(['Kümmel', 'Kümmelpulver'], 'spices')
    sameProduct(['Kümmelsamen', 'Kümmelkörner'], 'spices')
  })

  it('merges turmeric powder spellings and keeps the fresh root apart', () => {
    sameProduct(['Kurkuma', 'Kurkumapulver', 'Curcuma', 'Kurkuma gemahlen'], 'spices')
    sameProduct(['Kurkumawurzel', 'frische Kurkuma', 'frischer Kurkuma', 'Kurkuma frisch'], 'produce')
    differentProducts('Kurkuma', 'Kurkumawurzel')
    expect(match('Kurkuma', 'Stück').category).toBe('produce')
    expect(match('Kurkuma', 'TL').category).toBe('spices')
  })

  it('normalises paprika word order and keeps heat variants apart', () => {
    sameProduct(
      [
        'Paprikapulver edelsüß',
        'edelsüßes Paprikapulver',
        'Paprika edelsüß',
        'Edelsüßpaprika',
        'Paprikapulver',
      ],
      'spices',
    )
    sameProduct(['Paprikapulver rosenscharf', 'scharfes Paprikapulver'], 'spices')
    sameProduct(['Paprikapulver geräuchert', 'geräuchertes Paprikapulver'], 'spices')
    differentProducts('Paprikapulver edelsüß', 'Paprikapulver rosenscharf')
    differentProducts('Paprikapulver edelsüß', 'Paprikapulver geräuchert')
    sameProduct(['Paprika', 'Paprikaschoten', 'Spitzpaprika'], 'produce')
    differentProducts('Paprika', 'Paprikapulver edelsüß')
  })

  it('handles nutmeg, cardamom, cinnamon and cloves by form', () => {
    sameProduct(['Muskat', 'Muskatpulver', 'Muskatnuss gemahlen'], 'spices')
    sameProduct(['Muskatnuss', 'Muskatnüsse'], 'spices')
    differentProducts('Muskat', 'Muskatnuss')
    sameProduct(['Macis', 'Muskatblüte'], 'spices')
    sameProduct(['Kardamom', 'Kardamompulver'], 'spices')
    sameProduct(['Kardamomkapseln', 'Kardamomsamen'], 'spices')
    differentProducts('Kardamom', 'Kardamomkapseln')
    sameProduct(['Zimt', 'Zimtpulver', 'Ceylon-Zimt'], 'spices')
    sameProduct(['Zimtstangen', 'Zimtstange'], 'spices')
    differentProducts('Zimt', 'Zimtstangen')
    sameProduct(['Nelken', 'Gewürznelken'], 'spices')
    differentProducts('Nelken', 'Nelken gemahlen')
  })

  it('resolves a bare product-type number only when the family declares it', () => {
    expect(match('Mehl 550').productId).toBe(match('Mehl Type 550').productId)
    expect(match('Mehl 405').productId).toBe(match('Mehl Type 405').productId)
    expect(resolveCatalogMatch('Tomaten 400')).toBeNull()
    expect(resolveCatalogMatch('Joghurt 10 Fett')).toBeNull()
  })

  it('keeps ginger, pepper, mustard and saffron forms distinct', () => {
    sameProduct(['Ingwer', 'Ingwerwurzel', 'frischer Ingwer'], 'produce')
    sameProduct(['Ingwerpulver', 'Ingwer gemahlen'], 'spices')
    differentProducts('Ingwer', 'Ingwerpulver')
    sameProduct(['Pfeffer', 'schwarzer Pfeffer', 'Pfeffer gemahlen'], 'spices')
    sameProduct(['Pfefferkörner', 'ganzer Pfeffer'], 'spices')
    differentProducts('Pfeffer', 'Pfefferkörner')
    sameProduct(['weißer Pfeffer', 'weisser Pfeffer'], 'spices')
    differentProducts('Pfeffer', 'weißer Pfeffer')
    sameProduct(['Senf', 'Dijon-Senf'], 'spices')
    differentProducts('Senf', 'Senfkörner')
    differentProducts('Senf', 'Senfpulver')
    sameProduct(['Safran', 'Safranfäden'], 'spices')
    differentProducts('Safran', 'Safranpulver')
    sameProduct(['Fenchel', 'Fenchelknolle'], 'produce')
    sameProduct(['Fenchelsamen', 'Fenchelsaat'], 'spices')
    differentProducts('Fenchel', 'Fenchelsamen')
    sameProduct(['Anis', 'Anispulver'], 'spices')
    differentProducts('Anis', 'Anissamen')
  })

  it('recognises spice mixtures and pastes', () => {
    sameProduct(['Currypulver', 'Currygewürz'], 'spices')
    differentProducts('Currypulver', 'Currypaste')
    sameProduct(['Garam Masala', 'Garam-Masala'], 'spices')
    sameProduct(['Ras el Hanout', 'Ras-el-Hanout'], 'spices')
    sameProduct(['Baharat', 'Baharat-Gewürz'], 'spices')
    sameProduct(['Harissa', 'Harissa-Paste'], 'spices')
    sameProduct(['Gochujang', 'Gochujang-Paste'], 'canned')
    sameProduct(['Miso', 'Miso-Paste'], 'canned')
    sameProduct(['Sambal Oelek', 'Sambal'], 'canned')
    sameProduct(['Sriracha', 'Sriracha-Sauce'], 'canned')
    sameProduct(['Kräuter der Provence', 'Provence-Kräuter'], 'spices')
    sameProduct(['Italienische Kräuter', 'Italienische Kräutermischung'], 'spices')
  })
})

describe('produce, meat, dairy and pantry groups', () => {
  it('merges singular, plural and common synonyms', () => {
    sameProduct(['Zwiebel', 'Zwiebeln', 'Speisezwiebel'], 'produce')
    sameProduct(['Frühlingszwiebel', 'Lauchzwiebeln', 'Jungzwiebel'], 'produce')
    sameProduct(['Tomate', 'Tomaten', 'Rispentomaten'], 'produce')
    sameProduct(['Kartoffel', 'Kartoffeln', 'Erdapfel'], 'produce')
    sameProduct(['Karotte', 'Möhre', 'Mohrrüben'], 'produce')
    sameProduct(['Gurke', 'Salatgurke', 'Einlegegurke'], 'produce')
    sameProduct(['Aubergine', 'Auberginen', 'Melanzani'], 'produce')
    sameProduct(['Zucchini', 'Courgette'], 'produce')
    sameProduct(['Champignon', 'Champignons', 'Pilze'], 'produce')
    sameProduct(['Erdbeere', 'Erdbeeren'], 'produce')
    sameProduct(['Apfel', 'Äpfel'], 'produce')
    sameProduct(['Zitrone', 'Zitronen'], 'produce')
    sameProduct(['Avocado', 'Avocados'], 'produce')
    sameProduct(['Mango', 'Mangos'], 'produce')
    sameProduct(['Kokos', 'Kokosnuss'], 'produce')
    sameProduct(['Kichererbse', 'Kichererbsen'], 'canned')
    sameProduct(['Grüne Bohnen', 'Brechbohnen'], 'produce')
    sameProduct(['Hähnchen', 'Huhn', 'Hähnchenfleisch'], 'meat')
    sameProduct(['Hähnchenbrust', 'Hähnchenbrustfilet'], 'meat')
    sameProduct(['Rindfleisch', 'Rind'], 'meat')
    sameProduct(['Rinderhack', 'Rinderhackfleisch'], 'meat')
    sameProduct(['Schweinefleisch', 'Schwein'], 'meat')
    sameProduct(['Lachs', 'Lachsfilet'], 'meat')
    sameProduct(['Thunfisch', 'Thunfischfilet'], 'meat')
    sameProduct(['Garnele', 'Garnelen', 'Shrimps', 'Krabben'], 'meat')
    sameProduct(['Milch', 'Vollmilch'], 'dairy')
    sameProduct(['Sahne', 'Schlagsahne'], 'dairy')
    sameProduct(['Joghurt', 'Naturjoghurt'], 'dairy')
    sameProduct(['Ei', 'Eier', 'Hühnereier'], 'dairy')
    sameProduct(['Spaghetti', 'Spagetti'], 'grains')
    sameProduct(['Reis', 'rice'], 'grains')
    differentProducts('Basmatireis', 'Jasminreis')
    differentProducts('Basmatireis', 'Risottoreis')
    sameProduct(['Küchenrolle', 'Toilettenpapier'], 'household')
  })

  it('keeps genuinely different products apart', () => {
    differentProducts('Süßkartoffel', 'Kartoffel')
    differentProducts('Rote Zwiebeln', 'Zwiebeln')
    differentProducts('Lauch', 'Frühlingszwiebeln')
    differentProducts('Essiggurken', 'Gurken')
    differentProducts('Kirschtomaten', 'Tomaten')
    differentProducts('Austernpilze', 'Champignons')
    differentProducts('Räucherlachs', 'Lachs')
    differentProducts('Thunfischdose', 'Thunfisch')
    differentProducts('Eigelb', 'Eier')
    differentProducts('Griechischer Joghurt', 'Joghurt')
    differentProducts('Mozzarella', 'Parmesan')
    differentProducts('Feta', 'Halloumi')
    differentProducts('Kidneybohnen', 'Grüne Bohnen')
    differentProducts('Rote Linsen', 'Grüne Linsen')
    differentProducts('Spaghetti', 'Penne')
    differentProducts('Mehl Type 405', 'Mehl Type 550')
    differentProducts('Vollmilchschokolade', 'Zartbitterschokolade')
    differentProducts('Sonnenblumenkerne', 'Kürbiskerne')
    differentProducts('Cola', 'Limonade')
    differentProducts('Schwarztee', 'Grüntee')
    differentProducts('Pils', 'Weizenbier')
    differentProducts('Rotwein', 'Weißwein')
    differentProducts('Espresso', 'Kaffee')
    differentProducts('Mehligkochende Kartoffeln', 'Festkochende Kartoffeln')
  })

  it('classifies fresh and preserved forms consistently with the identity', () => {
    expect(match('Tomaten').category).toBe('produce')
    expect(match('Tomaten Dose').category).toBe('canned')
    expect(match('Dosentomaten').category).toBe('canned')
    expect(match('Tomaten', 'Dose').category).toBe('canned')
    expect(match('Tomaten', 'Dose').productId).toBe(match('Tomaten aus der Dose').productId)
    expect(match('Passierte Tomaten').category).toBe('canned')
    expect(match('Tomatenmark').category).toBe('canned')
    expect(match('Getrocknete Tomaten').category).toBe('canned')
    expect(match('Kokosmilch').category).toBe('canned')
    expect(match('Kichererbsen').category).toBe('canned')
    expect(match('Linsen').category).toBe('canned')
    expect(match('Rapsöl').category).toBe('spices')
    expect(match('Sesamöl').category).toBe('spices')
    expect(match('Chiliöl').category).toBe('spices')
    expect(match('Hühnerbrühe').category).toBe('canned')
    expect(match('Rinderbrühe').category).toBe('canned')
    expect(match('Haferflocken').category).toBe('grains')
    expect(match('Kaffee').category).toBe('drinks')
    expect(match('Mineralwasser').category).toBe('drinks')
    expect(match('Rotwein').category).toBe('drinks')
    expect(match('Schwarztee').category).toBe('drinks')
  })
})

describe('legacy shopping keys stay attached', () => {
  it('maps old synonym and form keys to the canonical identity', () => {
    expect(catalogShoppingKey('korianderpulv')).toBe(shoppingItemKey('Koriander gemahlen'))
    expect(catalogShoppingKey('koriand getrocknet')).toBe(
      shoppingItemKey('Koriander gemahlen'),
    )
    expect(catalogShoppingKey('kreuzkummelpulv')).toBe(shoppingItemKey('Kreuzkümmel'))
    expect(catalogShoppingKey('kurkumapulv')).toBe(shoppingItemKey('Kurkuma'))
    expect(catalogShoppingKey('cumi')).toBe(shoppingItemKey('Kreuzkümmel'))
    expect(catalogShoppingKey('tomat passiert')).toBe(shoppingItemKey('Passierte Tomaten'))
    expect(catalogShoppingKey('zwiebel rot')).toBe(shoppingItemKey('Rote Zwiebeln'))
    expect(catalogShoppingKey('tomatenpulv')).toBe('tomatenpulv')
    expect(catalogShoppingKey('kreuzkummelpulv cumi')).toBe(
      shoppingItemKey('Kreuzkümmel'),
    )
    expect(catalogShoppingKey('korianderpulv cilantro')).toBe(
      shoppingItemKey('Koriander gemahlen'),
    )
    expect(catalogShoppingKey('kurkumapulv curcuma')).toBe(shoppingItemKey('Kurkuma'))
    expect(catalogShoppingKey('tomat mutti')).toBe('tomat mutti')
    expect(catalogShoppingKey('speck sudtirol speck')).toBe('speck sudtirol speck')
  })

  it('lists every legacy key of one canonical identity', () => {
    const canonical = shoppingItemKey('Koriander gemahlen')
    expect(catalogKeyVariants(canonical)).toEqual(
      expect.arrayContaining(['korianderpulv', 'koriand getrocknet', canonical]),
    )
  })

  it('leaves unknown and canonical keys untouched', () => {
    expect(catalogShoppingKey('')).toBe('')
    expect(catalogShoppingKey('hackfleisch gemischt')).toBe('hackfleisch gemischt')
    expect(catalogShoppingKey(shoppingItemKey('Kurkuma'))).toBe(shoppingItemKey('Kurkuma'))
  })
})
