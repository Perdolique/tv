import type { CatalogDetailsItem } from '../../../packages/shared/src/catalog.ts'
import { catalogItems } from './fixtures.ts'

const dune = {
  id: '01991a00-0000-7000-8000-000000000005',
  title: 'Dune',
  titleLocale: 'en',
  originalTitle: 'Dune',
  originalTitleLocale: 'en',
  releaseYear: 2021,
  type: 'movie',
  description: 'Paul Atreides arrives on Arrakis when his family takes control of the desert world that supplies the empire’s most valuable resource. Betrayal forces him and his mother into the wilderness, where the planet’s people may hold their future.',
  descriptionLocale: 'en',
  posterUrl: '/posters/dune-2021.webp'
} as const satisfies CatalogDetailsItem

const russianDune = {
  ...dune,
  title: 'Дюна',
  titleLocale: 'ru',
  description: 'Пол Атрейдес прибывает на Арракис, когда его семья получает власть над пустынной планетой, добывающей важнейший ресурс империи. После предательства Пол и его мать вынуждены искать спасение в пустыне среди её коренных жителей.',
  descriptionLocale: 'ru'
} as const satisfies CatalogDetailsItem

const detailsItems: CatalogDetailsItem[] = []

for (const item of catalogItems) {
  detailsItems.push({
    ...item,
    description: null,
    descriptionLocale: null,
    posterUrl: null
  })
}

detailsItems.push(dune)

export { detailsItems, dune, russianDune }
