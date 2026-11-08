import type { Recipe } from '../types'
import { formatIngredientAmount } from '../import/mela'
import { orderIngredientsForDisplay } from '../import/ingredients'
import { effectiveDuration } from '../lib/format'
import { resolveOriginalServings } from '../domain/scaling'
import { renderRecipeInstructions } from '../recipe/references'
import { Markdown } from './Markdown'

export function RecipeCard({
  recipe,
  coverUrl,
}: {
  recipe: Recipe
  coverUrl: string | null
}) {
  const duration = effectiveDuration(recipe)
  const labels = Array.from(
    new Set([...recipe.tags, ...recipe.cuisine, ...recipe.dishType, ...recipe.categories]),
  ).slice(0, 2)
  const href = `#/recipe/${encodeURIComponent(recipe.id)}`

  return (
    <article className={`recipe-card${coverUrl ? ' has-image' : ' is-text'}`}>
      <a className="recipe-card-button" href={href} title={recipe.title}>
        <div className="recipe-card-inner">
          <div className="recipe-card-text">
            <h2>{recipe.title}</h2>
            {duration ? <p className="recipe-card-facts">{duration}</p> : null}
            {labels.length > 0 ? (
              <div className="recipe-card-tags">
                {labels.map((label) => (
                  <span className="recipe-card-tag" key={label}>
                    {label}
                  </span>
                ))}
              </div>
            ) : null}
            {recipe.favorite || recipe.wantToCook ? (
              <p className="recipe-card-flags">
                {recipe.favorite ? <span className="flag">★ Favorit</span> : null}
                {recipe.wantToCook ? <span className="flag">Möchte ich kochen</span> : null}
              </p>
            ) : null}
          </div>
          {coverUrl ? (
            <div className="recipe-card-thumb">
              <img src={coverUrl} alt="" loading="lazy" />
            </div>
          ) : null}
        </div>
      </a>
    </article>
  )
}

function meaningfulGroupTitle(title: string): boolean {
  const normalized = title.trim().toLocaleLowerCase('de')
  return normalized.length > 0 && normalized !== 'zutaten' && normalized !== 'ingredients'
}

function IngredientItems({ items }: { items: Recipe['ingredients'] }) {
  const ordered = orderIngredientsForDisplay(items)
  return (
    <ul className="ingredient-list">
      {ordered.map((ingredient) => {
        const amount = formatIngredientAmount(ingredient)
        const display = ingredient.parseStatus === 'plain' ? ingredient.raw : ingredient.name
        const purchaseNote = ingredient.purchaseNote?.trim() ?? ''
        const preparationNote = ingredient.preparationNote?.trim() ?? ''
        return (
          <li key={ingredient.id} className={amount ? '' : 'no-amount'}>
            {amount ? <span className="ingredient-amount">{amount}</span> : null}
            <span className="ingredient-name">{display}</span>
            {purchaseNote || preparationNote ? (
              <span className="ingredient-notes">
                {purchaseNote ? (
                  <span className="ingredient-note">Einkauf: {purchaseNote}</span>
                ) : null}
                {preparationNote ? (
                  <span className="ingredient-note">Zubereitung: {preparationNote}</span>
                ) : null}
              </span>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

export function IngredientList({ recipe }: { recipe: Recipe }) {
  const groups = [...recipe.ingredientGroups].sort((a, b) => a.position - b.position)
  const namedGroups = groups.filter((group) => meaningfulGroupTitle(group.title))
  const namedGroupIds = new Set(namedGroups.map((group) => group.id))
  const ungrouped = recipe.ingredients.filter(
    (ingredient) => !ingredient.groupId || !namedGroupIds.has(ingredient.groupId),
  )

  if (recipe.ingredients.length === 0) {
    return <p className="muted">Keine Zutaten hinterlegt.</p>
  }

  return (
    <div className="ingredient-sections">
      {ungrouped.length > 0 ? (
        <div className="ingredient-group">
          <IngredientItems items={ungrouped} />
        </div>
      ) : null}
      {namedGroups.map((group) => {
        const items = recipe.ingredients.filter((ingredient) => ingredient.groupId === group.id)
        if (items.length === 0) return null
        return (
          <div className="ingredient-group" key={group.id}>
            <h3>{group.title}</h3>
            <IngredientItems items={items} />
          </div>
        )
      })}
    </div>
  )
}

export function RecipeBody({ recipe }: { recipe: Recipe }) {
  const notes = recipe.notes.trim()
  const nutrition = recipe.nutrition.trim()
  const originalServings = resolveOriginalServings(recipe)
  const renderedSteps = renderRecipeInstructions(recipe.instructions, recipe.ingredients, {
    originalServings,
    targetServings: originalServings ?? 1,
  })

  return (
    <div className="recipe-body">
      <div className={`recipe-layout${notes ? ' has-notes' : ''}${nutrition ? ' has-nutrition' : ''}`}>
        <section className="recipe-section ingredients-section" aria-labelledby="recipe-ingredients">
          <h2 id="recipe-ingredients">Zutaten</h2>
          <IngredientList recipe={recipe} />
        </section>

        <section className="recipe-section steps-section" aria-labelledby="recipe-steps">
          <h2 id="recipe-steps">Zubereitung</h2>
          {recipe.instructions.length === 0 ? (
            <p className="muted">Keine Arbeitsschritte hinterlegt.</p>
          ) : (
            <ol className="step-list">
              {recipe.instructions.map((step, index) => (
                <li key={step.id}>
                  <div className="step-content">
                    <Markdown text={renderedSteps[index]?.text ?? step.text} />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        {notes ? (
          <section className="recipe-section notes-section" aria-labelledby="recipe-notes">
            <h2 id="recipe-notes">Notizen</h2>
            <Markdown text={notes} />
          </section>
        ) : null}

        {nutrition ? (
          <section className="recipe-section nutrition-section" aria-labelledby="recipe-nutrition">
            <h2 id="recipe-nutrition">Nährwerte</h2>
            <Markdown text={nutrition} />
          </section>
        ) : null}
      </div>
    </div>
  )
}
