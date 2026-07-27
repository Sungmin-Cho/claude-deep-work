'use strict';

const crypto=require('node:crypto');
const {canonicalJson}=require('./operation-journal.js');
const {generateUlid}=require('../hooks/scripts/envelope.js');
const {validateFinding}=require('./review-finding-runtime.js');

const DIGEST=/^[0-9a-f]{64}$/;
const COMMIT=/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const ULID=/^[0-9A-HJKMNP-TV-Z]{26}$/;
const ARTIFACT_KINDS=['code-diff','evidence-package','final-integration','plan',
  'spec'];
const INTENTS=['code-quality','executability','security','semantic',
  'verification'];
const RISKS=['low','medium','high','critical'];
const VERDICTS=['APPROVE','REQUEST_CHANGES','BLOCK'];

function fail(code='review-receipt'){const error=new Error(`[${code}]`);
  error.code=code;throw error;}
function exactKeys(value,keys){return value&&typeof value==='object'&&
  !Array.isArray(value)&&canonicalJson(Object.keys(value).sort())===
  canonicalJson([...keys].sort());}
function digest(value){return crypto.createHash('sha256')
  .update(canonicalJson(value)).digest('hex');}
function sortedUnique(values,validate,code='review-request'){
  if(!Array.isArray(values)||values.some((value)=>!validate(value)))fail(code);
  return [...new Set(values)].sort((a,b)=>Buffer.compare(Buffer.from(a),
    Buffer.from(b)));
}
function artifactRefs(values){
  if(!Array.isArray(values)||!values.length)fail('review-request');
  const rows=values.map((row)=>{
    if(!exactKeys(row,['path','sha256'])||typeof row.path!=='string'||
        !row.path||row.path.startsWith('/')||row.path.split('/').includes('..')||
        !DIGEST.test(row.sha256||''))fail('review-request');
    return{path:row.path,sha256:row.sha256};
  }).sort((a,b)=>Buffer.compare(Buffer.from(a.path),Buffer.from(b.path)));
  if(new Set(rows.map((row)=>row.path)).size!==rows.length)fail('review-request');
  return rows;
}
function artifactSetDigest(values){return digest(artifactRefs(values));}
function requestPreimage(value){const copy=structuredClone(value);
  delete copy.request_sha256;return copy;}
function compileReviewRequest({artifactKind,reviewIntent,riskClass,
  artifactRefs:artifacts,contractRefs=[],evidenceRefs=[],
  blindGroupId=null}={}){
  if(!ARTIFACT_KINDS.includes(artifactKind)||!INTENTS.includes(reviewIntent)||
      !RISKS.includes(riskClass)||
      !(blindGroupId===null||/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
        .test(blindGroupId)))fail('review-request');
  const request={schema_version:1,authority:'review-request-v1',
    artifact_kind:artifactKind,review_intent:reviewIntent,risk_class:riskClass,
    required_schema:'review-finding-v2',artifact_refs:artifactRefs(artifacts),
    contract_refs:sortedUnique(contractRefs,(value)=>typeof value==='string'&&
      /^(?:REQ|INV|FAIL)-[A-Z0-9-]{3,64}$/.test(value)),
    evidence_refs:sortedUnique(evidenceRefs,(value)=>typeof value==='string'&&
      value.length>0&&value.length<=512&&!value.startsWith('/')&&
      !value.split('/').includes('..')),blind_group_id:blindGroupId};
  request.request_sha256=digest(request);return request;
}
function validateReviewRequest(value){
  if(!exactKeys(value,['schema_version','authority','artifact_kind',
    'review_intent','risk_class','required_schema','artifact_refs',
    'contract_refs','evidence_refs','blind_group_id','request_sha256'])||
      value.schema_version!==1||value.authority!=='review-request-v1'||
      value.required_schema!=='review-finding-v2'||
      !DIGEST.test(value.request_sha256||''))fail('review-request');
  const rebuilt=compileReviewRequest({artifactKind:value.artifact_kind,
    reviewIntent:value.review_intent,riskClass:value.risk_class,
    artifactRefs:value.artifact_refs,contractRefs:value.contract_refs,
    evidenceRefs:value.evidence_refs,blindGroupId:value.blind_group_id});
  if(canonicalJson(rebuilt)!==canonicalJson(value))fail('review-request');
  return structuredClone(value);
}
function reviewer(value){
  if(!exactKeys(value,['role','provider','model','effort'])||
      !['structural','semantic','executability'].includes(value.role)||
      !['anthropic','google','openai','unknown'].includes(value.provider)||
      typeof value.model!=='string'||!value.model||
      !(value.effort===null||typeof value.effort==='string'&&value.effort))
    fail('review-receipt');
  return structuredClone(value);
}
function receiptPreimage(value){const copy=structuredClone(value);
  delete copy.receipt_sha256;return copy;}
