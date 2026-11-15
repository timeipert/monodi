/**
 * Datasets that an app can import from a public repository: the client with integrity checks, the catalogue and its
 * indexes, the filters and plans for the Corpus Monodicum and the Cantus Corpus, and the record of imports. Import as
 * `@monodi/core/datasets`. The repository that serves the files is `corpus-monodicum/monodi-datasets`; its
 * `docs/FORMAT.md` describes the layout. State 2026-11-14: layout version 1.
 */
export * from './types';
export * from './urls';
export * from './client';
export * from './catalog';
export * from './filter';
export * from './cm';
export * from './cantus';
export * from './manifest';
export * from './limits';
