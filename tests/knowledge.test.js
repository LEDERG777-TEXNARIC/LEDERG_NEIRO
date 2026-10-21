import test from 'node:test';
import assert from 'node:assert/strict';
import {KNOWLEDGE_BASE,searchKnowledge,searchKnowledgeMany} from '../knowledge.js';
test('knowledge base has broad domain coverage',()=>{assert.ok(KNOWLEDGE_BASE.length>=160,'knowledge count: '+KNOWLEDGE_BASE.length);assert.ok(new Set(KNOWLEDGE_BASE.map((item)=>item.category)).size>=10)});
test('retrieval finds a relevant answer to a browser JavaScript question',()=>{const item=searchKnowledge('как работает JavaScript в браузере');assert.ok(item);assert.match(item.title+' '+item.answer,/JavaScript|браузер/i)});
test('retrieval declines a query unrelated to the knowledge base',()=>assert.equal(searchKnowledge('квазар фиолетовая балалайка морской туман'),null));

test("retrieval supports short one-keyword questions",()=>{assert.match(searchKnowledge("DNS").title,/DNS/i);assert.match(searchKnowledge("JavaScript").title,/JavaScript/i)});

test("retrieval returns related cards for multi-part questions",()=>{const results=searchKnowledgeMany("нейросеть и обучение модели",3);assert.ok(results.length>=1);assert.ok(results[0].answer.length>40);assert.ok(results.every(x=>x.source.url.startsWith("https://")))});
