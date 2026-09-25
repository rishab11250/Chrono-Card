import {describe,it,expect} from 'vitest';
import {createGame,applyAction,activePlayer,abandonPlayer,CARDS,legalTargets,type CardId} from '@chrono/shared';
const party=()=>createGame('duo',[{id:'a',name:'A'},{id:'b',name:'B'}],123);
function reward(){const s=party();s.enemies=[];Object.assign(s.players[0],{x:8,y:8});return applyAction(s,'a',{type:'end'});}
describe('seeded expedition draft',()=>{
 it('offers three distinct reproducible cards per explorer and rejects forged/duplicate picks',()=>{
  const s=reward();expect(s).toEqual(reward());expect(s.phase).toBe('drafting');
  for(const offers of Object.values(s.draftChoices)){expect(new Set(offers).size).toBe(3);offers.forEach(id=>expect(CARDS[id].draft).toBe(true));}
  expect(()=>applyAction(s,'b',{type:'draft-card',cardId:s.draftChoices.b[0]})).toThrow('turn');
  expect(()=>applyAction(s,'a',{type:'draft-card',cardId:'strike_plus'})).toThrow('offered');
  const id=s.draftChoices.a[0],next=applyAction(s,'a',{type:'draft-card',cardId:id});
  expect(next.players[0].discard).toContain(id);expect(activePlayer(next).id).toBe('b');
  expect(()=>applyAction(next,'a',{type:'draft-card',cardId:id})).toThrow('turn');
  expect(applyAction(next,'b',{type:'draft-card',cardId:next.draftChoices.b[0]}).phase).toBe('choosing');
 });
 it('does not strand the draft when its chooser forfeits',()=>{const s=reward(),next=abandonPlayer(s,'a');expect(next.phase).toBe('drafting');expect(next.round).toBe(s.round);expect(activePlayer(next).id).toBe('b');expect(applyAction(next,'b',{type:'draft-card',cardId:next.draftChoices.b[0]}).phase).toBe('choosing');});
 it('preserves a move and attack in every enlarged hand',()=>{let s=party();s.enemies=[];s.players.forEach(p=>p.deck.push('mend','forge','cleave','quickshot','blink','strike_plus'));for(let i=0;i<60;i++){s=applyAction(s,activePlayer(s).id,{type:'end'});const p=activePlayer(s);for(const category of ['move','attack'])expect(p.hand.some(id=>CARDS[id].category===category)).toBe(true);}});
});
function fixture(id:CardId){const s=party();s.enemies=[];s.players[0].hand=[id];Object.assign(s.players[0],{x:3,y:3});return s;}
describe('drafted cards',()=>{
 it('forges a permanent upgrade without changing deck size',()=>{const s=fixture('forge');s.players[0].deck=['strike'];const next=applyAction(s,'a',{type:'play',card:0,target:{x:3,y:3}});expect(next.players[0].deck).toEqual(['strike_plus']);expect(s.players[0].deck).toEqual(['strike']);expect(next.players[0].discard).toContain('forge');});
 it('cleaves adjacent enemies only',()=>{const s=fixture('cleave');s.enemies=[3,4,5].map((x,i)=>({id:String(i),x,y:4,kind:'chaser' as const,hp:2,heading:0,intent:{attack:[]}}));const next=applyAction(s,'a',{type:'play',card:0,target:{x:3,y:3}});expect(next.enemies.map(e=>e.x)).toEqual([4,5]);});
 it('allows a free dart at zero plays, shares cooldown across copies, and recharges after two rounds',()=>{const s=fixture('quickshot');s.plays=0;s.enemies=[{id:'e',x:4,y:3,kind:'turret',hp:4,heading:0,intent:{attack:[]}}];expect(legalTargets(s,0)).toContainEqual({x:4,y:3});let next=applyAction(s,'a',{type:'play',card:0,target:{x:4,y:3}});expect(next.plays).toBe(0);expect(next.enemies[0].hp).toBe(3);next.players[0].hand=['quickshot'];expect(()=>applyAction(next,'a',{type:'play',card:0,target:{x:4,y:3}})).toThrow('recharging');next.round+=2;next=applyAction(next,'a',{type:'play',card:0,target:{x:4,y:3}});expect(next.enemies[0].hp).toBe(2);});
 it('heals only injured living explorers and blinks within range',()=>{const s=fixture('mend');expect(legalTargets(s,0)).toEqual([]);s.players[0].hp=5;expect(applyAction(s,'a',{type:'play',card:0,target:{x:3,y:3}}).players[0].hp).toBe(8);const b=fixture('blink');expect(applyAction(b,'a',{type:'play',card:0,target:{x:4,y:4}}).players[0]).toMatchObject({x:4,y:4});expect(()=>applyAction(b,'a',{type:'play',card:0,target:{x:7,y:3}})).toThrow();});
});
