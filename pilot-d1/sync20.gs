/**
 * Paste into the source spreadsheet's Extensions > Apps Script.
 * Project Script Properties:
 *  CLOUDFLARE_PAGES_URL = https://your-project.pages.dev
 *  D1_SYNC_TOKEN = same private secret as Cloudflare SYNC_TOKEN
 * Never expose the token in GitHub or a sheet cell.
 */
function sync20QuestionsToD1() {
 const props=PropertiesService.getScriptProperties();
 const base=(props.getProperty('CLOUDFLARE_PAGES_URL')||'').replace(/\/$/,'');
 const token=props.getProperty('D1_SYNC_TOKEN');
 if(!/^https:\/\//.test(base)||!token) throw new Error('Set CLOUDFLARE_PAGES_URL and D1_SYNC_TOKEN in Script Properties.');
 const name='問題マスター１（R7）';
 const sheet=SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
 if(!sheet) throw new Error('Required tab not found');
 const rows=sheet.getRange(1,1,21,14).getValues();
 const expected=['問題ID','学校','試験種別','実施年度','試験名・回','教科','単元','問番号','問題文（原文）','選択肢1（原文）','選択肢2（原文）','選択肢3（原文）','選択肢4（原文）','正答番号'];
 if(expected.some((v,i)=>String(rows[0][i]||'').trim()!==v)) throw new Error('Header mismatch: sync aborted to protect data');
 const questions=rows.slice(1).filter(r=>r[0]).map(r=>({
   id:String(r[0]),source_sheet:name,school:String(r[1]||''),exam_type:String(r[2]||''),
   year_label:String(r[3]||''),round_label:String(r[4]||''),subject:String(r[5]||''),unit:String(r[6]||''),
   question_number:Number(r[7]),question_text:String(r[8]||''),option1:String(r[9]||''),
   option2:String(r[10]||''),option3:String(r[11]||''),option4:String(r[12]||''),
   correct_answer:Number(r[13])
 }));
 const response=UrlFetchApp.fetch(base+'/api/admin/sync',{
   method:'post',contentType:'application/json',
   headers:{Authorization:'Bearer '+token},
   payload:JSON.stringify({questions}),muteHttpExceptions:true
 });
 if(response.getResponseCode()!==200) throw new Error(response.getResponseCode()+': '+response.getContentText());
 Logger.log(response.getContentText());
}