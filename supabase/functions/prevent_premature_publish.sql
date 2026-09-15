create or replace function prevent_premature_publish()
returns trigger
language plpgsql
as $$
begin
  if new.is_published then
    if not exists (
      select 1
      from articles a
      join papers p on p.id = a.paper_id
      where a.id = new.article_id
        and p.status in ('approved', 'published')
    ) then
      raise exception 'Cannot publish a version until its paper has been approved.';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_prevent_premature_publish
  before insert or update on article_versions
  for each row execute function prevent_premature_publish();

