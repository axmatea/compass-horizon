/** Voice adapter contract: speak(text, { onState(state, detail) }), stop().
 * States: preparing | speaking | ended | unavailable | stopped.
 * Browser speech synthesis only. A future real voice adapter must preserve this
 * contract and add its own explicit consent/authentication flow outside this demo.
 * No microphone, credentials, backend or remote AI calls are implemented here.
 */
export function createVoiceAdapter() {
 let token=0, utterance=null, timer=null, callback=null;
 const supported=()=> 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
 function stop(){token++;clearTimeout(timer);timer=null;if(supported())window.speechSynthesis.cancel();utterance=null;callback?.('stopped');callback=null;}
 function speak(text,{onState=()=>{}}={}) {
  stop();callback=onState;const id=token;
  if(!supported()){callback('unavailable','Browser voice unavailable. Read the greeting in Speaker notes.');return;}
  const speech=new SpeechSynthesisUtterance(text);utterance=speech;speech.lang='en-US';speech.rate=.92;
  const voices=window.speechSynthesis.getVoices().filter(v=>/^en[-_]/i.test(v.lang));
  speech.voice=voices.find(v=>v.localService&&/Samantha|Ava|Allison|Victoria|Serena|Karen|Moira|Fiona|Susan|Zira|Aria|Jenny/i.test(v.name))||voices.find(v=>v.localService)||voices[0]||null;
  let started=false;callback('preparing');
  const finish=(state,detail)=>{if(id!==token)return;clearTimeout(timer);timer=null;utterance=null;callback?.(state,detail);};
  speech.onstart=()=>{if(id!==token)return;started=true;clearTimeout(timer);callback?.('speaking');};
  speech.onend=()=>finish('ended');speech.onerror=()=>finish('unavailable','Browser voice could not play. Read the greeting in Speaker notes.');
  timer=setTimeout(()=>{if(id!==token||started)return;const cb=callback;token++;window.speechSynthesis.cancel();utterance=null;callback=null;cb?.('unavailable','Browser voice did not start. Continue with the story or read Speaker notes.');},6000);
  try{window.speechSynthesis.speak(speech);}catch{finish('unavailable','Browser voice unavailable. Read the greeting in Speaker notes.');}
 }
 return Object.freeze({speak,stop,supported});
}
