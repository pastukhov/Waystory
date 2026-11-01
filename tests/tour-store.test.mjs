import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {registerSourcePolicy} from '../server/sources/policies.mjs';
import {createTourStore} from '../server/tours/store.mjs';

const chapter = (id='overview') => ({id,topicId:id,status:'planned',text:null,evidenceIds:[],claims:[],coveredFactKeys:[],estimatedSeconds:0,error:null});
const input = (extra={}) => ({placeId:'wiki:ru:173387',language:'ru',sourceFingerprint:'fp1',status:'ready',topics:[],chapters:[chapter()],...extra});
function setup(t, options={}) { let time=1000; const db=new DatabaseSync(':memory:'); t.after(()=>db.close()); return {db,store:createTourStore({db,now:()=>time,...options}),tick:ms=>time+=ms}; }

test('owner isolation, public JSON roundtrip, additive migration and unique chapters',t=>{
 const {db,store}=setup(t); db.exec('CREATE TABLE unrelated(value TEXT)');
 const a=store.create('A',input());
 assert.equal(store.get('B',a.id),null); assert.equal(store.findActive('B',a.placeId,'ru'),null);
 assert.equal(store.get('A',a.id).placeId,'wiki:ru:173387');
 assert.equal(store.get('A',a.id).ownerId,undefined); assert.equal(store.get('A',a.id).snapshot,undefined);
 assert.equal(store.findActive('A',a.placeId,'ru').id,a.id);
 createTourStore({db,now:()=>1000}); assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name='unrelated'").get());
 assert.throws(()=>store.create('A',input({chapters:[chapter(),chapter()]})),/chapter/i);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM tours').get().n,1);
});

test('atomic claims, expiry and stale completions never overwrite a newer job',t=>{
 const {store,tick,db}=setup(t); const a=store.create('A',input());
 assert.equal(store.claimJob('B',a.id,'overview'),null);
 const first=store.claimJob('A',a.id,'overview'); assert.ok(first); assert.equal(store.claimJob('A',a.id,'overview'),null);
 assert.equal(db.isTransaction,false); tick(120000);
 assert.equal(store.completeJob(first,{text:'stale',status:'ready'}),false);
 const next=store.claimJob('A',a.id,'overview'); assert.ok(next); assert.notEqual(first,next);
 assert.equal(store.failJob(first,{code:'provider_error',retryable:true}),false);
 assert.equal(store.completeJob(next,{...chapter(),status:'ready',text:'Verified text'}),true);
 assert.equal(store.get('A',a.id).chapters[0].text,'Verified text');
 assert.equal(store.claimJob('A',a.id,'overview'),null);
});

test('startup recovers expired work without retrying and preserves ready neighbours',t=>{
 const {store,tick,db}=setup(t); const a=store.create('A',input({chapters:[chapter(),chapter('park')]}));
 store.completeJob(store.claimJob('A',a.id,'park'),{...chapter('park'),status:'ready',text:'Park'});
 const token=store.claimJob('A',a.id,'overview'); tick(120000);
 const restored=createTourStore({db,now:()=>121000}); const current=restored.get('A',a.id);
 assert.equal(current.chapters[0].status,'failed'); assert.equal(current.chapters[0].error.code,'provider_timeout');
 assert.equal(current.chapters[0].error.retryable,true); assert.equal(current.chapters[1].text,'Park');
 assert.equal(restored.completeJob(token,{text:'late'}),false);
});

test('progress is separately owner-scoped and validates chapter IDs and cursor bounds',t=>{
 const {store}=setup(t); const a=store.create('A',input());
 const p={chapterId:'overview',chunkIndex:2,offsetSeconds:1.5,completedChapterIds:[]};
 assert.equal(store.saveProgress('B',a.id,p),null); assert.deepEqual(store.saveProgress('A',a.id,p),p);
 assert.deepEqual(store.get('A',a.id).progress,p);
 for(const bad of [{...p,chapterId:'unknown'},{...p,chunkIndex:-1},{...p,offsetSeconds:Infinity},{...p,completedChapterIds:['unknown']}]) assert.throws(()=>store.saveProgress('A',a.id,bad),{status:400});
});

test('TTL expires inactive tours and active tours survive cleanup until lease expiry',t=>{
 const {store,tick}=setup(t); const a=store.create('A',input());
 const active=store.create('B',input()); tick(604799999); const token=store.claimJob('B',active.id,'overview'); tick(1);
 store.cleanup(); assert.equal(store.get('A',a.id),null); assert.ok(store.get('B',active.id));
 tick(120000); store.cleanup(); assert.equal(store.get('B',active.id),null); assert.equal(store.completeJob(token,{text:'late'}),false);
});

