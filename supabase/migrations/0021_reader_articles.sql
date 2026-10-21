-- Optional, separately recorded permission; no existing acceptance is changed.
begin;
create table knowledge_notices (
  version text primary key, text_en text not null, text_ar text not null
);
insert into knowledge_notices values ('knowledge-v1-2026-10-21', $notice$Optional permission: research reader and articles (Version 1, 21 October 2026)

I authorize the Platform to send the approved public title and abstract of this research to Google's Gemini API under its unpaid-service terms to produce source-linked explanations, answers and Arabic or English translations, and to prepare accessible articles. This permission does not include the private document, submission contact details or unpublished material.

Google may use inputs and outputs to improve its products and machine-learning technologies, and human reviewers may examine them. The Platform cannot delete content held by Google. Google's input restrictions and terms continue to apply.

Answers may be wrong or incomplete. Articles require editorial approval and attribution to the original research. These features do not constitute peer review or professional advice. Readers' questions are also sent to Google.

I confirm that I have authority from the relevant rights holders to permit these uses. This optional permission is separate from the submission agreement. Declining it does not affect submission, document extraction or ordinary publication. I can withdraw it from this private page. Withdrawal stops new AI requests and removes these articles from the Platform, but cannot recall copies already obtained or requests already sent. The Platform retains the permission record and private editorial history while the submission record is retained.$notice$, $notice$إذن اختياري: قارئ البحث والمقالات (الإصدار الأول، 21 أكتوبر 2026)

أسمح للمنصة بإرسال عنوان البحث وملخصه المعتمدين للنشر العام إلى واجهة Gemini التابعة لـ Google وفق شروط الخدمات غير المدفوعة، لإنتاج شروح وإجابات مرتبطة بمصادرها وترجمات عربية أو إنجليزية، وإعداد مقالات مبسطة. لا يشمل هذا الإذن الملف الخاص أو بيانات التواصل المدخلة في نموذج التقديم أو المواد غير المنشورة.

قد تستخدم Google المدخلات والمخرجات لتحسين منتجاتها وتقنيات التعلم الآلي، وقد يطّلع عليها مراجعون بشريون. لا تستطيع المنصة حذف المحتوى الذي تحتفظ به Google. وتظل شروط Google وقيودها على المدخلات سارية.

قد تكون الإجابات خاطئة أو ناقصة. تتطلب المقالات اعتماداً تحريرياً ونسبة البحث إلى مؤلفيه. لا تمثل هذه الميزات تحكيماً علمياً أو مشورة مهنية. تُرسل أسئلة القراء أيضاً إلى Google.

أؤكد أن لدي التفويض اللازم من أصحاب الحقوق للسماح بهذه الاستخدامات. هذا الإذن اختياري ومنفصل عن اتفاقية الإيداع. رفضه لا يؤثر على تقديم البحث أو استخراج بياناته أو نشره المعتاد. يمكنني سحبه من هذه الصفحة الخاصة. يوقف السحب الطلبات الجديدة للذكاء الاصطناعي ويحجب هذه المقالات من المنصة، لكنه لا يسترجع النسخ التي حصل عليها الآخرون أو الطلبات التي أُرسلت بالفعل. تحتفظ المنصة بسجل الإذن والتاريخ التحريري الخاص ما دام سجل الإيداع محفوظاً.$notice$);
create table knowledge_permissions (
  id bigint generated always as identity primary key,
  paper_id uuid not null references papers(id),
  granted boolean not null,
  version text not null references knowledge_notices(version),
  language text not null check (language in ('en','ar')),
  text_sha256 text not null,
  created_at timestamptz not null default now()
);
create index knowledge_permissions_latest on knowledge_permissions(paper_id, id desc);
alter table knowledge_notices enable row level security;
alter table knowledge_permissions enable row level security;
revoke all on knowledge_notices, knowledge_permissions from public, anon, authenticated;
create trigger knowledge_notices_immutable before update or delete on knowledge_notices for each row execute function refuse_change();
create trigger knowledge_permissions_immutable before update or delete on knowledge_permissions for each row execute function refuse_change();

