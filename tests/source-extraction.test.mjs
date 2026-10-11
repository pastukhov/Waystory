import test from 'node:test';import assert from 'node:assert/strict';import * as extraction from '../server/sources/extract.mjs';
test('unreviewed search content cannot become model evidence',()=>{assert.equal(extraction.extractEvidence({url:'https://example.org',snippet:'history'},{placeId:'osm:node:1'}),null)});
