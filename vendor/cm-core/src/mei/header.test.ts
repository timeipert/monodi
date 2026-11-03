// The checks of the shared header mapping that need no DOM. The header written for a document is tested in the app
// (apps/monodi/src/app/mei/mei-header.spec.ts), because the emitter needs a browser DOM (see README.md).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HANDLED, NOT_YET_AVAILABLE } from './header-mapped.ts';
import { CHILD_ORDER, parsePath } from './header-writer.ts';
import { METADATA_MAPPING } from './metadata-mapping.generated.ts';

describe('MEI header mapping coverage', () => {
  it('every mapping entry with an MEI target has a handler or a documented reason', () => {
    const unknown = METADATA_MAPPING.entries.map(e => e.id).filter(id => !HANDLED.includes(id) && !(id in NOT_YET_AVAILABLE));
    assert.deepEqual(unknown, []);
  });

  it('handlers and reasons refer to existing entries only', () => {
    const ids = METADATA_MAPPING.entries.map(e => e.id);
    assert.deepEqual(HANDLED.filter(id => !ids.includes(id)), []);
    assert.deepEqual(Object.keys(NOT_YET_AVAILABLE).filter(id => !ids.includes(id)), []);
  });

  it('the schema order table names fileDesc among the header parents', () => {
    assert.ok(Object.keys(CHILD_ORDER).includes('fileDesc'));
  });

  it('parsePath reads element steps with predicates and a final attribute', () => {
    assert.deepEqual(parsePath("fileDesc/titleStmt/title[@type='main']"), {
      steps: [{ name: 'fileDesc', attrs: [] }, { name: 'titleStmt', attrs: [] }, { name: 'title', attrs: [['type', 'main']] }],
      attr: undefined
    });
    assert.equal(parsePath('@xml:lang').attr, 'xml:lang');
    assert.throws(() => parsePath('title[0]'), /Unsupported path step/);
  });
});
