'use strict';

const { resumeOperation } = require('../../runtime/operation-journal.js');

process.on('message', async (message) => {
  try {
    const result = await resumeOperation(message);
    process.send?.({ok:true,result});
  } catch (error) {
    process.send?.({ok:false,error:{code:error.code,message:error.message}});
  }
});
