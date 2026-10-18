// Firebase-compatible transport for the Spark client against the local emulator.
export const ref=(db,path)=>db.ref(path);
export const get=path=>path.get();
export const set=(path,value)=>path.set(value);
export const runTransaction=async(path,update)=>path.transaction(update,undefined,false);
export const onValue=(path,callback)=>{path.on('value',callback);return()=>path.off('value',callback);};
