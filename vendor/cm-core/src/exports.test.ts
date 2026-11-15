// Every module of the package must load in Node (no enums, no parameter properties, type-only imports marked), and
// the entry points must offer what the apps import from them.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as analysis from './analysis/index.ts';
import * as datasets from './datasets/index.ts';
import * as document from './document/index.ts';
import * as mei from './mei/index.ts';
import * as pageLayout from './page-layout/index.ts';

describe('entry points', () => {
  it('@monodi/core/mei offers the emitter, the profile and the header mapping', () => {
    for (const name of ['emitMei', 'defaultMeiProfile', 'upgradeMeiProfile', 'buildAnnotationIndex', 'METADATA_MAPPING', 'buildMeiHead']) {
      assert.equal(typeof (mei as Record<string, unknown>)[name] === 'undefined', false, name);
    }
  });

  it('@monodi/core/document offers the pattern code, the note flags and the kinds of the document model', () => {
    for (const name of ['extractPattern', 'analyzeDocument', 'flagDefsOf', 'findFlagMatches', 'ContainerKind', 'LinePartKind', 'NoteType']) {
      assert.equal(typeof (document as Record<string, unknown>)[name] === 'undefined', false, name);
    }
  });

  it('@monodi/core/page-layout offers the vocabulary, the model, the text and the drawings', () => {
    for (const name of ['VOCABULARY', 'normalisePageLayout', 'describePageLayout', 'pageDiagramSvg', 'staffSampleSvg']) {
      assert.equal(typeof (pageLayout as Record<string, unknown>)[name] === 'undefined', false, name);
    }
  });

  it('@monodi/core/datasets offers the client, the filters of both datasets and the record of imports', () => {
    for (const name of ['loadCatalog', 'loadDataset', 'fetchBytes', 'filterCmSources', 'planCmImport', 'filterCantusSources',
      'planCantusImport', 'cantusDocumentMeta', 'upsertRecord', 'DEFAULT_CATALOG_URL']) {
      assert.equal(typeof (datasets as Record<string, unknown>)[name] === 'undefined', false, name);
    }
  });

  it('@monodi/core/analysis offers the reading of a document, the fingerprints and the methods', () => {
    for (const name of ['extractFeatures', 'methodFingerprint', 'diffDigests', 'digestsOf', 'METHODS', 'runMethod', 'getMethod', 'normalizeParams',
      'tableToCsv', 'buildSegmentIndex', 'windowMatches', 'estimateMode', 'groupableFields']) {
      assert.equal(typeof (analysis as Record<string, unknown>)[name] === 'undefined', false, name);
    }
  });

  it('the kinds are the strings that the app stores in its documents', () => {
    assert.equal(document.ContainerKind.ZeileContainer, 'ZeileContainer');
    assert.equal(document.LinePartKind.Syllable, 'Syllable');
    assert.equal(document.NoteType.Quilisma, 'Quilisma');
  });
});