test('count and UTF8 payload caps evict only inactive LRU and reject atomically when all active',t=>{
 const {store,tick,db}=setup(t,{maxTours:2,maxStorageBytes:5000});
 const a=store.create('A',input());tick(1);const b=store.create('B',input());tick(1);store.get('A',a.id);tick(1);
 const c=store.create('C',input());assert.equal(store.get('B',b.id),null);
 const activeToken=store.claimJob('A',a.id,'overview');store.claimJob('C',c.id,'overview');
 assert.throws(()=>store.create('D',input()),{status:429});assert.equal(db.prepare('SELECT COUNT(*) n FROM tours').get().n,2);
 assert.throws(()=>store.completeJob(activeToken,{...chapter(),status:'ready',text:'Я'.repeat(5000)}),{status:429});
 assert.equal(store.get('A',a.id).chapters[0].status,'generating');
});

const doc=(policyId='wikimedia-cc-by-sa')=>({id:'s1',title:'Source',url:'https://example.org',text:'ORIGINAL SECRET SOURCE',revision:'r1',scope:'place',language:'en',license:{policyId}});
test('permitted snapshots persist with their fingerprint and output, forbidden text stays in memory',t=>{
 registerSourcePolicy('tour-volatile',{allowModelInput:true,allowTextCache:false,ttlMs:604800000});
 const {store,db}=setup(t);
 const a=store.create('A',input({snapshot:{documents:[doc()],spans:[]}}));
 assert.equal(store.getSnapshot('A',a.id).documents[0].text,'ORIGINAL SECRET SOURCE');
 const b=store.create('B',input({snapshot:{documents:[doc('tour-volatile')],spans:[{text:'ORIGINAL SECRET SOURCE'}]}}));
 assert.equal(store.get('B',b.id).volatile,true);
 assert.equal(store.getSnapshot('A',b.id),null);
 assert.equal(store.getSnapshot('B',b.id).documents[0].text,'ORIGINAL SECRET SOURCE');
 store.completeJob(store.claimJob('B',b.id,'overview'),{...chapter(),status:'ready',text:'PRIVATE ADAPTATION',claims:[{text:'PRIVATE ADAPTATION',evidenceIds:['s1']}]});
 assert.equal(store.get('B',b.id).chapters[0].text,'PRIVATE ADAPTATION');
 const persisted=JSON.stringify(db.prepare('SELECT data,snapshot FROM tours').all())+JSON.stringify(db.prepare('SELECT data FROM tour_chapters WHERE tour_id=?').all(b.id));
 assert.equal(persisted.includes('PRIVATE ADAPTATION'),false);
 assert.equal(db.prepare('SELECT snapshot FROM tours WHERE id=?').get(b.id).snapshot.includes('ORIGINAL SECRET SOURCE'),false);
 const restarted=createTourStore({db,now:()=>1000});
 assert.equal(restarted.getSnapshot('A',a.id).documents[0].text,'ORIGINAL SECRET SOURCE');
 assert.throws(()=>restarted.getSnapshot('B',b.id),{code:'source_unavailable'});
 assert.equal(restarted.get('B',b.id).chapters[0].status,'planned');
 assert.throws(()=>restarted.getSnapshot('B',b.id,{snapshot:{documents:[doc()]},fingerprint:'changed'}),{code:'source_unavailable'});
 assert.equal(restarted.getSnapshot('B',b.id,{snapshot:{documents:[doc('tour-volatile')]},fingerprint:'fp1'}).documents[0].text,'ORIGINAL SECRET SOURCE');
});

test('output persistence can be forbidden independently of source text persistence',t=>{
 registerSourcePolicy('tour-no-output',{allowModelInput:true,allowTextCache:true,allowOutputCache:false,ttlMs:604800000});
 const {store,db}=setup(t);const a=store.create('A',input({snapshot:{documents:[doc('tour-no-output')]}}));
 store.completeJob(store.claimJob('A',a.id,'overview'),{...chapter(),status:'ready',text:'NONCACHEABLE OUTPUT',claims:[{text:'NONCACHEABLE OUTPUT'}]});
 assert.ok(db.prepare('SELECT snapshot FROM tours WHERE id=?').get(a.id).snapshot.includes('ORIGINAL SECRET SOURCE'));
 assert.equal(db.prepare('SELECT data FROM tour_chapters WHERE tour_id=?').get(a.id).data.includes('NONCACHEABLE OUTPUT'),false);
 assert.equal(store.get('A',a.id).chapters[0].volatile,true);
 assert.equal(createTourStore({db,now:()=>1000}).get('A',a.id).chapters[0].text,null);
});

