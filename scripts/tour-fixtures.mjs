import {runTourFixtures} from '../server/tours/fixtures.mjs';
export {runTourFixtures};
if(process.argv[1]?.endsWith('/tour-fixtures.mjs')){if(!await runTourFixtures({report:r=>console.log(JSON.stringify(r))}))process.exitCode=1}
