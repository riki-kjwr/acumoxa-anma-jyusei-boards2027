export async function onRequestGet({request,env}) {
  if (!env.DB) return reply({error:"D1 database binding DB is missing"},503);
  const u=new URL(request.url);
  const n=Number(u.searchParams.get("limit")||20);
  const limit=Number.isFinite(n)?Math.max(1,Math.min(100,Math.floor(n))):20;
  const after=(u.searchParams.get("after")||"").trim();
  const subject=(u.searchParams.get("subject")||"").trim();
  const source=(u.searchParams.get("source")||"").trim();
  const where=["id > ?"],args=[after];
  if(subject){where.push("subject = ?");args.push(subject);}
  if(source){where.push("source_sheet = ?");args.push(source);}
  try {
    const sql="SELECT id,source_sheet,school,exam_type,year_label,round_label,subject,unit,question_number,question_text,option1,option2,option3,option4,correct_answer FROM questions WHERE "+where.join(" AND ")+" ORDER BY id LIMIT ?";
    const found=await env.DB.prepare(sql).bind(...args,limit).all();
    const questions=found.results||[];
    return reply({count:questions.length, next_after:questions.length?questions[questions.length-1].id:null, questions});
  } catch(e) {console.error(e);return reply({error:"Could not read questions"},500);}
}
function reply(data,status=200){
 return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
}