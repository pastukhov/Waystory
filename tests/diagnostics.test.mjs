import test from 'node:test';
import assert from 'node:assert/strict';
import {providerFailure,safeLogLine} from '../server/diagnostics.mjs';
test('provider errors expose only allowlisted metadata',()=>{let line;const id=providerFailure('speech',429,12.8,s=>line=s);assert.equal(JSON.parse(line).status,429);assert.equal(JSON.parse(line).durationMs,13);assert.equal(JSON.parse(line).requestId,id);const extra=JSON.stringify({...JSON.parse(line),token:'secret',text:'private story'});assert.equal(JSON.stringify(safeLogLine(extra)).includes('secret'),false);assert.equal(JSON.stringify(safeLogLine(extra)).includes('private'),false);assert.equal(safeLogLine('Authorization: Api-Key secret'),null);assert.equal(safeLogLine(JSON.stringify({...JSON.parse(line),requestId:'secret'})),null)});
