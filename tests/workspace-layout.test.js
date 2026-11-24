import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WORKSPACE_IDS,WORKSPACE_LAYOUT_KEY,normalizeWorkspaceLayout,readWorkspaceLayout,writeWorkspaceLayout,moveWorkspace} from '../src/workspace-layout.js';

test('panel layout migrates old open flags and repairs unknown, duplicate or missing keys',()=>{
  const layout=normalizeWorkspaceLayout({order:['options','bogus','options','alerts'],open:{options:true,scans:false}},{watchlists:true,scans:true});
  assert.deepEqual(layout.order,['options','alerts',...WORKSPACE_IDS.filter(key=>!['options','alerts'].includes(key))]);
  assert.equal(layout.open.options,true);
  assert.equal(layout.open.watchlists,true);
  assert.equal(layout.open.scans,false);
});
test('layout is independent of shared settings overwrites and persists reorder',()=>{
  const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  storage.setItem('market-lens-pro-settings',JSON.stringify({workspaceSections:{scans:true}}));
  const layout=readWorkspaceLayout(storage);
  layout.order=moveWorkspace(layout.order,'options','screener');
  layout.open.options=true;writeWorkspaceLayout(storage,layout);
  storage.setItem('market-lens-pro-settings',JSON.stringify({workspaceSections:{scans:false}}));
  assert.ok(values.has(WORKSPACE_LAYOUT_KEY));
  assert.deepEqual(readWorkspaceLayout(storage),layout);
  assert.equal(layout.order[0],'options');
  assert.equal(layout.open.scans,true);
  assert.deepEqual(moveWorkspace(layout.order,'options','alerts',true).at(-1),'options');
  assert.deepEqual(moveWorkspace(layout.order,'invalid','scans'),layout.order);
});
