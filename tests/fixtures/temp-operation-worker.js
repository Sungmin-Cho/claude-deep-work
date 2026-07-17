'use strict';

const { createOwnedTemp, writeOwnedTemp, removeOwnedTemp } = require('../../runtime/artifact-runtime.js');

process.on('message', async (message) => {
  try {
    let result;
    if (message.verb === 'create') result = await createOwnedTemp(message.args);
    else if (message.verb === 'write') result = await writeOwnedTemp(message.args, message.bytes);
    else if (message.verb === 'remove') result = await removeOwnedTemp(message.args);
    else throw new Error('unknown-temp-worker-verb');
    process.send?.({ok:true,result});
  } catch (error) { process.send?.({ok:false,error:{code:error.code,message:error.message}}); }
});
