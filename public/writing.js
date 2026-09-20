'use strict';
// One reusable writer: avoid accumulating the library's document-level touch listeners.
const Writing=(()=>{
 let writer=null,dataTask=null,card=null,key=null,index=0,guided=false,turn=0,done=new Set();
 const el=id=>document.getElementById(id);
 const chars=()=>Array.from(card.hanzi);
 const controls=['writeAnimate','writeGuide','writeMemory','writeRestart'];
 function status(text){el('writeStatus').textContent=text;}
 function navigation(){
  el('writePosition').textContent=`Caractère ${index+1} / ${chars().length} · ${done.size} terminé${done.size>1?'s':''}`;
  el('writePrevious').disabled=index===0;el('writeNext').disabled=index===chars().length-1;
 }
 async function data(){
  if(!dataTask)dataTask=fetch('strokes.json').then(r=>{if(!r.ok)throw Error('Tracés indisponibles. Télécharge le mode hors ligne, puis réessaie.');return r.json();}).catch(e=>{dataTask=null;throw e;});
  return dataTask;
 }
 function hide(){
  if(el('writing').hidden)return;
  turn++;el('writing').hidden=true;writer?.cancelQuiz();void writer?.pauseAnimation();key=null;
 }
 async function exercise(action='quiz'){
  const ticket=++turn,character=chars()[index];
  controls.forEach(id=>el(id).disabled=true);status('Chargement du tracé…');
  try{
   const strokes=await data();if(ticket!==turn)return;
   if(!strokes[character])throw Error('Le tracé de ce caractère est indisponible.');
   const size=Math.min(280,el('writePad').parentElement.clientWidth);
   if(!writer)writer=HanziWriter.create('writePad',character,{
    width:size,height:size,padding:18,showCharacter:false,showOutline:false,
    strokeColor:'#263b35',outlineColor:'#d7ded6',highlightColor:'#3d866f',drawingColor:'#245f4e',
    strokeAnimationSpeed:1,delayBetweenStrokes:260,highlightOnComplete:false,
    charDataLoader:c=>strokes[c]
   });
   // setCharacter cancels previous animations/quizzes before reusing the same SVG and listeners.
   await writer.setCharacter(character);if(ticket!==turn)return;
   await writer.updateDimensions({width:size,height:size,padding:18});
   if(guided)await writer.showOutline({duration:0});else await writer.hideOutline({duration:0});
   if(ticket!==turn)return;
   navigation();
   if(action==='animate'){
    status('Observe le sens et l’ordre des traits. Puis choisis « Me guider ».');
    await writer.animateCharacter();
    if(ticket===turn)status('À toi : choisis « Me guider » ou « Sans modèle ».');
    return;
   }
   done.delete(index);navigation();
   status(guided?'Suis le trait vert, dans le même sens.':'Trace de mémoire, trait par trait. « Me guider » affiche un modèle.');
   await writer.quiz({showHintAfterMisses:guided?1:2,
    onCorrectStroke:result=>{
     if(ticket!==turn)return;
     status(`Trait ${result.strokeNum+1} / ${strokes[character].strokes.length} réussi.`);
     if(guided&&result.strokesRemaining>0)void writer.highlightStroke(result.strokeNum+1);
    },
    onMistake:result=>{if(ticket===turn)status(`Trait ${result.strokeNum+1} : essaie encore. Respecte sa forme, son sens et l’ordre.`);},
    onComplete:result=>{
     if(ticket!==turn)return;
     done.add(index);navigation();
     status((done.size===chars().length?'Mot terminé !':'Caractère terminé !')+` ${result.totalMistakes} erreur${result.totalMistakes>1?'s':''}. `+(guided?'Essaie maintenant sans modèle.':index<chars().length-1?'Passe au caractère suivant.':'Révèle la réponse, puis évalue ton rappel.'));
    }
   });
   if(ticket===turn&&guided)void writer.highlightStroke(0);
  }catch(error){if(ticket===turn)status(error.message||'Tracé indisponible. Réessaie.');}
  finally{if(ticket===turn)controls.forEach(id=>el(id).disabled=false);}
 }
 function open(word,newKey,withModel=false){
  el('writing').hidden=false;
  if(key===newKey)return;
  card=word;key=newKey;index=0;guided=withModel;done=new Set();navigation();void exercise();
 }
 function update(word,enabled,newKey){if(enabled)open(word,newKey);else hide();}
 document.addEventListener('DOMContentLoaded',()=>{
  el('writeAnimate').onclick=()=>exercise('animate');
  el('writeGuide').onclick=()=>{guided=true;void exercise();};
  el('writeMemory').onclick=()=>{guided=false;void exercise();};
  el('writeRestart').onclick=()=>exercise();
  el('writePrevious').onclick=()=>{if(index>0){index--;void exercise();}};
  el('writeNext').onclick=()=>{if(index<chars().length-1){index++;void exercise();}};
 });
 return {update,open,hide};
})();
