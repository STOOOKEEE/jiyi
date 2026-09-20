'use strict';
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let deck = [], state = null, mode = 'study', chosen = null, revealed = false, busy = false, timer;
let sound = new Audio(), playingButton = null;
const pendingKey = 'mandarin-pending-review-v1';
function notice(message, retry = false) { $('notice').textContent = message; $('notice').hidden = !message; $('retry').hidden = !retry; }
function stopSound() { sound.pause(); if (playingButton) { playingButton.textContent = playingButton.dataset.label; playingButton.setAttribute('aria-pressed','false'); } playingButton = null; }
function interval(seconds) { return seconds < 3600 ? `${Math.ceil(seconds / 60)} min` : seconds < 86400 ? `${Math.ceil(seconds / 3600)} h` : `${Math.round(seconds / 86400)} j`; }
async function networkApi(path, payload) {
  const options = {cache:'no-store', signal:AbortSignal.timeout(path==='api/offline'?4000:15000)};
  if (payload) Object.assign(options, {method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':Offline.token()||state.csrf},body:JSON.stringify(payload)});
  const response = await fetch(path, options);
  const body = await response.json();
  if (!response.ok) { const error = new Error(body.error || 'Le serveur ne répond pas.'); error.status = response.status; throw error; }
  return body;
}
function render() {
  stopSound(); clearTimeout(timer);
  if (!state) return; Offline.start();
  $('seen').textContent = `${state.seen} / ${state.total} mots découverts`;
  $('progress').value = state.seen;
  $('stats').innerHTML = `<span><b>${state.due}</b> à revoir</span><span><b>${state.learning_left||0}</b> à consolider</span><span><b>${state.new_left}</b> nouveaux mots</span><span><b>${state.reverse_left}</b> carte${state.reverse_left>1?'s':''} inverse${state.reverse_left>1?'s':''} à découvrir</span><span><b>${state.reviews_today}</b> révisions faites</span>`;
  $('cardProgress').textContent = `${state.cards_seen} / ${state.total_cards} cartes commencées · deux sens par mot`;
  $('limit').value = state.daily_limit;
  $('studyTab').setAttribute('aria-pressed',mode === 'study');
  $('browseTab').setAttribute('aria-pressed',mode === 'browse');
  $('browse').hidden = mode !== 'browse' || !!chosen;
  $('review').hidden = mode === 'browse' && !chosen;
  if (mode === 'browse' && !chosen) { renderList(); return; }
  const current = mode === 'study' ? state.next : {id:chosen};
  if (!current) {
    const future = state.next_due && new Date(state.next_due * 1000);
    $('card').innerHTML = `<div class="empty"><div class="sprout">🌱</div><h1>C’est tout pour le moment.</h1><p>${future ? 'Prochaine révision : ' + esc(future.toLocaleString('fr-FR',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})) + '.' : 'Tes premiers pas sont faits.'}</p><p>Tu peux parcourir les mots ou revenir demain pour la suite.</p></div>`;
    $('actions').innerHTML = '<button id="explore" class="secondary wide">Parcourir les 500 mots</button>';
    $('explore').onclick = () => switchMode('browse');
    if (future) timer = setTimeout(() => refresh(), Math.max(1000, Math.min(60000, future.getTime()-Date.now()+500)));
    return;
  }
  const reverse = current.id < 0;
  const card = deck.find(c => c.id === Math.abs(current.id));
  const example = esc(card.sentence).split(esc(card.hanzi)).join(`<mark>${esc(card.hanzi)}</mark>`);
  $('card').innerHTML = `<article class="flashcard ${revealed?'back':''}"><div class="card-top"><span class="eyebrow">MOT ${String(card.id).padStart(3,'0')} / 500</span><span class="pill">${mode==='browse'?'DÉCOUVERTE':current.interval>0&&current.interval<86400?'À CONSOLIDER':current.revision?'RÉVISION':reverse?'NOUVEAU SENS':'NOUVEAU MOT'}</span></div><p class="direction">${reverse?'FRANÇAIS → CHINOIS':'CHINOIS → FRANÇAIS'}</p><h1 class="${reverse?'french-prompt':'hanzi'}" lang="${reverse?'fr':'zh-CN'}">${esc(reverse?card.fr:card.hanzi)}</h1>${revealed?`${reverse?`<p class="hanzi" lang="zh-CN">${esc(card.hanzi)}</p>`:''}<p class="pinyin">${esc(card.pinyin)}</p>${reverse?'':`<p class="meaning">${esc(card.fr)}</p>`}<button class="play" data-audio="${esc(card.audio_word)}" data-label="▶ Écouter le mot" aria-pressed="false">▶ Écouter le mot</button>${card.emoji?`<div class="emoji" aria-hidden="true">${esc(card.emoji)}</div>`:''}<div class="example"><p class="eyebrow">DANS UNE PHRASE</p><p class="sentence" lang="zh-CN">${example}</p><p class="sentence-pinyin">${esc(card.sentence_pinyin)}</p><p class="translation">${esc(card.sentence_fr)}</p><button class="play" data-audio="${esc(card.audio_sentence)}" data-label="▶ Écouter la phrase" aria-pressed="false">▶ Écouter la phrase</button></div>${card.note?`<p class="note">${esc(card.note)}</p>`:''}`:`<p class="prompt">${reverse?'Comment dit-on cela en chinois ?<br>Retrouve le mot et sa prononciation.':'Comment se prononce ce mot ?<br>Qu’est-ce qu’il veut dire ?'}</p>`}</article>${current.learning_ahead?'<p class="caption">Les autres cartes sont terminées. Cette carte revient maintenant pour consolider le rappel.</p>':''}`;
  document.querySelectorAll('[data-audio]').forEach(button => button.onclick = () => play(button));
  if (!revealed) {
    $('actions').innerHTML = '<button id="reveal" class="primary wide">Voir la réponse</button>';
    $('reveal').onclick = () => { revealed = true; render(); };
  } else if (mode === 'browse') {
    $('actions').innerHTML = '<button id="backToList" class="secondary wide">← Retour aux mots</button><p class="caption">La découverte ne modifie pas ta progression.</p>';
    $('backToList').onclick = () => { chosen = null; render(); };
  } else {
    $('actions').innerHTML = `<div class="grades">${['À revoir','Difficile','Bien','Facile'].map((label,i)=>`<button data-grade="${i+1}" ${busy?'disabled':''}>${label}<small>${interval(current.waits[i])}</small></button>`).join('')}</div><p class="caption">Quand veux-tu revoir ce mot ?</p>`;
    document.querySelectorAll('[data-grade]').forEach(button => button.onclick = () => grade(Number(button.dataset.grade)));
  }
}
function renderList() {
  const normalize = text => text.normalize('NFD').replace(/[\u0300-\u036f\s'’]/g,'').toLowerCase();
  const q = normalize($('search').value);
  const matches = deck.filter(c => normalize(c.hanzi+c.pinyin+c.fr).includes(q));
  $('resultCount').textContent = `${matches.length} mot${matches.length>1?'s':''}`;
  $('wordList').innerHTML = matches.map(c => `<button class="word" data-id="${c.id}"><span class="word-hanzi" lang="zh-CN">${esc(c.hanzi)}</span><span><small>${esc(c.pinyin)}</small>${esc(c.fr)}</span><span aria-hidden="true">›</span></button>`).join('');
  document.querySelectorAll('[data-id]').forEach(button => button.onclick = () => { chosen = Number(button.dataset.id); revealed = true; render(); window.scrollTo(0,0); });
}
function switchMode(next) { if (busy) return; mode = next; chosen = null; revealed = false; render(); }
async function play(button) {
  if (playingButton === button) { stopSound(); return; }
  stopSound(); playingButton = button; sound.src = button.dataset.audio;
  button.textContent = '■ Arrêter'; button.setAttribute('aria-pressed','true');
  sound.onended = stopSound;
  try { await sound.play(); } catch { stopSound(); notice('Lecture indisponible. Vérifie la connexion Tailscale, puis réessaie.'); }
}
async function grade(value) {
  if (busy || !state.next || !revealed) return;
  const payload = {card_id:state.next.id,grade:value,revision:state.next.revision,request_id:crypto.randomUUID()};
  try { localStorage.setItem(pendingKey,JSON.stringify(payload)); }
  catch { notice('Le stockage du navigateur est désactivé. Autorise-le pour sauvegarder tes réponses.'); return; }
  await savePending(payload);
}
async function savePending(payload) {
  busy = true; render();
  try {
    state = await api('api/review',payload);
    localStorage.removeItem(pendingKey); revealed = false; notice(''); window.scrollTo(0,0);
  } catch (error) {
    if (error.status === 409 || error.status === 400) {
      localStorage.removeItem(pendingKey); notice(error.message); state = await api('api/state'); revealed = false;
    } else notice('Réponse en attente de sauvegarde. Vérifie Tailscale et réessaie ; elle ne sera comptée qu’une fois.',true);
  } finally { busy = !!localStorage.getItem(pendingKey); render(); }
}
async function refresh() {
  try {
    state = await api('api/state');
    const pending = localStorage.getItem(pendingKey);
    if (pending) { await savePending(JSON.parse(pending)); return; }
    busy = false; notice(''); render();
  } catch { notice('Serveur inaccessible. Active Tailscale sur cet appareil, puis réessaie.',true); }
}
$('studyTab').onclick = () => switchMode('study');
$('browseTab').onclick = () => switchMode('browse');
$('search').oninput = renderList;
$('helpToggle').onclick = () => { $('help').hidden = !$('help').hidden; $('helpToggle').setAttribute('aria-expanded',!$('help').hidden); };
$('retry').onclick = () => boot();
$('settings').onsubmit = async event => {
  event.preventDefault(); if (!state || busy) return;
  try { state = await api('api/settings',{daily_limit:Number($('limit').value)}); notice('Rythme quotidien enregistré.'); render(); }
  catch (error) { notice(error.message || 'Réglage non enregistré.',true); }
};
document.addEventListener('visibilitychange',() => { if (document.hidden) stopSound(); else if (!busy && !revealed) refresh(); });
window.addEventListener('online',() => refresh());
async function boot() {
  try { if (!deck.length) deck = await api('deck.json'); await refresh(); }
  catch { notice('Connexion impossible. Active Tailscale puis réessaie.',true); }
}
boot();

window.addEventListener('pageshow',event=>{if(event.persisted&&state&&!busy&&!revealed)refresh();});
window.addEventListener('focus',()=>{if(state&&!busy&&!revealed)refresh();});
