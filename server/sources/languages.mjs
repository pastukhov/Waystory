// Validate an edition identifier, never an arbitrary host. Missing editions
// return an ordinary source failure; they cannot escape Wikimedia API domains.
export const validEdition=value=>typeof value==='string'&&!['und','mul','zxx'].includes(value)&&/^[a-z]{2,3}(?:-[a-z]{2,12})?$/.test(value);
export function selectSourceLanguages(context,{outputLanguage='ru',max=3}={}){return [...new Set([...(context.languages||[]),outputLanguage,'en'].filter(validEdition))].slice(0,max)}
