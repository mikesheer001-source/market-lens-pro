// Panel layout belongs to this browser, not the public shared workspace document.
export const WORKSPACE_LAYOUT_KEY='market-lens-pro-chart-workspaces-v2';
export const WORKSPACE_IDS=['screener','backtest','options','optimize','scripts','data','watchlists','scans','alerts'];
export function normalizeWorkspaceLayout(value={},legacy={}){
  const order=Array.isArray(value?.order)?value.order:[];
  return {order:[...new Set([...order.filter(key=>WORKSPACE_IDS.includes(key)),...WORKSPACE_IDS])],
    open:Object.fromEntries(WORKSPACE_IDS.map(key=>[key,Boolean(value?.open?.[key]??legacy?.[key])]))};
}
export function readWorkspaceLayout(storage){
  try{
    const legacy=JSON.parse(storage.getItem('market-lens-pro-settings')||'{}')?.workspaceSections;
    return normalizeWorkspaceLayout(JSON.parse(storage.getItem(WORKSPACE_LAYOUT_KEY)||'{}'),legacy);
  }catch{return normalizeWorkspaceLayout();}
}
export function writeWorkspaceLayout(storage,layout){
  try{storage.setItem(WORKSPACE_LAYOUT_KEY,JSON.stringify(normalizeWorkspaceLayout(layout)));}catch{}
}
export function moveWorkspace(order,source,target,after=false){
  if(source===target||!order.includes(source)||!order.includes(target))return [...order];
  const next=order.filter(key=>key!==source);
  next.splice(next.indexOf(target)+(after?1:0),0,source);
  return next;
}