function wrapReviewReceipt({producer='deep-work',producerVersion='unknown',
  request,reviewer:reviewerValue,findings=[],verdict,degraded=false,round=1,
  reviewedCommit,compatibilityMode='native-v1',generatedAt,runId}={}){
  const checkedRequest=validateReviewRequest(request);
  if(!['deep-review','deep-work'].includes(producer)||
      typeof producerVersion!=='string'||!producerVersion||
      !Array.isArray(findings)||findings.some((finding)=>!validateFinding(finding))||
      !VERDICTS.includes(verdict)||typeof degraded!=='boolean'||
      !Number.isSafeInteger(round)||round<1||round>2||
      !COMMIT.test(reviewedCommit||'')||
      !['native-v1','legacy-adapter'].includes(compatibilityMode))
    fail('review-receipt');
  const at=generatedAt||new Date().toISOString(),id=runId||generateUlid();
  if(!Number.isFinite(Date.parse(at))||!ULID.test(id))fail('review-receipt');
  const payload={schema_version:1,request_sha256:checkedRequest.request_sha256,
    input_artifact_sha256:artifactSetDigest(checkedRequest.artifact_refs),
    reviewer:reviewer(reviewerValue),findings:structuredClone(findings),verdict,
    degraded,round,reviewed_commit:reviewedCommit,
    compatibility_mode:compatibilityMode};
  payload.receipt_sha256=digest(payload);
  return{$schema:'https://raw.githubusercontent.com/Sungmin-Cho/claude-deep-suite/main/schemas/artifact-envelope.schema.json',
    schema_version:'1.0',envelope:{producer,producer_version:producerVersion,
      artifact_kind:'review-receipt',run_id:id,generated_at:at,
      schema:{name:'review-receipt',version:'1.0'},
      git:{head:reviewedCommit,branch:'HEAD',dirty:'unknown'},
      provenance:{source_artifacts:checkedRequest.artifact_refs.map((row)=>({
        path:row.path})),tool_versions:{node:process.version}}},
    payload};
}
function validateReviewReceiptEnvelope(value,request){
  const checkedRequest=validateReviewRequest(request);
  if(!exactKeys(value,['$schema','schema_version','envelope','payload'])||
      value.schema_version!=='1.0'||!exactKeys(value.envelope,
        ['producer','producer_version','artifact_kind','run_id','generated_at',
          'schema','git','provenance'])||
      !['deep-review','deep-work'].includes(value.envelope.producer)||
      value.envelope.artifact_kind!=='review-receipt'||
      canonicalJson(value.envelope.schema)!==
        canonicalJson({name:'review-receipt',version:'1.0'})||
      !ULID.test(value.envelope.run_id||'')||
      !Number.isFinite(Date.parse(value.envelope.generated_at||'')))
    fail('review-receipt');
  const payload=value.payload;
  if(!exactKeys(payload,['schema_version','request_sha256',
    'input_artifact_sha256','reviewer','findings','verdict','degraded','round',
    'reviewed_commit','compatibility_mode','receipt_sha256'])||
      payload.schema_version!==1||
      payload.request_sha256!==checkedRequest.request_sha256||
      payload.input_artifact_sha256!==
        artifactSetDigest(checkedRequest.artifact_refs)||
      !Array.isArray(payload.findings)||
      payload.findings.some((finding)=>!validateFinding(finding))||
      !VERDICTS.includes(payload.verdict)||
      typeof payload.degraded!=='boolean'||
      !Number.isSafeInteger(payload.round)||payload.round<1||payload.round>2||
      !COMMIT.test(payload.reviewed_commit||'')||
      value.envelope.git?.head!==payload.reviewed_commit||
      !['native-v1','legacy-adapter'].includes(payload.compatibility_mode)||
      !DIGEST.test(payload.receipt_sha256||'')||
      digest(receiptPreimage(payload))!==payload.receipt_sha256)
    fail('review-receipt');
  reviewer(payload.reviewer);return structuredClone(value);
}
function adaptLegacyReviewReceipt({request,legacy}={}){
  if(!legacy||typeof legacy!=='object'||Array.isArray(legacy))
    fail('review-receipt');
  return wrapReviewReceipt({producer:'deep-work',request,
    reviewer:{role:legacy.reviewer_role,provider:'unknown',model:legacy.model,
      effort:legacy.effort??null},findings:legacy.findings||[],
    verdict:legacy.verdict,degraded:legacy.degraded===true,
    round:legacy.round||1,reviewedCommit:legacy.reviewed_commit,
    compatibilityMode:'legacy-adapter'});
}

module.exports={artifactSetDigest,compileReviewRequest,validateReviewRequest,
  wrapReviewReceipt,validateReviewReceiptEnvelope,adaptLegacyReviewReceipt};
