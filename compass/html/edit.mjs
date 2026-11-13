// One policy for the lazy browser editor and server-side save/publication checks.
// Parsing is not sanitization: only this deliberately inert subset is accepted.
import { parse, serialize } from 'parse5'
import * as css from 'css-tree'

export const MAX_EDIT_HTML = 160000
const HTML = 'http://www.w3.org/1999/xhtml'
const SVG = 'http://www.w3.org/2000/svg'
const TAGS = new Set('html head title meta style body main header footer nav section article aside div span p h1 h2 h3 h4 h5 h6 a b strong i em s small sub sup mark code pre blockquote cite q ul ol li dl dt dd figure figcaption details summary fieldset legend label input select option optgroup textarea button table caption thead tbody tfoot tr th td colgroup col br hr wbr time address'.split(' '))
const SVG_TAGS = new Set(['svg','path','rect','circle','ellipse','line','polyline','polygon','g','title','desc'])
const ATTRS = new Set('id class title role tabindex lang dir hidden inert style data-new data-theme data-version data-profile data-font data-density data-mobile name type value placeholder disabled readonly required checked selected multiple open rows cols min max step minlength maxlength pattern autocomplete for scope colspan rowspan span width height datetime'.split(' '))
const SVG_ATTRS = new Set('viewBox d x y x1 x2 y1 y2 cx cy r rx ry points width height fill stroke stroke-width stroke-linecap stroke-linejoin stroke-dasharray stroke-dashoffset opacity fill-opacity stroke-opacity transform vector-effect focusable aria-hidden role class'.split(' '))
const FUNCTIONS = new Set('var calc min max clamp rgb rgba hsl hsla hwb lab lch oklab oklch color color-mix light-dark linear-gradient radial-gradient conic-gradient repeating-linear-gradient repeating-radial-gradient repeating-conic-gradient cubic-bezier steps translate translatex translatey translatez translate3d scale scalex scaley scalez scale3d rotate rotatex rotatey rotatez rotate3d skew skewx skewy matrix matrix3d perspective blur brightness contrast grayscale hue-rotate invert opacity saturate sepia drop-shadow inset circle ellipse polygon path fit-content repeat minmax counter counters attr env round mod rem abs sign pow sqrt hypot log exp sin cos tan asin acos atan atan2'.split(' '))
const AT_RULES = new Set(['media','supports','keyframes','-webkit-keyframes','container','layer','starting-style'])
const fail = message => { const e = new Error(message); e.code='unsafe_document'; throw e }

