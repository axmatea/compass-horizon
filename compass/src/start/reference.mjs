// Reference planning is local and declarative. It never fetches a supplied URL,
// imports another app's source, or starts a model request.
const freezeType=value=>Object.freeze({...value,features:Object.freeze(value.features.map(feature=>Object.freeze(feature))),defaultFeatures:Object.freeze(value.defaultFeatures)})
export const BUILD_TYPES=Object.freeze([
  freezeType({id:'website',label:'Website',target:'website',features:[{id:'features',label:'Services'},{id:'products',label:'Catalog'},{id:'gallery',label:'Work'},{id:'contact',label:'Contact'},{id:'faq',label:'FAQ'}],defaultFeatures:['features','gallery','contact']}),
  freezeType({id:'tracker',label:'Project tracker',target:'app',features:[{id:'title',label:'Tasks',required:true},{id:'status',label:'Status'},{id:'notes',label:'Notes'}],defaultFeatures:['title','status','notes']}),
  freezeType({id:'crm',label:'CRM',target:'app',features:[{id:'name',label:'Contacts',required:true},{id:'email',label:'Email'},{id:'company',label:'Company'},{id:'status',label:'Status'},{id:'notes',label:'Notes'}],defaultFeatures:['name','email','company','status','notes']}),
  freezeType({id:'booking',label:'Booking records',target:'app',features:[{id:'name',label:'Guests',required:true},{id:'service',label:'Service'},{id:'date',label:'Date'},{id:'status',label:'Status'},{id:'notes',label:'Notes'}],defaultFeatures:['name','service','date','status','notes']}),
  freezeType({id:'inventory',label:'Inventory',target:'app',features:[{id:'name',label:'Items',required:true},{id:'quantity',label:'Quantity'},{id:'category',label:'Category'},{id:'notes',label:'Notes'}],defaultFeatures:['name','quantity','category','notes']}),
])
export const REFERENCE_PRESETS=Object.freeze([
  {id:'notion',name:'Notion',host:'notion.so',type:'tracker',hosts:['notion.so','notion.com'],names:['notion','notion ai']},
  {id:'linear',name:'Linear',host:'linear.app',type:'tracker',hosts:['linear.app'],names:['linear']},
  {id:'hubspot',name:'HubSpot',host:'hubspot.com',type:'crm',hosts:['hubspot.com'],names:['hubspot','hubspot crm']},
  {id:'shopify',name:'Shopify',host:'shopify.com',type:'inventory',hosts:['shopify.com'],names:['shopify']},
  {id:'airbnb',name:'Airbnb',host:'airbnb.com',type:'booking',hosts:['airbnb.com'],names:['airbnb']},
].map(value=>Object.freeze({...value,hosts:Object.freeze(value.hosts),names:Object.freeze(value.names)})))

export const REFERENCE_ERRORS=Object.freeze({
  'reference-required':'Enter an app name or public website link.',
  'invalid-reference':'Use an app name or a valid public website link.',
  'private-reference':'Use a public app website, not a local or private address.',
  'unsupported-protocol':'Use an https website link.',
  'name-required':'Give your project a name.',
  'invalid-name':'Use a project name up to 60 characters, without quotes or markup.',
  'invalid-type':'Choose a supported project type.',
  'invalid-features':'Choose features from this project type.',
  'features-required':'Keep the main record field and choose at least one feature.',
  'invalid-notes':'Keep your changes to 140 characters.',
  'brief-too-long':'Shorten the project name or changes to fit this plan.',
})
const fail=error=>({ok:false,error,message:REFERENCE_ERRORS[error]})
const plain=value=>value!==null && typeof value==='object' && !Array.isArray(value)
const own=(value,key)=>plain(value) && Object.hasOwn(value,key)
const controls=/[\u0000-\u001f\u007f]/
const typeFor=id=>BUILD_TYPES.find(type=>type.id===id)
const collapse=value=>value.trim().replace(/\s+/g,' ')
const typeNames={tracker:'project tracker',crm:'CRM',booking:'booking records',inventory:'inventory'}

// Only this explicit notes segment can customize a structured plan's appearance.
// Reference and project names are data, even when they contain color words.
export function referenceAppearanceNotes(tail) {
  if(typeof tail!=='string')return ''
  const match=tail.match(/^ White, minimal design\. Changes: ([^\u0000-\u001f\u007f]{1,140})\. Reference: [^\u0000-\u001f\u007f]+\.$/)
  return match && match[1]!=='None' ? match[1] : ''
}

