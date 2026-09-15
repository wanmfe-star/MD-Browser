'use strict';
// Suppress the upstream website's one-time desktop download advertisement.
localStorage.setItem('webUseTip','1');
window.externalPublicPath='./dist/';window.takeOverApp=true;
window.mdHost=parent.mindMapPane.attach(window);
window.takeOverAppMethods={
 getMindMapData:()=>mdHost.data,saveMindMapData:data=>{try{mdHost.changed(data);}catch(error){mdHost.error('导图保存失败：'+error.message);}},
 getMindMapConfig:()=>mdHost.config,saveMindMapConfig:config=>mdHost.settings('config',config),
 getLanguage:()=> 'zh',saveLanguage:()=>{},
 getLocalConfig:()=>mdHost.local,saveLocalConfig:config=>mdHost.settings('local',config)
};
window.addEventListener('error',event=>mdHost.error('导图编辑器错误：'+event.message));
