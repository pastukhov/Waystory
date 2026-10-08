import {loadEnvFile} from 'node:process';

// Node preserves variables already supplied by the parent process or container.
export function loadEnvironment(file='.env') {
  try { loadEnvFile(file); }
  catch(error) { if(error.code!=='ENOENT') throw error; }
}

export function serverAddress(env=process.env) {
  const value=env.PORT??'5173';
  if(!/^\d+$/.test(value)||Number(value)<1||Number(value)>65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  return {host:env.HOST||'127.0.0.1',port:Number(value)};
}
