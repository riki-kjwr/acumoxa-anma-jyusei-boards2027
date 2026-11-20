// Only an authorized Apps Script should call this endpoint.
// SYNC_TOKEN must be configured as a Cloudflare secret, never committed.
export async function onRequestPost({request,env}) {
 if(!env.DB||!env.SYNC_TOKEN) return reply({error:"Missing DB or SYNC_TOKEN"},503);
 const authorization=request.headers.get("Authorization")||"";
 if(!authorization.startsWith("Bearer ")||authorization.slice(7)!==env.SYNC_TOKEN)
   return reply({error:"Unauthorized"},401);
 const raw=await request.text();
 if(raw.length>120000) return reply({error:"Batch too large"},413);
 let incoming;try{incoming=JSON.parse(raw);}catch{return reply({error:"Invalid JSON"},400);}
 if(!Array.isArray(incoming.questions)||incoming.questions.length<1||incoming.questions.length>20)
   return reply({error:"Send 1–20 questions per batch"},400);
 const statements=[];
 for(const q of incoming.questions) {
   const val=k=>String(q[k]??"").trim();
   const id=val("id"),text=val("question_text"),source=val("source_sheet");
   const opts=[1,2,3,4].map(n=>val("option"+n)),correct=Number(q.correct_answer);
   if(!id||id.length>180||!source||!text||opts.some(x=>!x)||!Number.isInteger(correct)||correct<1||correct>4)
     return reply({error:"Invalid question: "+(id||"(no ID)")},400);
   const num=Number(q.question_number);
   const questionNumber=Number.isInteger(num)&&num>=0?num:null;
   const sql="INSERT INTO questions (id,source_sheet,school,exam_type,year_label,round_label,subject,unit,question_number,question_text,option1,option2,option3,option4,correct_answer,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET source_sheet=excluded.source_sheet,school=excluded.school,exam_type=excluded.exam_type,year_label=excluded.year_label,round_label=excluded.round_label,subject=excluded.subject,unit=excluded.unit,question_number=excluded.question_number,question_text=excluded.question_text,option1=excluded.option1,option2=excluded.option2,option3=excluded.option3,option4=excluded.option4,correct_answer=excluded.correct_answer,updated_at=CURRENT_TIMESTAMP";
   const values=[id,source,val("school"),val("exam_type"),val("year_label"),val("round_label"),val("subject"),val("unit"),questionNumber,text,...opts,correct];
   statements.push(env.DB.prepare(sql).bind(...values));
 }
 try{await env.DB.batch(statements);return reply({ok:true,upserted:statements.length});}
 catch(e){console.error(e);return reply({error:"Database write failed"},500);}
}
function reply(data,status=200){
 return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
}