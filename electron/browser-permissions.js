'use strict';
function canWriteClipboard(contents,permission,requestURL){
  if(permission!=='clipboard-sanitized-write'||!contents||contents.isDestroyed())return false;
  try{
    const page=new URL(contents.getURL()),request=new URL(requestURL);
    const secure=page.protocol==='https:'||(page.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(page.hostname));
    return secure&&request.origin===page.origin;
  }catch{return false;}
}
function configureBrowserPermissions(session){
  session.setPermissionCheckHandler((contents,permission,origin)=>canWriteClipboard(contents,permission,origin));
  session.setPermissionRequestHandler((contents,permission,callback,details)=>callback(canWriteClipboard(contents,permission,details?.requestingUrl)));
}
module.exports={configureBrowserPermissions,canWriteClipboard};
