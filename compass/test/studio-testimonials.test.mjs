import test from 'node:test';
import assert from 'node:assert/strict';
import { testimonials, visibleTestimonials } from '../src/site/testimonials.mjs';

test('the studio does not publish testimonials before approval and provenance exist', () => {
  assert.deepEqual(testimonials,[]);
  assert.deepEqual(visibleTestimonials(),[]);
  assert.deepEqual(visibleTestimonials(null),[]);
  const statement = {quote:'Approved wording.',name:'Example person',sourceUrl:'https://example.com/reference'};
  assert.deepEqual(visibleTestimonials([statement]),[]);
  assert.deepEqual(visibleTestimonials([{...statement,approved:true,sourceUrl:''}]),[]);
  for(const sourceUrl of ['javascript:alert(1)','http://example.com','https://user:password@example.com']) {
    assert.deepEqual(visibleTestimonials([{...statement,approved:true,sourceUrl}]),[]);
  }
});

test('approved sourced statements are bounded plain text for DOM rendering', () => {
  const result = visibleTestimonials([{approved:true,quote:'  Approved\n wording. ',name:' Example ',role:' Founder ',sourceUrl:'https://example.com/reference'}]);
  assert.deepEqual(result,[{quote:'Approved wording.',name:'Example',role:'Founder',sourceUrl:'https://example.com/reference'}]);
  assert.equal(visibleTestimonials([{approved:true,quote:'x'.repeat(1000),name:'Example',sourceUrl:'https://example.com'}])[0].quote.length,600);
});
