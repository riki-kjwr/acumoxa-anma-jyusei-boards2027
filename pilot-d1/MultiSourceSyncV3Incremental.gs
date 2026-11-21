/**
 * V3 resumable / non-destructive Google Sheets -> Cloudflare D1 synchronizer.
 * ADD AS A NEW FILE to Apps Script; it does not replace legacy code.
 *
 * Functions:
 *   previewMultiSourceV3Auto()      : read-only tab discovery
 *   syncMultiSourceV3Incremental()  : resumes a bounded sweep; rerun to finish
 *
 * Never deletes D1 rows or edits source sheets. A full sweep is triggered only
 * if a source Spreadsheet has changed since its previous completed sweep.
 * D1 ignores identical upserts. Existing row edits are detected by rescanning
 * that modified Spreadsheet; this is NOT a row-level change journal.
 */
const D1_V3_AUTO_REGISTRY = [
  {key:'ONIKI_GRAD', format:'grad', id:'1Bhd-2leIdMHywC0nWPqmhSq7FVLB8_OvvP5fIl2fwgE'},
  {key:'ONIKI_TERM3', format:'term', id:'1ITqgsWSnv9hrzPxoOHwnPisLvCCvEfb98iq6crnwZGI'},
  {key:'ONIKI_CLASS', format:'class', id:'11DB9yg4Dy9exhvAAKqv9GCXDpXTd8eff64JAk5HVN00'}
];
const D1_V3_AUTO_REQUIRED = {
  grad:['問題ID','学校','試験種別','実施年度','試験名・回','教科','問番号','問題文（原文）','選択肢1（原文）','選択肢2（原文）','選択肢3（原文）','選択肢4（原文）','正答番号'],
  term:['問題ID','年度','学期','担当','問番号','問題文','選択肢1','選択肢2','選択肢3','選択肢4','暫定正答','レビュー状況'],
  class:['問題ID','テスト回','問題番号','分野','問題文（原文）','選択肢1','選択肢2','選択肢3','選択肢4','選択肢5','正答（原文）','照合状態']
};
const D1_V3_AUTO_ROWS_PER_RUN = 2000;
const D1_V3_AUTO_CHUNK_ROWS = 100;
const D1_V3_AUTO_MAX_RUN_MS = 210000;

function previewMultiSourceV3Auto() {
  D1_V3_AUTO_REGISTRY.forEach(function(src) {
    const book = SpreadsheetApp.openById(src.id);
    book.getSheets().forEach(function(sheet) {
      const headers = v3AutoHeaders_(sheet);
      const supported = v3AutoIsQuestionTab_(src, headers);
      Logger.log(JSON.stringify({
        source:src.key, gid:sheet.getSheetId(), tab:sheet.getName(),
        rows:Math.max(0,sheet.getLastRow()-1),
        status:supported?'対象（ヘッダー一致）':'対象外（問題形式ではない）'
      }));
    });
  });
  Logger.log('プレビューのみ。SpreadsheetとD1への書き込みはありません。');
}