alter table article_versions add column source_hash text;
alter table article_versions add column knowledge_permission_id bigint references knowledge_permissions(id);
alter table article_versions add column source_evidence jsonb;

-- Only the server can call this, after hashing the private credential.
-- A read uses NULL p_granted. Every change is a new event; never backdated.
create function knowledge_permission(p_token_hash text, p_language text, p_granted boolean default null, p_notice_hash text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $fn$
declare p papers%rowtype; n knowledge_notices%rowtype; k knowledge_permissions%rowtype; txt text; h text;
begin
  if p_language not in ('en','ar') or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'admin:invalid_input'; end if;
  select * into p from papers where confirmation_token_hash = p_token_hash for update;
  if not found or p.metadata_confirmed_at is null then raise exception 'admin:not_found'; end if;
  select * into n from knowledge_notices where version = 'knowledge-v1-2026-10-21';
  txt := case when p_language = 'ar' then n.text_ar else n.text_en end;
  h := encode(digest(txt, 'sha256'), 'hex');
  select * into k from knowledge_permissions where paper_id = p.id order by id desc limit 1;
  if p_granted is not null then
    if p_notice_hash is distinct from h then raise exception 'admin:conflict'; end if;
    if k.id is null or k.granted is distinct from p_granted then
      insert into knowledge_permissions(paper_id,granted,version,language,text_sha256)
      values(p.id,p_granted,n.version,p_language,h) returning * into k;
    end if;
  end if;
  return jsonb_build_object('granted',coalesce(k.granted,false),'version',n.version,'text',txt,'hash',h);
end;
$fn$;

-- NULL is the only answer for a private/ineligible/unpermitted record.
-- Source identity includes the permission event, so revoke/regrant never
-- silently republishes an old article.
create function knowledge_source(p_public_id text)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $fn$
declare r jsonb; k knowledge_permissions%rowtype; pid uuid; src jsonb;
begin
  r := public_record(p_public_id);
  if r is null then return null; end if;
  select paper_id into pid from public_records where public_id = p_public_id;
  select * into k from knowledge_permissions where paper_id = pid order by id desc limit 1;
  if k.id is null or not k.granted then return null; end if;
  src := jsonb_build_object('title',r->>'title','title_ar',r->>'title_ar','abstract',r->>'abstract','abstract_ar',r->>'abstract_ar');
  if coalesce(src->>'abstract','') = '' and coalesce(src->>'abstract_ar','') = '' then return null; end if;
  return jsonb_build_object('public_id',p_public_id,'paper_id',pid,'permission_id',k.id,'source',src,
    'hash',encode(digest(src::text || ':' || k.id::text,'sha256'),'hex'));
end;
$fn$;

create function knowledge_admin(p_actor uuid, p_paper uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare rid text; s jsonb; v jsonb;
begin
  perform admin_require_role(p_actor,array['administrator']);
  perform admin_require_access(p_actor,p_paper);
  select public_id into rid from public_records where paper_id=p_paper;
  s := knowledge_source(rid);
  select to_jsonb(av) into v from articles a join article_versions av on av.id=a.current_version_id where a.paper_id=p_paper;
  return jsonb_build_object('source',s,'draft',v,'published_version_id',(select published_version_id from articles where paper_id=p_paper));
end;
$fn$;

create function knowledge_save_draft(p_actor uuid,p_paper uuid,p_hash text,p_content jsonb)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare s jsonb; a articles%rowtype; vid uuid; seq int; rid text;
begin
  perform admin_require_role(p_actor,array['administrator']);
  perform admin_require_access(p_actor,p_paper);
  perform 1 from papers where id=p_paper for update;
  select public_id into rid from public_records where paper_id=p_paper;
  s := knowledge_source(rid);
  if s is null or s->>'hash' is distinct from p_hash then raise exception 'admin:conflict'; end if;
  if jsonb_typeof(p_content) <> 'object' or length(p_content::text)>60000
     or nullif(btrim(p_content->>'headline'),'') is null or nullif(btrim(p_content->>'headline_ar'),'') is null
     or nullif(btrim(p_content->>'body_en'),'') is null or nullif(btrim(p_content->>'body_ar'),'') is null then raise exception 'admin:invalid_input'; end if;
  insert into articles(paper_id) values(p_paper) on conflict(paper_id) do nothing;
  select * into a from articles where paper_id=p_paper for update;
  select coalesce(max(version_number),0)+1 into seq from article_versions where article_id=a.id;
  insert into article_versions(article_id,version_number,created_by,is_ai_generated,status,headline,headline_ar,body_en,body_ar,source_hash,knowledge_permission_id,source_evidence)
  values(a.id,seq,p_actor::text,coalesce((p_content->>'is_ai_generated')::boolean,false),'needs_review',
    p_content->>'headline',p_content->>'headline_ar',p_content->>'body_en',p_content->>'body_ar',p_hash,(s->>'permission_id')::bigint,p_content->'evidence')
  returning id into vid;
  update articles set current_version_id=vid where id=a.id;
  perform admin_log(p_paper,p_actor,'administrator','article_draft_saved',jsonb_build_object('version_id',vid));
  return jsonb_build_object('ok',true,'version_id',vid);
end;
$fn$;

-- Replace the unused legacy publication guard with current eligibility
-- and the additional permission. Ordinary research publication is untouched.
create or replace function prevent_premature_publish()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare s jsonb; rid text;
begin
  if new.is_published then
    select pr.public_id into rid from articles a join public_records pr on pr.paper_id=a.paper_id where a.id=new.article_id;
    s := knowledge_source(rid);
    if s is null or new.source_hash is distinct from s->>'hash'
       or new.knowledge_permission_id is distinct from (s->>'permission_id')::bigint then
      raise exception 'admin:conflict';
    end if;
  end if;
  return new;
end;
$fn$;

create function knowledge_publish(p_actor uuid,p_paper uuid,p_version uuid,p_publish boolean)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare a articles%rowtype; s jsonb; v article_versions%rowtype; rid text;
begin
  perform admin_require_role(p_actor,array['administrator']);
  perform admin_require_access(p_actor,p_paper);
  perform 1 from papers where id=p_paper for update;
  select * into a from articles where paper_id=p_paper for update;
  if not found then raise exception 'admin:not_found'; end if;
  if p_publish then
    if p_version is distinct from a.current_version_id then raise exception 'admin:conflict'; end if;
    select * into v from article_versions where id=p_version and article_id=a.id;
    select public_id into rid from public_records where paper_id=p_paper;
    s := knowledge_source(rid);
    if s is null or v.source_hash is distinct from s->>'hash' then raise exception 'admin:conflict'; end if;
  end if;
  update article_versions set is_published=false where article_id=a.id and is_published;
  if p_publish then update article_versions set is_published=true,status='published' where id=p_version; end if;
  update articles set published_version_id=case when p_publish then p_version else null end where id=a.id;
  perform admin_log(p_paper,p_actor,'administrator',case when p_publish then 'article_published' else 'article_unpublished' end,jsonb_build_object('version_id',p_version));
  return jsonb_build_object('ok',true);
end;
$fn$;

create function knowledge_article(p_public_id text)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare s jsonb; v article_versions%rowtype;
begin
  s := knowledge_source(p_public_id);
  if s is null then return null; end if;
  select av.* into v from articles a join article_versions av on av.id=a.published_version_id
    where a.paper_id=(s->>'paper_id')::uuid and av.is_published and av.source_hash=s->>'hash';
  if not found then return null; end if;
  return jsonb_build_object('headline',v.headline,'headline_ar',v.headline_ar,'body_en',v.body_en,'body_ar',v.body_ar,'evidence',v.source_evidence,'version',v.version_number);
end;
$fn$;

revoke all on function knowledge_permission(text,text,boolean,text),knowledge_source(text),knowledge_admin(uuid,uuid),
  knowledge_save_draft(uuid,uuid,text,jsonb),knowledge_publish(uuid,uuid,uuid,boolean),knowledge_article(text),prevent_premature_publish() from public,anon,authenticated;
grant execute on function knowledge_permission(text,text,boolean,text),knowledge_source(text),knowledge_admin(uuid,uuid),
  knowledge_save_draft(uuid,uuid,text,jsonb),knowledge_publish(uuid,uuid,uuid,boolean),knowledge_article(text) to service_role;
commit;