test('plan job atomically publishes topics and chapters before overview generation',t=>{
 const {store}=setup(t);const a=store.create('A',input({status:'planning',chapters:[]}));
 const token=store.claimJob('A',a.id,'plan');assert.ok(token);
 assert.equal(store.completeJob(token,{topics:[{id:'park',title:'Park'}],chapters:[chapter(),chapter('park')],sourceFingerprint:'fp1',snapshot:{documents:[doc()]}}),true);
 const ready=store.get('A',a.id);assert.equal(ready.status,'ready');assert.equal(ready.chapters.length,2);assert.equal(ready.chapters[0].status,'planned');
 assert.equal(store.claimJob('A',a.id,'plan'),null);
});

test('explicit retry can reclaim only retryable failed chapters',t=>{
 const {store}=setup(t);const a=store.create('A',input({chapters:[chapter(),chapter('park')]}));
 store.failJob(store.claimJob('A',a.id,'overview'),{code:'provider_error',retryable:true});
 assert.equal(store.claimJob('A',a.id,'overview'),null);
 assert.ok(store.claimJob('A',a.id,'overview',{retry:true}));
 store.failJob(store.claimJob('A',a.id,'park'),{code:'verification_failed',retryable:false});
 assert.equal(store.claimJob('A',a.id,'park',{retry:true}),null);
});

test('volatile chapters show generating and generated topic summaries never persist',t=>{
 registerSourcePolicy('tour-volatile-plan',{allowModelInput:true,allowTextCache:false,ttlMs:604800000});
 const {store,db}=setup(t);const a=store.create('A',input({status:'planning',chapters:[]}));
 const plan=store.claimJob('A',a.id,'plan');
 store.completeJob(plan,{topics:[{id:'park',title:'SECRET TITLE',summary:'SECRET SUMMARY'}],snapshot:{documents:[doc('tour-volatile-plan')]},chapters:[chapter(),chapter('park')]});
 assert.equal(store.get('A',a.id).topics[0].summary,'SECRET SUMMARY');
 const persisted=db.prepare('SELECT data FROM tours WHERE id=?').get(a.id).data;
 assert.equal(persisted.includes('SECRET SUMMARY'),false);assert.equal(persisted.includes('SECRET TITLE'),false);
 store.claimJob('A',a.id,'overview');assert.equal(store.get('A',a.id).chapters[0].status,'generating');
});

test('source policy TTL bounds persistent and volatile snapshots',t=>{
 registerSourcePolicy('tour-short-lived',{allowModelInput:true,allowTextCache:true,ttlMs:2000});
 const {store,tick}=setup(t);const a=store.create('A',input({snapshot:{documents:[doc('tour-short-lived')]}}));
 assert.equal(a.expiresAt,3000);tick(2000);assert.equal(store.get('A',a.id),null);
});

test('snapshot rehydration cannot make a forbidden ready adaptation persistent',t=>{
 registerSourcePolicy('tour-volatile-reload',{allowModelInput:true,allowTextCache:false,ttlMs:604800000});
 const {store}=setup(t);const a=store.create('A',input({snapshot:{documents:[doc('tour-volatile-reload')]}}));
 store.completeJob(store.claimJob('A',a.id,'overview'),{status:'ready',text:'Private adaptation'});
 assert.throws(()=>store.getSnapshot('A',a.id,{snapshot:{documents:[doc()]},fingerprint:'fp1'}),{code:'source_unavailable'});
});

test('logical storage cap counts UTF8 bytes and volatile snapshots and rolls back oversized writes',t=>{
 const {store,db}=setup(t,{maxStorageBytes:3000});
 const a=store.create('A',input());const token=store.claimJob('A',a.id,'overview');
 assert.throws(()=>store.completeJob(token,{status:'ready',text:'Я'.repeat(2000)}),{status:429});
 assert.equal(store.get('A',a.id).chapters[0].status,'generating');
 assert.equal(store.completeJob(token,{status:'ready',text:'A'.repeat(2000)}),true);
 registerSourcePolicy('tour-large-volatile',{allowModelInput:true,allowTextCache:false,ttlMs:604800000});
 assert.throws(()=>store.create('B',input({snapshot:{documents:[{...doc('tour-large-volatile'),text:'X'.repeat(3000)}]}})),{status:429});
 assert.equal(db.prepare('SELECT COUNT(*) n FROM tours').get().n,1);
});

