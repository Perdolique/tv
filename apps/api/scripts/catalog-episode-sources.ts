interface CatalogEpisodeSource {
  title: string;
  year: number;
  showId: number;
  premiered: string;
  language: string;
  seasonRestriction: number | null;
}

// Reviewed show identities from issue #51; never use title search to select a source.
const catalogEpisodeSources: CatalogEpisodeSource[] = [
  {
    title: 'Spartacus',
    year: 2010,
    showId: 716,
    premiered: '2010-01-22',
    language: 'English',
    seasonRestriction: null
  },
  {
    title: '1923',
    year: 2022,
    showId: 60_550,
    premiered: '2022-12-18',
    language: 'English',
    seasonRestriction: null
  },
  {
    title: 'The Wire',
    year: 2002,
    showId: 179,
    premiered: '2002-06-02',
    language: 'English',
    seasonRestriction: null
  },
  {
    title: 'Chernobyl',
    year: 2019,
    showId: 30_770,
    premiered: '2019-05-06',
    language: 'English',
    seasonRestriction: null
  },
  {
    title: 'Stargate Atlantis',
    year: 2004,
    showId: 206,
    premiered: '2004-07-16',
    language: 'English',
    seasonRestriction: null
  },
  {
    title: 'Kingdom',
    year: 2019,
    showId: 26_153,
    premiered: '2019-01-25',
    language: 'Korean',
    seasonRestriction: null
  },
  {
    title: 'American Horror Story',
    year: 2011,
    showId: 30,
    premiered: '2011-10-05',
    language: 'English',
    seasonRestriction: null
  },
  {
    title: 'Percy Jackson and the Olympians',
    year: 2023,
    showId: 48_108,
    premiered: '2023-12-19',
    language: 'English',
    seasonRestriction: null
  },
  {
    title: 'The Forsytes',
    year: 2025,
    showId: 83_209,
    premiered: '2025-10-20',
    language: 'English',
    seasonRestriction: null
  },
  {
    title: 'South Park',
    year: 1997,
    showId: 112,
    premiered: '1997-08-13',
    language: 'English',
    seasonRestriction: null
  },
  {
    title: 'A Different World',
    year: 2026,
    showId: 91_916,
    premiered: '2026-09-24',
    language: 'English',
    seasonRestriction: null
  },
  {
    title: 'Cyberpunk: Edgerunners',
    year: 2022,
    showId: 48_945,
    premiered: '2022-09-13',
    language: 'Japanese',
    seasonRestriction: 1
  },
  {
    title: 'Cyberpunk: Edgerunners 2',
    year: 2026,
    showId: 88_337,
    premiered: '2026-10-20',
    language: 'Japanese',
    seasonRestriction: null
  },
  {
    title: 'Pride and Prejudice',
    year: 2026,
    showId: 84_008,
    premiered: '2026-12-03',
    language: 'English',
    seasonRestriction: null
  },
  {
    title: 'The Gold',
    year: 2023,
    showId: 57_137,
    premiered: '2023-02-12',
    language: 'English',
    seasonRestriction: null
  }
]

export { catalogEpisodeSources, type CatalogEpisodeSource }
