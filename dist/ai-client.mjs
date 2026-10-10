export async function requestGuide(payload,{signal,fetchFn=fetch}={}){
 const response=await fetchFn('/api/guide',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal});
 let data;
 try{data=await response.json()}catch(error){
  if(error.name==='AbortError')throw error;
  throw new Error(response.status===413?'Фото слишком большое для сервера. Попробуйте уменьшить его.':'Сервер вернул неожиданный ответ. Попробуйте позже.');
 }
 if(!response.ok)throw new Error(data.error||'Не удалось получить ответ.');
 return data;
}
