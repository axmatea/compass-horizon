import test from 'node:test'
import assert from 'node:assert/strict'
import {srcdocFragmentLinks} from '../src/site/preview-fragments.mjs'
import {previewDoc} from '../src/site/studio.mjs'
import {previewDownload} from '../src/site/preview-tools.mjs'
import {renderSite} from '../builder/render.mjs'
import {preparedCopy} from '../builder/copy.mjs'

test('preview anchors use same-document srcdoc URLs for quoted, unquoted, mixed-case and top fragments',()=>{
  const html='<a href="#contact">Contact</a><A HREF=\'#top\'>Top</A><a href=#gallery>Work</a><a href="#">Top</a><a href="  #main ">Main</a><a href="&#35;contact">Encoded</a><a href="&#x23;contact">Hex</a><a href="&num;contact">Named</a>'
  const result=srcdocFragmentLinks(html)
  assert.equal(result,'<a href="about:srcdoc#contact">Contact</a><A HREF=\'about:srcdoc#top\'>Top</A><a href=about:srcdoc#gallery>Work</a><a href="about:srcdoc#">Top</a><a href="  about:srcdoc#main ">Main</a><a href="about:srcdoc&#35;contact">Encoded</a><a href="about:srcdoc&#x23;contact">Hex</a><a href="about:srcdoc&num;contact">Named</a>')
  assert.equal(srcdocFragmentLinks(result),result,'preparing an existing preview is idempotent')
  assert.equal(srcdocFragmentLinks('<a title=it\'s href=#contact>Contact</a><a href=#top>Top</a>'),'<a title=it\'s href=about:srcdoc#contact>Contact</a><a href=about:srcdoc#top>Top</a>')
})

test('fragment preparation leaves CSS, comments, text, other attributes and real URLs byte-identical',()=>{
  const html=`<!doctype html><style>/* <a href="#contact"> */a:before{content:'<a href="#gallery">';background:url(#paint)}/* </style-not-a-tag> <a href="#contact"> */</style>
<!-- <a href="#contact"> --><script>const text='<a href="#contact">'</script><textarea><a href="#contact"></textarea><title><a href="#contact"></title>
<p>&lt;a href="#contact"&gt;</p><a data-href="#contact" title='href="#gallery"' href="https://example.com/page#contact">External</a><a href="/page#contact">Page</a><a href="mailto:hello@example.test#contact">Email</a><img src="#contact"><svg><use href="#shape"></use></svg>`
  assert.equal(srcdocFragmentLinks(html),html)
  assert.equal(srcdocFragmentLinks('<a href="&#350;contact">Decimal</a><a href="&#x230;contact">Hex</a>'),'<a href="&#350;contact">Decimal</a><a href="&#x230;contact">Hex</a>','numeric characters sharing the hash prefix are not fragments')
  const quoted='<a title="a > b" data-href="#gallery" href="#contact" aria-label="Contact">Contact</a>'
  assert.equal(srcdocFragmentLinks(quoted),quoted.replace('href="#contact"','href="about:srcdoc#contact"'))
})

test('actual renderer links are fixed only in device previews while saved and downloadable HTML keep normal fragments',()=>{
  const spec={business:'NOVA Studio',kind:'creative studio',cta:'Get in touch',sections:['gallery','features','contact']}
  const html=renderSite({spec,copy:preparedCopy(spec,['hero',...spec.sections]),version:1}),snapshot=html
  const prepared=previewDoc(html),links=[...prepared.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)].map(match=>match[1])
  assert.ok(links.length>=6);assert.ok(links.every(href=>href.startsWith('about:srcdoc#')))
  assert.equal(links.filter(href=>href==='about:srcdoc#contact').length,3,'both CTAs and Contact navigation stay in the preview')
  assert.ok(!prepared.includes('<base'));assert.ok(!prepared.includes('<script'))
  assert.equal(html,snapshot);assert.equal(previewDownload({intent:spec,version:1},{html,version:1,pending:[]}).html,html)
  assert.match(html,/href="#contact"/);assert.ok(!html.includes('about:srcdoc'))
})

test('Unicode business names before anchors preserve every actual renderer fragment',()=>{
  const spec={business:'İstanbul Studio 😀',kind:'creative studio',cta:'Get in touch',sections:['gallery','features','contact']}
  const html=renderSite({spec,copy:preparedCopy(spec,['hero',...spec.sections]),version:1})
  const original=[...html.matchAll(/<a\b[^>]*\bhref="(#[^"]*)"/g)].map(match=>match[1])
  const prepared=previewDoc(html)
  const links=[...prepared.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)].map(match=>match[1])
  assert.ok(original.length>=6)
  assert.deepEqual(links,original.map(fragment=>'about:srcdoc'+fragment))
  assert.ok(prepared.includes('İstanbul Studio 😀'))
  assert.equal(srcdocFragmentLinks('<title>İstanbul</title><a href="#contact">Contact</a>'),'<title>İstanbul</title><a href="about:srcdoc#contact">Contact</a>')
})