function syncMultiSourceV3Incremental() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error('別のV3同期が実行中です。');
  try {
    const props = PropertiesService.getScriptProperties();
    const url = (props.getProperty('CLOUDFLARE_PAGES_URL')||'').replace(/\/+$/,'');
    const token = props.getProperty('D1_SYNC_TOKEN');
    if (!/^https:\/\//.test(url) || !token) {
      throw new Error('CLOUDFLARE_PAGES_URL / D1_SYNC_TOKEN をスクリプトプロパティに設定してください。');
    }

    const started = Date.now();
    let processed = 0, eligible = 0, written = 0, skipped = 0, apiCalls = 0;
    let interrupted = false;
    for (const src of D1_V3_AUTO_REGISTRY) {
      if (interrupted) break;
      const root = 'D1_V3_AUTO_' + src.key + '_';
      const file = DriveApp.getFileById(src.id);
      const stamp = String(file.getLastUpdated().getTime());
      if (props.getProperty(root+'DONE_STAMP') === stamp) {
        Logger.log(src.key + '：元ファイルに変更なし、同期をスキップ');
        continue;
      }
      const book = SpreadsheetApp.openById(src.id);
      const tabs = book.getSheets().map(function(sheet) {
        return {sheet:sheet, headers:v3AutoHeaders_(sheet)};
      }).filter(function(item) {return v3AutoIsQuestionTab_(src,item.headers);});
      if (tabs.length === 0) {
        Logger.log(src.key + '：対象となる問題タブなし。完了扱いにはしません。');
        continue;
      }
      // A sheet modification during a previous run will be caught by the next
      // complete sweep; never claim the old sweep is complete for a new stamp.
      const initialStamp = props.getProperty(root+'START_STAMP');
      if (!initialStamp) props.setProperty(root+'START_STAMP',stamp);
      let allDone = true;
      for (const item of tabs) {
        const sheet = item.sheet, gid = sheet.getSheetId();
        const cursorKey = root+'ROW_'+gid;
        const last = sheet.getLastRow();
        let rowNumber = Number(props.getProperty(cursorKey) || 2);
        if (!Number.isSafeInteger(rowNumber) || rowNumber < 2) rowNumber = 2;
        if (rowNumber > last) continue;
        while (rowNumber <= last) {
          if (processed >= D1_V3_AUTO_ROWS_PER_RUN ||
              Date.now()-started >= D1_V3_AUTO_MAX_RUN_MS) {
            allDone = false;
            interrupted = true;
            break;
          }
          const take = Math.min(D1_V3_AUTO_CHUNK_ROWS, last-rowNumber+1,
                                D1_V3_AUTO_ROWS_PER_RUN-processed);
          const width = Math.max.apply(null,Object.values(item.headers)) + 1;
          const rows = sheet.getRange(rowNumber,1,take,width).getValues();
          const batch = [];
          rows.forEach(function(row) {
            const get = function(label) {
              const index = item.headers[label];
              return index === undefined ? '' : String(row[index] == null ? '' : row[index]).trim();
            };
            if (!get('問題ID')) return;
            const mapped = v3AutoMap_(src,sheet,get);
            if (mapped) batch.push(mapped);
            else skipped++;
          });
          // Never checkpoint a chunk until EVERY API write has succeeded.
          for(let i=0;i<batch.length;i+=20) {
            const questions=batch.slice(i,i+20);
            const response=UrlFetchApp.fetch(url+'/api/v3/admin/sync',{
              method:'post',contentType:'application/json',
              headers:{Authorization:'Bearer '+token},
              payload:JSON.stringify({questions:questions}),muteHttpExceptions:true
            });
            const body=response.getContentText();
            if(response.getResponseCode()!==200) {
              throw new Error(src.key+' gid='+gid+' row='+rowNumber+
                              ' HTTP '+response.getResponseCode()+' '+body.slice(0,500));
            }
            const result=JSON.parse(body);
            if (!result.ok || result.upserted !== questions.length) {
              throw new Error('APIの登録件数が一致しません: '+body.slice(0,500));
            }
            eligible+=questions.length;
            written+=Number(result.written==null ? result.upserted : result.written);
            apiCalls++;
          }
          rowNumber+=take;
          processed+=take;
          props.setProperty(cursorKey,String(rowNumber));
        }
        if (rowNumber <= last) allDone = false;
        if (interrupted) break;
      }
      if (!allDone) continue;
      // If editors changed the file while scanning, do another sweep next time.
      const finishedStamp = String(DriveApp.getFileById(src.id).getLastUpdated().getTime());
      if (finishedStamp === (props.getProperty(root+'START_STAMP')||stamp)) {
        props.setProperty(root+'DONE_STAMP',finishedStamp);
        Logger.log(src.key + '：全対象タブの同期完了');
      } else {
        Logger.log(src.key + '：同期中の変更を検出。次回もう一周確認します。');
        props.deleteProperty(root+'DONE_STAMP');
      }
      tabs.forEach(function(item) {props.deleteProperty(root+'ROW_'+item.sheet.getSheetId());});
      props.deleteProperty(root+'START_STAMP');
    }
    Logger.log(JSON.stringify({processedRows:processed,eligible:eligible,
      dbWrites:written,skipped:skipped,apiCalls:apiCalls,
      moreWorkMayRemain:interrupted}));
  } finally {
    lock.releaseLock();
  }
}

