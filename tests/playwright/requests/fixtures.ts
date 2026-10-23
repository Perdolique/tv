import type { RequestCard, TitleRequest } from '../../../packages/shared/src/catalog-requests.ts'

const requestedMovie = {
  type: 'movie',
  tmdbId: 603,
  title: 'Requested movie',
  originalTitle: 'Original requested title',
  year: null,
  description: 'A source description to review.',
  posterUrl: null
} as const satisfies RequestCard

const requestedSeries = {
  ...requestedMovie,
  type: 'series',
  tmdbId: 105_248,
  title: 'Requested series'
} as const satisfies RequestCard

const exactMovie = {
  ...requestedMovie,
  tmdbId: 880_001,
  title: 'The exact catalog movie',
  year: 2021
} as const satisfies RequestCard

const similarMovie = {
  ...requestedMovie,
  tmdbId: 880_002,
  title: 'Dune: A different adaptation',
  year: 2026
} as const satisfies RequestCard

const posterMovie = {
  ...requestedMovie,
  tmdbId: 880_003,
  title: 'A movie with source artwork',
  year: 2025,
  posterUrl: 'https://image.tmdb.org/t/p/w500/testPoster.jpg'
} as const satisfies RequestCard

const longMovie = {
  ...requestedMovie,
  tmdbId: 880_004,
  title: 'The Extraordinary Adventures of a Very Unlikely Film Club: A Journey Beyond the Last Picture House and Back Again',
  originalTitle: 'Les aventures extraordinaires du ciné-club au-delà de la dernière salle de cinéma et le long voyage du retour',
  description: 'A small film club crosses the country to save the last picture house, meeting old friends and discovering a story worth sharing along the way.'
} as const satisfies RequestCard

const unbrokenMovie = {
  ...requestedMovie,
  tmdbId: 880_005,
  title: 'TheUnbrokenInternationalFilmClubChroniclesAndTheirExtraordinaryJourneyBeyondTheLastPictureHouseWithoutAnySpacesAtAll',
  originalTitle: 'OriginalInternationalFilmClubChroniclesWithoutAnySpacesAtAllAndAnotherVeryLongNameForTheSameSourceTitle'
} as const satisfies RequestCard

const pendingMovieRequest = {
  id: 'request-e2e-movie',
  card: requestedMovie,
  createdAt: '2026-10-20T12:00:00.000Z',
  status: 'pending',
  catalogItemId: null,
  requesterCount: 1
} as const satisfies TitleRequest

const sourceCards = [requestedMovie, requestedSeries, exactMovie, similarMovie, posterMovie, longMovie, unbrokenMovie] as const satisfies readonly RequestCard[]

export { requestedMovie, requestedSeries, exactMovie, similarMovie, posterMovie, longMovie, unbrokenMovie, pendingMovieRequest, sourceCards }
