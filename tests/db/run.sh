#!/usr/bin/env bash
# Database tests: apply supabase_schema.sql and supabase_security.sql (twice: it must be safe to re-run) to a
# throwaway Postgres that imitates Supabase, then check what every kind of user may do.
# Needs psql and a superuser connection in the usual PG* variables (PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE).
# NEVER point this at the real Supabase database: it creates roles and test users.
set -uo pipefail
cd "$(dirname "$0")/../.."

export PGOPTIONS='-c client_min_messages=warning'
PSQL=(psql -X -q -t -A -v ON_ERROR_STOP=1)

setup() {
  "${PSQL[@]}" -f tests/db/supabase-mock.sql >/dev/null &&
  "${PSQL[@]}" -f supabase_schema.sql >/dev/null &&
  "${PSQL[@]}" -f supabase_security.sql >/dev/null &&
  "${PSQL[@]}" -f supabase_security.sql >/dev/null &&
  "${PSQL[@]}" -f tests/db/seed.sql >/dev/null
}
if ! setup; then echo "FAIL: the migration files did not apply cleanly"; exit 1; fi
echo "ok   schema + security applied (security twice) + seed"

uid() { printf 'authenticated|{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000000%s"}' "$1"; }
declare -A WHO=(
  [guest]='anon|{"role":"anon"}' [anonSignin]="$(uid 3)" [agcAccount]="$(uid 2)" [unconfirmed]="$(uid 4)"
  [viewer]="$(uid 6)" [approver]="$(uid 7)" [staff]="$(uid 5)" [admin]="$(uid 1)"
)
ORDER=(guest anonSignin agcAccount unconfirmed viewer approver staff admin)

# run SQL as a user; $3 = commit|rollback. Prints the first value, 0rows, or a short error.
as_user() {
  local role="${WHO[$1]%%|*}" claims="${WHO[$1]#*|}" sql="$2" end="${3:-rollback}" out
  out=$(psql -X -q -t -A 2>&1 <<SQL
begin;
select set_config('request.jwt.claims', '$claims', true) \gset
set local role $role;
$sql;
$end;
SQL
)
  local err; err=$(grep -m1 'ERROR:' <<<"$out")
  if [[ -n "$err" ]]; then
    err=${err#*ERROR:  }
    case "$err" in
      "permission denied"*) echo denied ;;
      "new row violates"*)  echo rls ;;
      *) echo "${err%% *}" ;;
    esac
  else
    local first; first=$(grep -v '^$' <<<"$out" | head -1)
    echo "${first:-0rows}"
  fi
}

trim() { local v="$1"; v="${v#"${v%%[![:space:]]*}"}"; printf '%s' "${v%"${v##*[![:space:]]}"}"; }
fails=0; checks=0
check() {   # label expected actual
  checks=$((checks + 1))
  if [[ "$2" == "$3" ]]; then return 0; fi
  fails=$((fails + 1)); echo "FAIL $1: expected [$2] got [$3]"
}

# 1. permission matrix
while IFS='|' read -r label sql expected; do
  [[ -z "${label// }" || "$label" == \#* ]] && continue
  label=$(trim "$label"); sql=$(trim "$sql"); read -ra exp <<<"$expected"
  for i in "${!ORDER[@]}"; do
    check "$label as ${ORDER[$i]}" "${exp[$i]}" "$(as_user "${ORDER[$i]}" "$sql")"
  done
done < tests/db/cases.txt
echo "ok   permission matrix run"

# 2. audit trail: stock change + log in one transaction, author recorded by the database (committed for real)
q() { "${PSQL[@]}" -c "$1"; }
logs_before=$(q "select count(*) from logs")
as_user staff "select adjust_stock_v3('i1',1,'out',null,null,'dev','out','📤 เบิก 1 pcs (คงเหลือ {stock})','งาน PM',null)" commit >/dev/null
check "v3 writes the log with the real author" "📤 เบิก 1 pcs (คงเหลือ 4)|Golf|staff@gmail.com|out|1" \
  "$(q "select msg||'|'||\"user\"||'|'||user_email||'|'||(undo_data->>'action')||'|'||(undo_data->>'qty') from logs order by id desc limit 1")"
check "v3 changes the stock" "4" "$(q "select \"Actual\" from inventory where id='i1'")"

check "over-stock is refused" "OVER_STOCK" "$(as_user staff "select adjust_stock_v3('i1',99,'out',null,null,'dev','out','x','',null)" commit)"
check "a log type that lies is refused" "BAD_LOG_TYPE" "$(as_user staff "select adjust_stock_v3('i1',1,'out',null,null,'dev','in','x','',null)" commit)"
check "refused changes leave no log and no stock change" "$((logs_before + 1))|4" \
  "$(q "select (select count(*) from logs)||'|'||(select \"Actual\" from inventory where id='i1')")"

as_user staff "insert into logs(type,msg,\"user\",user_email) values('edit','spoof','Somchai','somchai@gmail.com')" commit >/dev/null
check "a log row cannot claim someone else" "Golf|staff@gmail.com" "$(q "select \"user\"||'|'||user_email from logs where msg='spoof'")"
as_user staff "select adjust_stock_v2('i1',1,'in',null,null,'dev','Somchai')" commit >/dev/null
check "old v2 path cannot claim someone else" "Golf|staff@gmail.com" "$(q "select \"_updatedBy\"||'|'||\"_updatedByEmail\" from inventory where id='i1'")"
as_user admin "update logs set msg='spoof (edited)', \"user\"='Admin rewrote' where msg='spoof'" commit >/dev/null
check "an admin edit keeps the original author" "spoof (edited)|Golf" "$(q "select msg||'|'||\"user\" from logs where msg like 'spoof%'")"
q "insert into logs(type,msg,\"user\") values('system','manual','sql editor')" >/dev/null
check "SQL editor rows keep the given name" "sql editor" "$(q "select \"user\" from logs where msg='manual'")"
echo "ok   audit trail run"

echo "$checks checks, $fails failed"
[[ $fails -eq 0 ]]
