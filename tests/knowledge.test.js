import test from 'node:test';
import assert from 'node:assert/strict';
import {KNOWLEDGE_BASE,searchKnowledge} from '../knowledge.js';
test('knowledge base has broad domain coverage',()=>{assert.ok(KNOWLEDGE_BASE.length>=80,'knowledge count: '+KNOWLEDGE_BASE.length);assert.ok(new Set(KNOWLEDGE_BASE.map((item)=>item.category)).size>=10)});
test('retrieval finds a relevant answer to a browser JavaScript question',()=>{const item=searchKnowledge('как работает JavaScript в браузере');assert.ok(item);assert.match(item.title+' '+item.answer,/JavaScript|браузер/i)});
test('retrieval declines a query unrelated to the knowledge base',()=>assert.equal(searchKnowledge('квазар фиолетовая балалайка морской туман'),null));
