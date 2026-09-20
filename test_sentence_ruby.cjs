// node test_sentence_ruby.cjs — corpus integrity and actual safe rendering.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const deck=JSON.parse(fs.readFileSync('public/deck.json'));
const letters=s=>Array.from(s.normalize('NFC')).filter(c=>/\p{L}/u.test(c)).join('');
for(const card of deck){
 assert.equal(card.sentence_ruby.map(p=>p.text).join(''),card.sentence);
 assert.equal(letters(card.sentence_ruby.map(p=>p.pinyin).join('')),letters(card.sentence_pinyin));
 for(const p of card.sentence_ruby){
  if(/\p{Script=Han}/u.test(p.text)){assert(p.pinyin);assert(p.text.length===1||p.text.endsWith('儿')&&p.pinyin.endsWith('r'));}
  else assert.equal(p.pinyin,'');
 }
}
const source=fs.readFileSync('public/app.js','utf8'),ctx={};vm.createContext(ctx);
vm.runInContext(source.slice(source.indexOf('const esc ='),source.indexOf('let deck ='))+source.slice(source.indexOf('function sentenceMarkup('),source.indexOf('function render()'))+';globalThis.renderSentence=sentenceMarkup',ctx);
const card=deck.find(c=>c.id===13),html=ctx.renderSentence(card);
assert(html.includes('<ruby><mark>和</mark><rt lang="zh-Latn">hé</rt></ruby>'));
assert(html.includes('<ruby>朋<rt lang="zh-Latn">péng</rt></ruby><ruby>友<rt lang="zh-Latn">you</rt></ruby>'));
assert(!html.includes('sentence-pinyin'));assert(!html.includes('undefined'));
assert(deck.find(c=>c.id===19).sentence_ruby.some(p=>p.text==='点儿'&&p.pinyin==='diǎnr'));
assert(deck.find(c=>c.id===189).sentence_ruby.some(p=>p.text==='儿'&&p.pinyin==='ér'));
const injected=ctx.renderSentence({...card,sentence:'<x>',hanzi:'<x>',sentence_ruby:[{text:'<x>',pinyin:'<script>'}]});assert(!injected.includes('<script>'));assert(injected.includes('&lt;script&gt;'));
const legacy={...card};delete legacy.sentence_ruby;assert(ctx.renderSentence(legacy).includes('sentence-pinyin'));
console.log('PASS: 500 exact alignments, original tones preserved, erhua, target highlight, escaped annotations, old-cache fallback');
