import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {metricDefinitions} from '../server/observability.mjs';
test('Grafana dashboard uses selectable datasource and bounded app metrics',()=>{
 const dashboard=JSON.parse(readFileSync(new URL('../monitoring/grafana-dashboard.json',import.meta.url)));
 assert.ok(dashboard.panels.length>=20);assert.equal(dashboard.templating.list[0].type,'datasource');
 const known=new Set(Object.keys(metricDefinitions).flatMap(name=>['waystory_'+name,...['_bucket','_sum','_count'].map(s=>'waystory_'+name+s)]));
 for(const panel of dashboard.panels){if(panel.type==='row')continue;assert.equal(panel.datasource.uid,'${datasource}');for(const target of panel.targets||[]){for(const metric of target.expr.match(/waystory_[a-z_]+/g)||[])assert.ok(known.has(metric),metric);assert.ok(target.expr.includes('${job:regex}'));assert.ok(target.expr.includes('${instance:regex}'))}}
 assert.ok(dashboard.panels.some(p=>p.title.includes('Last HTTP status')));assert.ok(dashboard.panels.some(p=>p.title.includes('No observed success')));
});
test('scrape example uses a credential file and rules have traffic/budget guards',()=>{
 const scrape=readFileSync(new URL('../monitoring/vmagent.yml',import.meta.url),'utf8'),rules=readFileSync(new URL('../monitoring/alerts.yml',import.meta.url),'utf8'),compose=readFileSync(new URL('../compose.production.yaml',import.meta.url),'utf8');assert.match(scrape,/credentials_file:/);assert.doesNotMatch(scrape,/credentials:/);assert.match(scrape,/scheme: http/);assert.match(scrape,/REPLACE_WITH_WAYSTORY_VPN_IP:5173/);assert.match(compose,/ports:\s*\n\s*- "0\.0\.0\.0:5173:5173"/);assert.match(rules,/WaystoryProviderAccessDenied/);assert.match(rules,/waystory_tavily_daily_calls_limit.*> 0/);assert.match(rules,/sum by \(job, instance\).*waystory_http_requests_total/);assert.doesNotMatch(rules,/placeId|requestId/);
});
