import test from 'node:test';import assert from 'node:assert/strict';
import {createSourceHttp} from '../server/sources/http.mjs';
test('source transport rejects arbitrary hosts, redirects and oversized responses',async()=>{let calls=0;const request=createSourceHttp({fetchFn:async()=>{calls++;return new Response('x'.repeat(30))}});await assert.rejects(request('https://evil.example/api'));assert.equal(calls,0);await assert.rejects(request('https://www.wikidata.org/w/api.php',{maxBytes:5}));});
test('aborted request never starts upstream',async()=>{let calls=0;const request=createSourceHttp({fetchFn:async()=>{calls++;return new Response('{}')}});await assert.rejects(request('https://www.wikidata.org/w/api.php',{signal:AbortSignal.abort()}));assert.equal(calls,0)});
