import {describe,it,expect} from 'vitest';
import {ACTS,LEVELS,createGame,applyAction,abandonPlayer,levelIndex} from '@chrono/shared';
function atExit() {const s=createGame('duo',[{id:'a',name:'A'},{id:'b',name:'B'}]);s.enemies=[];s.players[0].x=7;s.players[0].y=8;s.players[0].hand=['step1'];return applyAction(s,'a',{type:'play',card:0,target:{x:8,y:8}});}
describe('Act room graphs',()=>{
 it('contains only reachable acyclic in-Act edges and two choices at each fork',()=>{
  for(const act of ACTS){const visited=new Set<string>();const walk=(id:string,path:string[])=>{expect(path).not.toContain(id);const room=act.rooms.find(r=>r.id===id);expect(room).toBeDefined();expect(room!.next.length).toBeLessThanOrEqual(2);expect(room!.choiceDescription.length).toBeGreaterThan(10);visited.add(id);room!.next.forEach(next=>walk(next,[...path,id]));};walk(act.entry,[]);expect(visited.size).toBe(act.rooms.length);}
 });
 it('offers both routes, validates ownership and rejects fabricated or repeated choices',()=>{
  const state=atExit();expect(state.phase).toBe('choosing');expect(state.roomChoices).toEqual(['cinder','archive']);
  expect(()=>applyAction(state,'b',{type:'choose-room',roomId:'cinder'})).toThrow('turn');expect(()=>applyAction(state,'a',{type:'choose-room',roomId:'sanctum'})).toThrow('offered');
  for(const id of state.roomChoices){const next=applyAction(state,'a',{type:'choose-room',roomId:id});expect(next.level).toBe(levelIndex(id));expect(next.visitedRooms).toEqual(['threshold',id]);expect(()=>applyAction(next,'a',{type:'choose-room',roomId:id})).toThrow();}
 });
 it('hands off an abandoned chooser without an extra enemy round',()=>{const state=atExit();const next=abandonPlayer(state,'a');expect(next.phase).toBe('choosing');expect(next.round).toBe(state.round);expect(next.active).toBe(1);expect(applyAction(next,'b',{type:'choose-room',roomId:next.roomChoices[0]}).phase).toBe('playing');});
 it('crosses Acts through their declared entry, not the adjacent array index',()=>{const s=createGame('solo',[{id:'a',name:'A'}]);s.level=levelIndex(ACTS[0].rooms.at(-1)!.id);s.enemies=[];const room=LEVELS[s.level];const y=room.tiles.findIndex(row=>row.includes('E'));const x=room.tiles[y].indexOf('E');s.players[0].x=x-1;s.players[0].y=y;s.players[0].hand=['step1'];expect(applyAction(s,'a',{type:'play',card:0,target:{x,y}}).level).toBe(levelIndex(ACTS[1].entry));});
});