test('polling recovers a lease that expires after startup, without starting work',t=>{
 const {store,db,tick}=setup(t);const a=store.create('A',input());store.claimJob('A',a.id,'overview');
 let restartTime=1001;const restarted=createTourStore({db,now:()=>restartTime});
 assert.equal(restarted.get('A',a.id).chapters[0].status,'generating');restartTime=121001;tick(120001);
 const current=restarted.get('A',a.id);assert.equal(current.chapters[0].status,'failed');assert.equal(current.chapters[0].error.code,'provider_timeout');
 assert.equal(db.prepare('SELECT job_token FROM tour_chapters WHERE tour_id=?').get(a.id).job_token,null);
});

test('claim reserves terminal error capacity before accepting work and failure stays within cap',t=>{
 const {store}=setup(t,{maxStorageBytes:500});const a=store.create('A',input());
 assert.throws(()=>store.claimJob('A',a.id,'overview'),{status:429});
 assert.equal(store.get('A',a.id).chapters[0].status,'planned');assert.ok(store.stats().bytes<=500);
 const second=setup(t,{maxStorageBytes:3000});const b=second.store.create('B',input({chapters:[chapter(),{...chapter('park'),status:'ready',text:'Saved park'}]}));
 const token=second.store.claimJob('B',b.id,'overview');assert.ok(token);
 assert.equal(second.store.failJob(token,{code:'provider_timeout'}),true);
 assert.equal(second.store.get('B',b.id).chapters[0].status,'failed');assert.equal(second.store.get('B',b.id).chapters[1].text,'Saved park');
 assert.ok(second.store.stats().bytes<=3000);
});

test('volatile chapter IDs survive placeholders, progress saves and restart',t=>{
 registerSourcePolicy('tour-volatile-id',{allowModelInput:true,allowTextCache:false,ttlMs:604800000});
 const {store,db}=setup(t);const a=store.create('A',input({snapshot:{documents:[doc('tour-volatile-id')]},chapters:[{...chapter(),id:'chapter-123',status:'ready',text:'Done'}]}));
 assert.equal(a.chapters[0].id,'chapter-123');
 const progress={chapterId:'chapter-123',chunkIndex:0,offsetSeconds:0,completedChapterIds:[]};
 assert.deepEqual(store.saveProgress('A',a.id,progress),progress);
 const restarted=createTourStore({db,now:()=>1000});assert.equal(restarted.get('A',a.id).chapters[0].id,'chapter-123');
 const token=restarted.claimJob('A',a.id,'overview');restarted.completeJob(token,{status:'ready',text:'Again'});
 assert.equal(restarted.get('A',a.id).chapters[0].id,'chapter-123');
});

test('explicit zero source TTL refuses a retained snapshot rather than granting seven days',t=>{
 registerSourcePolicy('tour-zero-ttl',{allowModelInput:true,allowTextCache:false,ttlMs:0});
 const {store,db}=setup(t);
 assert.throws(()=>store.create('A',input({snapshot:{documents:[doc('tour-zero-ttl')]}})),{code:'source_unavailable'});
 assert.equal(db.prepare('SELECT COUNT(*) n FROM tours').get().n,0);
});

test('plan failure fits reserved capacity for both error copies without evicting ready work',t=>{
 const {store,db}=setup(t);const ready=store.create('B',input({chapters:[{...chapter(),status:'ready',text:'Saved overview'}]}));
 const plan=store.create('A',input({status:'planning',chapters:[]}));const token=store.claimJob('A',plan.id,'plan');
 const exactCap=store.stats().bytes;const limited=createTourStore({db,now:()=>1000,maxStorageBytes:exactCap});
 assert.equal(limited.failJob(token,{code:'source_unavailable',retryable:true}),true);
 assert.equal(limited.get('A',plan.id).status,'failed');assert.equal(limited.get('A',plan.id).error.code,'source_unavailable');
 assert.equal(limited.get('B',ready.id).chapters[0].text,'Saved overview');assert.ok(limited.stats().bytes<=exactCap);
 assert.equal(limited.get('B',ready.id).chapters[0]._failureReserve,undefined);
});
test('progress persists optional chunking version and accepts legacy clients',t=>{const {store,db}=setup(t),a=store.create('A',input()),progress={chapterId:'overview',chunkIndex:1,offsetSeconds:8,completedChapterIds:[],chunkingVersion:2};assert.deepEqual(store.saveProgress('A',a.id,progress),progress);assert.deepEqual(createTourStore({db,now:()=>1000}).get('A',a.id).progress,progress);for(const version of [null,0,-1,1.5,'2'])assert.throws(()=>store.saveProgress('A',a.id,{...progress,chunkingVersion:version}),{status:400})});