function canonicalReference(name,host,preset) {
  return {ok:true,value:{name:preset?.name || name,host:host || preset?.host || null,presetId:preset?.id || null,type:preset?.type || null,
    label:preset?`${preset.name} (${host || preset.host})`:name}}
}

export function normalizeReference(raw) {
  if(typeof raw!=='string' || !raw.trim())return fail('reference-required')
  if(raw.length>2048 || controls.test(raw))return fail('invalid-reference')
  const value=raw.trim()
  const protocol=/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)
  const urlLike=protocol || value.startsWith('//') || /^[^\s/]+\.[^\s/]+(?:[/?#]|$)/.test(value) || /^\[|^(?:\d+|0x[\da-f]+)$/i.test(value)
  if(urlLike) {
    let url
    try{url=new URL(protocol?value:value.startsWith('//')?'https:'+value:'https://'+value)}catch{return fail('invalid-reference')}
    if(!['https:','http:'].includes(url.protocol))return fail('unsupported-protocol')
    if(url.username || url.password || url.port)return fail('invalid-reference')
    const host=url.hostname.toLowerCase().replace(/\.$/,'').replace(/^www\./,'')
    if(!host.includes('.') || host.startsWith('[') || /^\d+(?:\.\d+)*$/.test(host)
      || /(?:^|\.)(?:localhost|local|internal|intranet|test|invalid|example|home|lan)$/.test(host))return fail('private-reference')
    if(host.length>253 || !host.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
      || !/^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/.test(host.split('.').at(-1)))return fail('invalid-reference')
    const preset=REFERENCE_PRESETS.find(item=>item.hosts.some(domain=>host===domain || host.endsWith('.'+domain)))
    // Paths, queries, hashes, ports and user information never enter a handoff.
    return canonicalReference(host,host,preset)
  }
  if(value.length>80 || /[<>\[\]{}\\/:?#@]/.test(value) || !/[\p{L}]/u.test(value))return fail('invalid-reference')
  const name=collapse(value)
  const preset=REFERENCE_PRESETS.find(item=>item.names.includes(name.toLowerCase()))
  return canonicalReference(name,null,preset)
}

function checkedReference(value) {
  if(typeof value==='string')return normalizeReference(value)
  if(!plain(value) || !own(value,'name') || typeof value.name!=='string')return fail('invalid-reference')
  if(own(value,'host') && value.host!==null) {
    if(typeof value.host!=='string' || /[/?#@:\\]/.test(value.host))return fail('invalid-reference')
    return normalizeReference('https://'+value.host)
  }
  return normalizeReference(value.name)
}

export function suggestBlueprint(reference,{defaultTarget='website'}={}) {
  const checked=checkedReference(reference)
  const type=typeFor(checked.ok && checked.value.type || (defaultTarget==='app'?'tracker':'website'))
  return {type:type.id,name:'',features:[...type.defaultFeatures],notes:''}
}

export function compileReferenceBrief(value) {
  if(!plain(value))return fail('invalid-reference')
  const checked=checkedReference(own(value,'reference')?value.reference:null)
  if(!checked.ok)return checked
  const reference=checked.value,type=typeFor(own(value,'type')?value.type:null)
  if(!type)return fail('invalid-type')
  if(typeof value.name!=='string' || !value.name.trim())return fail('name-required')
  if(value.name.length>60 || controls.test(value.name) || /["<>\\]/.test(value.name))return fail('invalid-name')
  const name=collapse(value.name)
  if(!Array.isArray(value.features) || value.features.length>type.features.length || value.features.some(id=>typeof id!=='string' || !type.features.some(feature=>feature.id===id)))return fail('invalid-features')
  const features=type.features.filter(feature=>value.features.includes(feature.id)).map(feature=>feature.id)
  if(!features.length || type.features.some(feature=>feature.required && !features.includes(feature.id)))return fail('features-required')
  if(value.notes!==undefined && (typeof value.notes!=='string' || value.notes.length>140 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value.notes)))return fail('invalid-notes')
  const notes=collapse(value.notes || '')
  const opening=type.target==='website'
    ? `Create an original website for a business called "${name}". Sections: ${features.join(', ')}.`
    : `Create an original ${typeNames[type.id]} app called "${name}". Fields: ${features.join(', ')}.`
  const prompt=`${opening} White, minimal design. Changes: ${notes || 'None'}. Reference: ${reference.label}.`
  if(prompt.length>500)return fail('brief-too-long')
  return {ok:true,prompt,preferences:{projectType:type.target==='website'?'website':'internal-tool',visualDirection:'minimal'},createPath:type.target==='website'?'/create':'/create?app=1',
    blueprint:{reference,type:type.id,name,features,notes}}
}