function v3AutoHeaders_(sheet) {
  if (!sheet.getLastRow() || !sheet.getLastColumn()) return {};
  const first=sheet.getRange(1,1,1,Math.min(60,sheet.getLastColumn())).getDisplayValues()[0];
  const headers={};
  first.forEach(function(v,i) {
    const label=String(v||'').trim();
    if(label && !Object.prototype.hasOwnProperty.call(headers,label)) headers[label]=i;
  });
  return headers;
}
function v3AutoIsQuestionTab_(src,headers) {
  return D1_V3_AUTO_REQUIRED[src.format].every(function(label) {
    return Object.prototype.hasOwnProperty.call(headers,label);
  });
}
function v3AutoSubject_(src,name) {
  if(src.format==='grad') return '';
  if (/^解剖/.test(name)) return '解剖学';
  if (/^生理/.test(name)) return '生理学';
  if (/^(臨各|臨床医学各論)/.test(name)) return '臨床医学各論';
  if (/^(経穴|経絡経穴)/.test(name)) return '経絡経穴概論';
  if (/^(東臨|東洋医学臨床)/.test(name)) return '東洋医学臨床論';
  return name;
}
function v3AutoVerified_(status) {
  if (/(未確認|未照合|要確認|要再確認|再確認|照合待ち|確認待ち|不明|暫定|仮|保留)/.test(status)) return false;
  return /(照合|確認|確定)/.test(status);
}
function v3AutoMap_(src,sheet,get) {
  const rawId=get('問題ID');
  const gid=sheet.getSheetId();
  const q={
    id:src.format==='grad'?rawId:
      (src.format==='term'?'ONIKI_TERM::':'ONIKI_CLASS::')+rawId,
    source_key:src.key,spreadsheet_id:src.id,sheet_gid:gid,
    sheet_name:sheet.getName(),school:'鬼木学園',
    exam_type:'',year_label:'',round_label:'',
    subject:v3AutoSubject_(src,sheet.getName()),unit:'',question_number:null,
    question_text:'',option1:'',option2:'',option3:'',option4:'',option5:'',
    option_count:4,correct_answer:0,answer_status:''
  };
  let fields, answer;
  if (src.format==='grad') {
    q.school=get('学校');q.exam_type=get('試験種別');
    q.year_label=get('実施年度');q.round_label=get('試験名・回');
    q.subject=get('教科');q.unit=get('単元');
    q.question_number=Number(get('問番号'));q.question_text=get('問題文（原文）');
    fields=['選択肢1（原文）','選択肢2（原文）','選択肢3（原文）','選択肢4（原文）'];
    answer=get('正答番号');q.answer_status='正答番号';
  } else if (src.format==='term') {
    q.exam_type='3年生期末過去問';
    q.year_label=get('年度');q.round_label=get('学期');
    q.unit=get('担当');q.question_number=Number(get('問番号'));
    q.question_text=get('問題文');
    fields=['選択肢1','選択肢2','選択肢3','選択肢4'];
    answer=get('暫定正答');q.answer_status=get('レビュー状況');
    if(!v3AutoVerified_(q.answer_status)) return null;
  } else {
    q.exam_type='授業プリント問題集';
    q.round_label=get('テスト回');q.unit=get('分野');
    q.question_number=Number(get('問題番号'));
    q.question_text=get('問題文（原文）');
    fields=['選択肢1','選択肢2','選択肢3','選択肢4','選択肢5'];
    answer=get('正答番号')||get('正答（原文）');
    q.answer_status=get('照合状態');
    if(!v3AutoVerified_(q.answer_status)) return null;
  }
  const choices=fields.map(get);
  if(!q.question_text || choices.slice(0,4).some(function(s){return !s;})) return null;
  const count=choices[4]?5:4;
  const match=String(answer||'').normalize('NFKC').trim().match(/^([1-5])(?:\D|$)/);
  const correct=match?Number(match[1]):0;
  if(!correct || correct>count) return null;
  for(let i=1;i<=5;i++)q['option'+i]=choices[i-1]||'';
  q.option_count=count;q.correct_answer=correct;
  if(!Number.isSafeInteger(q.question_number)||q.question_number<0)q.question_number=null;
  return q;
}