export function validateCss(value, context = 'stylesheet') {
  if (typeof value !== 'string' || value.length > 120000 || /[\\<\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]|https?:|(?:javascript|vbscript|data):|url\s*\(|image-set\s*\(|expression\s*\(|-moz-binding|(?:^|[;{])\s*behavior\s*:/i.test(value)) fail('CSS can use local styles only. Remove links, imports and escaped values.')
  let ast
  try { ast=css.parse(value,{context,parseCustomProperty:true,onParseError:error=>{throw error}}) }
  catch { fail('Check the CSS syntax. The last preview has been kept.') }
  let count=0
  css.walk(ast,node=>{
    if (++count > 30000) fail('Simplify this stylesheet before applying it.')
    if (node.type==='Raw' || node.type==='Url') fail('This CSS construct is not supported.')
    if (node.type==='Atrule' && !AT_RULES.has(node.name.toLowerCase())) fail('Only local media, container, support, layer and keyframe rules are supported.')
    if (node.type==='Function' && !FUNCTIONS.has(node.name.toLowerCase())) fail('This CSS function is not supported: '+node.name)
    if (node.type==='Declaration' && (!/^(?:--|-)?[a-zA-Z][a-zA-Z0-9-]{0,100}$/.test(node.property) || /^(?:behavior|-moz-binding)$/i.test(node.property))) fail('This CSS property is not supported.')
  })
  return ast
}

function checkedTree(value) {
  if (typeof value!=='string' || value.length>MAX_EDIT_HTML || !/^<!doctype html>/i.test(value.trim()) || /\u0000/.test(value)) fail('Use a complete HTML document, up to 160,000 characters.')
  let tree
  try { tree=parse(value,{scriptingEnabled:true}) } catch { fail('This HTML could not be parsed. The last preview has been kept.') }
  const stack=[{node:tree,depth:0}];let count=0
  while(stack.length){
    const {node,depth}=stack.pop()
    if (++count>16000 || depth>80) fail('Simplify this document before applying it.')
    if (node.tagName) {
      const tag=node.tagName,svg=node.namespaceURI===SVG
      if (!(svg ? SVG_TAGS.has(tag) : node.namespaceURI===HTML && TAGS.has(tag))) fail('Unsupported element: <'+tag+'>. Scripts and embedded documents are disabled.')
      for(const attr of node.attrs || []) {
        const name=attr.name,v=attr.value
        if(attr.namespace || attr.prefix || /^on/i.test(name) || name.length>100 || v.length>24000) fail('Unsupported attribute on <'+tag+'>.')
        if(name==='style'){validateCss(v,'declarationList');continue}
        if(name==='href' && tag==='a') {if(!/^#[A-Za-z][A-Za-z0-9_-]*$/.test(v))fail('Links must point to a section in this document.');continue}
        if(tag==='meta') {
          if(name==='charset' && /^utf-8$/i.test(v))continue
          if(name==='name' && ['viewport','description','color-scheme'].includes(v.toLowerCase()))continue
          if(name==='content' && !/[<>\u0000-\u001f]/.test(v))continue
          fail('Only charset, viewport, description and color-scheme metadata are supported.')
        }
        if(svg) {
          if(!SVG_ATTRS.has(name))fail('Unsupported SVG attribute: '+name)
          if(/(?:[\\<>&]|url\s*\(|https?:|javascript:|data:)/i.test(v))fail('SVG must contain local vector shapes only.')
          continue
        }
        if(!ATTRS.has(name) && !/^aria-[a-z-]{1,50}$/.test(name))fail('Unsupported attribute: '+name)
        if(name==='type' && tag==='button' && v!=='button') fail('Preview buttons must use type="button".')
      }
      if(tag==='style')validateCss((node.childNodes || []).map(n=>n.value || '').join(''))
      if(tag==='meta') {
        const attrs=Object.fromEntries(node.attrs.map(a=>[a.name,a.value]))
        if(!attrs.charset && !['viewport','description','color-scheme'].includes(attrs.name?.toLowerCase()))fail('Unsupported metadata.')
      }
    }
    for(const child of node.childNodes || [])stack.push({node:child,depth:depth+1})
  }
  return tree
}

export function validateEditableHtml(value) {
  try {
    const html=serialize(checkedTree(value)).replace(/ data-new(?=[\s=>])/g,'')
    // Serialization must remain inside the same policy on a second HTML parse.
    checkedTree(html)
    return {ok:true,html}
  } catch(error) { return {ok:false,error:error.code==='unsafe_document'?error.message:'This document is not supported. The last preview has been kept.'} }
}

const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b)
function mergeValue(base,edited,next,path='document') {
  if(same(base,edited))return structuredClone(next)
  if(same(base,next) || same(edited,next))return structuredClone(edited)
  if(base && edited && next && typeof base==='object' && typeof edited==='object' && typeof next==='object') {
    if(Array.isArray(base) || Array.isArray(edited) || Array.isArray(next)) {
      if(![base,edited,next].every(Array.isArray) || base.length!==edited.length || base.length!==next.length)fail('Code and chat changed the same structure. Previous preview kept; restore a revision or adjust the code first.')
      return base.map((value,i)=>mergeValue(value,edited[i],next[i],path+'.'+i))
    }
    const out={}
    for(const key of new Set([...Object.keys(base),...Object.keys(edited),...Object.keys(next)]))out[key]=mergeValue(base[key],edited[key],next[key],path+'.'+key)
    return out
  }
  fail('Code and chat changed the same content. Previous preview kept; restore a revision or adjust the code first.')
}
function comparable(node,parent='') {
  const out={nodeName:node.nodeName}
  if(node.tagName){out.tagName=node.tagName;out.namespaceURI=node.namespaceURI;out.attrs=Object.fromEntries((node.attrs || []).map(a=>[a.name,a.value]))}
  if(node.nodeName==='#documentType'){out.name=node.name;out.publicId=node.publicId;out.systemId=node.systemId}
  if(node.nodeName==='#comment')out.data=node.data
  if(node.nodeName==='#text')out.value=parent==='style' ? css.toPlainObject(validateCss(node.value)) : node.value
  if(node.childNodes)out.childNodes=node.childNodes.map(child=>comparable(child,node.tagName))
  return out
}
function hydrate(node,parent=null) {
  const out={...node,parentNode:parent}
  if(node.attrs)out.attrs=Object.entries(node.attrs).filter(([,value])=>value!==undefined).map(([name,value])=>({name,value}))
  if(node.nodeName==='#text' && typeof node.value==='object')out.value=css.generate(css.fromPlainObject(node.value))
  if(node.childNodes)out.childNodes=node.childNodes.map(child=>hydrate(child,out))
  return out
}

// Conservative three-way merge: independent code and generated changes survive.
// Conflicting edits fail without replacing the last completed document.
export function rebaseEditedHtml({base,edited,next}) {
  try {
    const trees=[base,edited,next].map(value=>comparable(checkedTree(value)))
    const html=serialize(hydrate(mergeValue(...trees)))
    return validateEditableHtml(html)
  } catch(error){return {ok:false,error:error.code==='unsafe_document'?error.message:'Could not merge these changes. Previous preview kept.'}}
}
