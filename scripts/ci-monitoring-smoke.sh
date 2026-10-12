#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
root="$PWD"
work="$(mktemp -d)"
name="waystory-monitoring-${GITHUB_RUN_ID:-$$}"
grafana_image=grafana/grafana:11.6.0
prom_image=prom/prometheus:v3.2.1
vm_image=victoriametrics/vmalert:v1.115.0
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; rm -rf -- "$work"; }
trap cleanup EXIT
node --input-type=module > "$work/metrics.txt" <<'JS'
import {createObservability} from './server/observability.mjs';
const o=createObservability({env:{},write:()=>{},budgetSnapshot:()=>({limit:10,remaining:4})});
await o.run(()=>o.wrapFetch(async()=>new Response('',{status:403}))('https://api.tavily.com/search'));
o.record('stage',{stage:'generation',outcome:'success',durationMs:500});
console.log(o.render());
JS
docker run --rm -i --entrypoint /bin/promtool "$prom_image" check metrics < "$work/metrics.txt"
docker run --rm --user 0:0 -v "$root/monitoring:/rules:ro" --entrypoint /bin/promtool "$prom_image" check rules /rules/alerts.yml
docker run --rm --user 0:0 -v "$root/monitoring:/rules:ro" -w /rules --entrypoint /bin/promtool "$prom_image" test rules alerts.test.yml
docker run --rm --user 0:0 -v "$root/monitoring:/rules:ro" "$vm_image" -rule=/rules/alerts.yml -dryRun
# Parse every dashboard expression with the same PromQL parser used for rules.
node --input-type=module > "$work/dashboard-rules.json" <<'JS'
import fs from 'node:fs';
const dashboard=JSON.parse(fs.readFileSync('monitoring/grafana-dashboard.json','utf8'));
const rules=dashboard.panels.flatMap(p=>(p.targets||[]).map(t=>t.expr)).filter(Boolean).map((expr,i)=>({record:`waystory_dashboard_check_${i}`,expr:expr.replaceAll('${job:regex}','waystory').replaceAll('${instance:regex}','.*').replaceAll('$__rate_interval','5m').replaceAll('$__range','6h')}));
console.log(JSON.stringify({groups:[{name:'dashboard_validation',rules}]}));
JS
docker run --rm --user 0:0 -v "$work:/checks:ro" --entrypoint /bin/promtool "$prom_image" check rules /checks/dashboard-rules.json
# Disposable local Grafana with test-only credentials. No external datasource.
docker run -d --name "$name" -p 127.0.0.1::3000 \
  -e GF_SECURITY_ADMIN_PASSWORD=waystory-ci-only \
  -e GF_ANALYTICS_REPORTING_ENABLED=false \
  -e GF_ANALYTICS_CHECK_FOR_UPDATES=false "$grafana_image" > /dev/null
port="$(docker port "$name" 3000/tcp | sed 's/.*://')"
for attempt in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$port/api/health" > "$work/health.json" 2>/dev/null; then break; fi
  sleep 1
done
python3 - "$port" <<'PY'
import json, sys, urllib.request, base64
from pathlib import Path
base='http://127.0.0.1:'+sys.argv[1]
headers={'Content-Type':'application/json','Authorization':'Basic '+base64.b64encode(b'admin:waystory-ci-only').decode()}
dashboard=json.loads(Path('monitoring/grafana-dashboard.json').read_text())
request=urllib.request.Request(base+'/api/dashboards/db',data=json.dumps({'dashboard':dashboard,'overwrite':True}).encode(),headers=headers)
with urllib.request.urlopen(request,timeout=20) as response:
    result=json.load(response)
    assert result['status']=='success',result
request=urllib.request.Request(base+'/api/dashboards/uid/waystory-overview',headers=headers)
with urllib.request.urlopen(request,timeout=20) as response:
    saved=json.load(response)['dashboard']
    assert len(saved['panels'])==len(dashboard['panels'])
    assert saved['templating']['list'][0]['type']=='datasource'
print('Grafana dashboard import and round-trip passed')
PY
