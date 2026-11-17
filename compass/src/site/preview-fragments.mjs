const rawText=new Set(['style','script','textarea','title','xmp','iframe','noembed','noframes','plaintext'])
const space=value=>/[\t\n\f\r ]/.test(value)

function tagEnd(html,start) {
  let quote='',expectValue=false,unquoted=false
  for(let at=start;at<html.length;at++) {
    const char=html[at]
    if(quote){if(char===quote)quote='';continue}
    if(char==='>')return at+1
    if(unquoted){if(space(char))unquoted=false;continue}
    if(expectValue){if(space(char))continue;expectValue=false;if(char==='"' || char==="'")quote=char;else unquoted=true}
    else if(char==='=')expectValue=true
  }
  return html.length
}

function anchor(tag,nameEnd) {
  let at=nameEnd,last=0,result=''
  while(at<tag.length) {
    while(at<tag.length && space(tag[at]))at++
    if(at>=tag.length || tag[at]==='>' || tag[at]==='/')break
    const start=at
    while(at<tag.length && !space(tag[at]) && !['=','>','/'].includes(tag[at]))at++
    const name=tag.slice(start,at).toLowerCase()
    while(at<tag.length && space(tag[at]))at++
    if(tag[at]!=='='){if(at===start)at++;continue}
    at++;while(at<tag.length && space(tag[at]))at++
    const quote=tag[at]==='"' || tag[at]==="'" ? tag[at++] : ''
    const valueStart=at
    while(at<tag.length && (quote ? tag[at]!==quote : !space(tag[at]) && tag[at]!=='>'))at++
    const value=tag.slice(valueStart,at)
    // Keep the encoded fragment itself intact; only its document URL changes.
    const fragment=/^[\t\n\f\r ]*(?:#|&#0*35(?:;|(?![0-9]))|&#[xX]0*23(?:;|(?![A-Fa-f0-9]))|&num;)/.test(value)
    if(name==='href' && fragment) {
      const leading=value.match(/^[\t\n\f\r ]*/)[0].length
      const insert=valueStart+leading
      result+=tag.slice(last,insert)+'about:srcdoc';last=insert
    }
    if(quote && tag[at]===quote)at++
  }
  return result ? result+tag.slice(last) : tag
}

// A presentation transform for already validated, scriptless website previews.
// It is deliberately separate from source/export HTML and is not a sanitizer.
export function srcdocFragmentLinks(value) {
  const html=String(value??''),lower=html.toLowerCase()
  let at=0,last=0,result=''
  while(at<html.length) {
    const start=html.indexOf('<',at);if(start<0)break
    if(html.startsWith('<!--',start)){const end=html.indexOf('-->',start+4);at=end<0?html.length:end+3;continue}
    if(html.startsWith('<![CDATA[',start)){const end=html.indexOf(']]>',start+9);at=end<0?html.length:end+3;continue}
    let nameStart=start+1
    const closing=html[nameStart]==='/'
    if(closing)nameStart++
    if(!/[A-Za-z]/.test(html[nameStart]||'')){at=start+1;continue}
    let nameEnd=nameStart
    while(nameEnd<html.length && /[A-Za-z0-9:-]/.test(html[nameEnd]))nameEnd++
    const name=lower.slice(nameStart,nameEnd),end=tagEnd(html,nameEnd)
    if(!closing && name==='a') {
      const original=html.slice(start,end),rewritten=anchor(original,nameEnd-start)
      if(rewritten!==original){result+=html.slice(last,start)+rewritten;last=end}
    }
    at=end
    if(!closing && rawText.has(name)) {
      if(name==='plaintext')break
      let close=lower.indexOf('</'+name,at)
      while(close>=0 && !/[\t\n\f\r />]/.test(html[close+name.length+2]||''))close=lower.indexOf('</'+name,close+2)
      at=close<0?html.length:tagEnd(html,close+name.length+2)
    }
  }
  return result ? result+html.slice(last) : html
}
