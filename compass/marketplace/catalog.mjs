// Original COMPASS templates. Commerce is deliberately unavailable until prices
// and payment activation are approved; preview access implies no purchase.
const entries = [
  {id:'atlas',name:'Atlas',kind:'website',category:'Architecture',formats:['website'],description:'A quiet portfolio for architecture, spaces and considered work.',accent:'#b49a7d',features:['Project gallery','Studio profile','Contact section']},
  {id:'forma',name:'Forma',kind:'website',category:'Creative agency',formats:['website'],description:'A sharp, expressive home for a creative studio.',accent:'#3456ef',features:['Selected work','Services','Contact section']},
  {id:'mono',name:'Mono',kind:'website',category:'Software',formats:['website'],description:'A clear product story for a modern software team.',accent:'#6366ed',features:['Product overview','Feature sections','Contact section']},
  {id:'pulse',name:'Pulse',kind:'mobile',category:'Habits',formats:['mobile-web','ios-android'],description:'A calmer place to build a daily rhythm.',accent:'#73866b',features:['Habit tracking','Daily progress','Add habits']},
  {id:'field',name:'Field',kind:'mobile',category:'Tasks',formats:['mobile-web','ios-android'],description:'A focused task list that makes space for the work.',accent:'#526cea',features:['Task list','Completion filters','Add tasks']},
  {id:'venue',name:'Venue',kind:'mobile',category:'Booking',formats:['mobile-web','ios-android'],description:'A simple appointment selection and review experience.',accent:'#9d715a',features:['Service selection','Day and time selection','Local selection review']},
];

export const TEMPLATE_CATALOG=Object.freeze(entries.map(entry=>Object.freeze({...entry,formats:Object.freeze(entry.formats),features:Object.freeze(entry.features),price:null,purchaseEnabled:false})));

export function getTemplate(id) {
  return typeof id==='string' ? TEMPLATE_CATALOG.find(template=>template.id===id) || null : null;
}

export function filterTemplates({kind,query=''}={}) {
  if(kind!==undefined && kind!=='all' && kind!=='website' && kind!=='mobile')return [];
  if(typeof query!=='string')return [];
  const term=query.trim().slice(0,120).toLocaleLowerCase('en');
  return TEMPLATE_CATALOG.filter(template=>(!kind || kind==='all' || template.kind===kind) && (!term || [template.name,template.category,template.description,...template.features].join(' ').toLocaleLowerCase('en').includes(term)));
}
