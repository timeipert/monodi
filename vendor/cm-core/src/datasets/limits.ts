/**
 * Upper bound of chants in one import. The workspace keeps the list of all documents in one row of the browser
 * storage; an import of hundreds of thousands of chants (all of the Cantus Corpus has 888,010) would make that row
 * too large to write. A person who needs more imports in several steps.
 */
export const MAX_DOCUMENTS_PER_IMPORT = 50_000;
