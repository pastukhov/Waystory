import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createTourStore} from '../server/tours/store.mjs';
import {createTourJobs} from '../server/tours/jobs.mjs';
function setup(t){let time=1000;const db=new DatabaseSync(':memory:');t.after(()=>db.close());const store=createTourStore({db,now:()=>time});const jobs=createTourJobs({store,now:()=>time});t.after(()=>jobs.shutdown());const create=owner=>store.create(owner,{placeId:'wiki:ru:1',language:'ru',status:'ready',chapters:[{id:'overview',topicId:'overview',status:'planned',text:null},{id:'park',topicId:'park',status:'planned',text:null}]});return {db,store,jobs,create,tick:ms=>time+=ms};}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

test('two simultaneous chapter requests run once and preserve completed work',async t=>{
 const {store,jobs,create,db}=setup(t);const a=create('A');const gate=deferred();let calls=0;
 const run=async({signal,jobToken})=>{calls++;assert.equal(db.isTransaction,false);assert.equal(signal.aborted,false);assert.ok(jobToken);await gate.promise;return {status:'ready',text:'Verified'};};
 const results=await Promise.all([Promise.resolve().then(()=>jobs.start({ownerId:'A',tourId:a.id,topicId:'overview',run})),Promise.resolve().then(()=>jobs.start({ownerId:'A',tourId:a.id,topicId:'overview',run}))]);
 assert.equal(results.filter(r=>r.accepted).length,1);assert.equal(calls,1);
 gate.resolve();await jobs.drain();assert.equal(store.get('A',a.id).chapters[0].text,'Verified');
 assert.equal(jobs.start({ownerId:'A',tourId:a.id,topicId:'overview',run}).accepted,false);assert.equal(calls,1);
});

test('one job per owner and two per process, with no implicit queue',async t=>{
 const {jobs,create,store}=setup(t);const a=create('A'),b=create('B'),c=create('C'),a2=create('A');const gate=deferred();
 const run=()=>gate.promise.then(()=>({status:'ready',text:'Done'}));
 jobs.start({ownerId:'A',tourId:a.id,topicId:'overview',run});
 assert.throws(()=>jobs.start({ownerId:'A',tourId:a2.id,topicId:'overview',run}),{status:429,code:'busy'});
 jobs.start({ownerId:'B',tourId:b.id,topicId:'overview',run});
 assert.throws(()=>jobs.start({ownerId:'C',tourId:c.id,topicId:'overview',run}),{status:429});
 assert.equal(store.get('C',c.id).chapters[0].status,'planned');gate.resolve();await jobs.drain();
 assert.equal(store.get('C',c.id).chapters[0].status,'planned');
});

test('failed execution is safely published and releases owner slot',async t=>{
 const {jobs,create,store}=setup(t);const a=create('A');
 jobs.start({ownerId:'A',tourId:a.id,topicId:'overview',run:async()=>{throw Error('SECRET upstream response');}});
 await jobs.drain();const chapter=store.get('A',a.id).chapters[0];assert.equal(chapter.status,'failed');assert.equal(chapter.error.code,'provider_error');assert.equal(JSON.stringify(chapter).includes('SECRET'),false);
 assert.equal(jobs.start({ownerId:'A',tourId:a.id,topicId:'park',run:async()=>({status:'ready',text:'Park'})}).accepted,true);await jobs.drain();
});

test('deadline expiry aborts and prevents late completion with fake time',async t=>{
 const {jobs,create,store,tick}=setup(t);const a=create('A');const gate=deferred();let signal;
 jobs.start({ownerId:'A',tourId:a.id,topicId:'overview',run:async args=>{signal=args.signal;await gate.promise;return {status:'ready',text:'Too late'};}});
 await Promise.resolve();tick(90000);gate.resolve();await jobs.drain();
 assert.equal(signal.aborted,true);assert.equal(store.get('A',a.id).chapters[0].error.code,'provider_timeout');
});

test('shutdown aborts accepted jobs, rejects new work and ignores a late result',async t=>{
 const {jobs,create,store}=setup(t);const a=create('A');const gate=deferred();let signal;
 jobs.start({ownerId:'A',tourId:a.id,topicId:'overview',run:async args=>{signal=args.signal;await gate.promise;return {status:'ready',text:'Late'};}});
 await Promise.resolve();jobs.shutdown();assert.equal(signal.aborted,true);
 assert.throws(()=>jobs.start({ownerId:'A',tourId:a.id,topicId:'park',run:async()=>{}}),{status:503});
 gate.resolve();await jobs.drain();assert.equal(store.get('A',a.id).chapters[0].status,'failed');assert.equal(store.get('A',a.id).chapters[0].text,null);
});

test('explicit retry uses a new claim and no disconnect listener cancels accepted work',async t=>{
 const {jobs,create,store}=setup(t);const a=create('A');let calls=0;
 const run=async()=>{calls++;if(calls===1)throw Object.assign(Error('temporary'),{code:'provider_timeout',retryable:true});return {status:'ready',text:'Recovered'};};
 jobs.start({ownerId:'A',tourId:a.id,topicId:'overview',run});await jobs.drain();
 assert.equal(jobs.start({ownerId:'A',tourId:a.id,topicId:'overview',run}).accepted,false);
 assert.equal(jobs.start({ownerId:'A',tourId:a.id,topicId:'overview',retry:true,run}).accepted,true);await jobs.drain();
 assert.equal(store.get('A',a.id).chapters[0].text,'Recovered');assert.equal(calls,2);
});
