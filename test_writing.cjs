// node test_writing.cjs — corpus, local assets and writing controller lifecycle.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const strokes=JSON.parse(fs.readFileSync('public/strokes.json'));
const deck=JSON.parse(fs.readFileSync('public/deck.json'));
for(const c of new Set(deck.flatMap(w=>Array.from(w.hanzi)))){
 assert(strokes[c]);assert(strokes[c].strokes.length>0);
 assert.equal(strokes[c].strokes.length,strokes[c].medians.length);
}
const html=fs.readFileSync('public/index.html','utf8');
for(const name of ['offline.js','app.js','writing.js','vendor/hanzi-writer.min.js'])assert.equal((html.match(new RegExp('src="'+name.replaceAll('.','\\.')+'[?\"]','g'))||[]).length,1);
assert(html.indexOf('src="writing.js')<html.indexOf('src="app.js'));
assert(fs.readFileSync('public/offline-assets.json','utf8').includes('strokes.json'));
const nodes={},calls=[];let created=0,quiz,options,ready,fetches=0;
const node=id=>nodes[id]??=( {hidden:id==='writing',parentElement:{clientWidth:320},textContent:''} );
const writer={};
for(const name of ['setCharacter','updateDimensions','showOutline','hideOutline','animateCharacter','cancelQuiz','pauseAnimation','highlightStroke'])writer[name]=(...args)=>{calls.push([name,...args]);return Promise.resolve();};
writer.quiz=async settings=>{quiz=settings;calls.push(['quiz']);};
const ctx={document:{getElementById:node,addEventListener:(event,cb)=>ready=cb},fetch:async url=>{assert.equal(url,'strokes.json');fetches++;return {ok:true,json:async()=>strokes};},HanziWriter:{create:(id,c,opt)=>{created++;options=opt;return writer;}}};
vm.createContext(ctx);vm.runInContext(fs.readFileSync('public/writing.js','utf8')+';globalThis.api=Writing;',ctx);ready();
const flush=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
 const word={hanzi:'朋友'};
 ctx.api.update(word,true,'reverse:1');await flush();
 assert.equal(created,1);assert.equal(options.showCharacter,false);assert(calls.some(c=>c[0]==='hideOutline'));
 assert.equal(options.charDataLoader('朋'),strokes['朋']);assert.equal(quiz.showHintAfterMisses,2);
 const count=calls.length;ctx.api.update(word,true,'reverse:1');await flush();assert.equal(calls.length,count,'revealing must preserve drawing');
 node('writeGuide').onclick();await flush();assert.equal(quiz.showHintAfterMisses,1);
 quiz.onMistake({strokeNum:0});assert(node('writeStatus').textContent.includes('essaie encore'));
 quiz.onCorrectStroke({strokeNum:0,strokesRemaining:7});assert(calls.some(c=>c[0]==='highlightStroke'&&c[1]===1));
 quiz.onComplete({totalMistakes:1});assert(node('writeStatus').textContent.includes('sans modèle'));
 node('writeNext').onclick();await flush();assert(calls.some(c=>c[0]==='setCharacter'&&c[1]==='友'));assert(node('writeNext').disabled);
 node('writeMemory').onclick();await flush();assert.equal(quiz.showHintAfterMisses,2);
 quiz.onComplete({totalMistakes:0});assert(node('writeStatus').textContent.includes('Mot terminé'));
 const oldQuiz=quiz;ctx.api.hide();const text=node('writeStatus').textContent;oldQuiz.onComplete({totalMistakes:8});assert.equal(node('writeStatus').textContent,text);assert(node('writing').hidden);
 ctx.api.open({hanzi:'一'},'forward:1',true);await flush();assert.equal(created,1);assert.equal(fetches,1);
 await node('writeAnimate').onclick();assert(node('writeStatus').textContent.includes('À toi'));assert.equal(node('writeAnimate').disabled,false);
 // A navigation before loading completes must not create a stale exercise.
 ctx.api.update(word,true,'reverse:2');ctx.api.hide();await flush();assert.equal(created,1);assert(node('writing').hidden);
 console.log('PASS: 526 characters, script order, offline assets, memory/guided/animated modes, feedback, multi-character navigation, persistent writer, stale callback cancellation');
})().catch(e=>{console.error(e);process.exitCode=1;});
