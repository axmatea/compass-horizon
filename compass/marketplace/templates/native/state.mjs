// Original COMPASS template behavior. No services, credentials or network calls.
const FAMILIES = ['pulse','field','venue'];
export const SERVICES = Object.freeze(['Studio visit','Project consultation']);
export const SLOTS = Object.freeze(['09:00','11:30','14:00']);
const text = (value,max=80) => typeof value === 'string' ? value.trim().replace(/\s+/g,' ').slice(0,max) : '';
const result = (state,error) => ({state,...(error ? {error} : {})});
const safeId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
export function localDate(date = new Date()) {
  return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
}
export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value+'T12:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10) === value;
}
export function initialState(family) {
  if (!FAMILIES.includes(family)) throw new TypeError('Unknown template family.');
  return {schema:1,family,items:family === 'pulse'
    ? [{id:'habit_water',label:'Drink a glass of water',done:false},{id:'habit_walk',label:'Take a quiet walk',done:false},{id:'habit_read',label:'Read a few pages',done:false}]
    : family === 'field'
      ? [{id:'task_ideas',label:'Gather the first ideas',done:false,priority:'high'},{id:'task_sketch',label:'Sketch a direction',done:false,priority:'normal'},{id:'task_focus',label:'Make room to focus',done:false,priority:'normal'}]
      : [],bookings:[]};
}
export function progress(state) {
  const total = state.items.length,done = state.items.filter(item=>item.done).length;
  return {total,done,remaining:total-done,percent:total ? Math.round(done/total*100) : 0};
}
export function visibleItems(state,filter='all') {
  return state.items.filter(item=>filter === 'open' ? !item.done : filter === 'done' ? item.done : true);
}
export function availableSlots(state,date) {
  if (state.family !== 'venue' || !validDate(date)) return [];
  return SLOTS.filter(slot=>!state.bookings.some(record=>record.date === date && record.slot === slot && record.status === 'requested'));
}
// Invalid actions preserve the previous state. IDs are injectable for tests.
export function transition(state,action,{id=()=> 'record_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8)}={}) {
  if (!state || state.schema !== 1 || !FAMILIES.includes(state.family) || !Array.isArray(state.items) || !Array.isArray(state.bookings)) throw new TypeError('Invalid template state.');
  if (!action || typeof action.type !== 'string') return result(state,'Choose an action.');
  if (action.type === 'reset') return result(initialState(state.family));
  if (action.type === 'add' && state.family !== 'venue') {
    const label = text(action.label);
    if (!label) return result(state,'Add a name first.');
    const limit = state.family === 'pulse' ? 12 : 30;
    if (state.items.length >= limit) return result(state,'This starter has reached its item limit.');
    const key = id();
    if (!safeId(key) || state.items.some(item=>item.id === key)) return result(state,'Try adding this item again.');
    const item = {id:key,label,done:false,...(state.family === 'field' ? {priority:['normal','high'].includes(action.priority) ? action.priority : 'normal'} : {})};
    return result({...state,items:[...state.items,item]});
  }
  if (['toggle','remove'].includes(action.type) && state.family !== 'venue') {
    if (!state.items.some(item=>item.id === action.id)) return result(state,'That item is no longer here.');
    return result({...state,items:action.type === 'remove' ? state.items.filter(item=>item.id !== action.id)
      : state.items.map(item=>item.id === action.id ? {...item,done:!item.done} : item)});
  }
  if (action.type === 'book' && state.family === 'venue') {
    const name = text(action.name),service = text(action.service,40);
    if (!name) return result(state,'Add a guest name first.');
    if (!SERVICES.includes(service)) return result(state,'Choose a service.');
    if (!validDate(action.date)) return result(state,'Use a real date in YYYY-MM-DD format.');
    if (!availableSlots(state,action.date).includes(action.slot)) return result(state,'Choose an available time.');
    if (state.bookings.length >= 100) return result(state,'This starter supports up to 100 requests.');
    const key = id();
    if (!safeId(key) || state.bookings.some(item=>item.id === key)) return result(state,'Try adding this request again.');
    return result({...state,bookings:[...state.bookings,{id:key,name,service,date:action.date,slot:action.slot,status:'requested'}]});
  }
  if (action.type === 'cancel' && state.family === 'venue') {
    if (!state.bookings.some(record=>record.id === action.id && record.status === 'requested')) return result(state,'That request is no longer active.');
    return result({...state,bookings:state.bookings.map(record=>record.id === action.id ? {...record,status:'cancelled'} : record)});
  }
  return result(state,'This action is not supported.');
}
