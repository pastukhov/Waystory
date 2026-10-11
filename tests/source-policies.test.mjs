import test from 'node:test';
import assert from 'node:assert/strict';
import {sourcePolicy,licenseFor} from '../server/sources/policies.mjs';
test('unknown rights prohibit model use and caching',()=>{const p=sourcePolicy('some-government-website');assert.equal(p.allowModelInput,false);assert.equal(p.allowTextCache,false);assert.equal(p.ttlMs,0)});
test('Wikimedia adaptations carry attribution and share alike',()=>{assert.equal(sourcePolicy('wikimedia-cc-by-sa').outputLicense,'CC-BY-SA-4.0');assert.equal(licenseFor('wikimedia-cc-by-sa','Wikipedia contributors').attribution,'Wikipedia contributors');assert.equal(sourcePolicy('osm-odbl').allowModelInput,false)});
