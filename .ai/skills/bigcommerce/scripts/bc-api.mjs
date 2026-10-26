#!/usr/bin/env node
// Query BigCommerce's per-area OpenAPI specs from the terminal without loading
// 400 KB JSON files into an AI context window. Zero dependencies (Node 18+).
//
//   node .ai/skills/bigcommerce/scripts/bc-api.mjs list [filter]
//   node .ai/skills/bigcommerce/scripts/bc-api.mjs search <term> [--spec <name>]
//   node .ai/skills/bigcommerce/scripts/bc-api.mjs show <spec> <METHOD> <path-fragment>
//   node .ai/skills/bigcommerce/scripts/bc-api.mjs paths <spec>
//   node .ai/skills/bigcommerce/scripts/bc-api.mjs refresh
//
// Specs are cached in .ai/skills/bigcommerce/.cache/ (gitignored).

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://docs.bigcommerce.com';
const CACHE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.cache');
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

async function cached(name, url, force = false) {
  const file = path.join(CACHE, name);
  if (!force && existsSync(file)) return readFile(file, 'utf8');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
  const body = await res.text();
  await mkdir(CACHE, { recursive: true });
  await writeFile(file, body);
  return body;
}

// The "openapi.json" URL is actually an HTML page linking to openapi/<name>.json
async function specNames(force = false) {
  const html = await cached('index.html', `${BASE}/openapi.json`, force);
  return [...html.matchAll(/href="openapi\/([^"]+)\.json"/g)].map((m) => m[1]);
}

async function loadSpec(name, force = false) {
  return JSON.parse(await cached(`${name}.json`, `${BASE}/openapi/${name}.json`, force));
}

function resolveSpecName(names, wanted) {
  if (names.includes(wanted)) return wanted;
  const hits = names.filter((n) => n.includes(wanted));
  if (hits.length === 1) return hits[0];
  throw new Error(hits.length ? `Ambiguous spec "${wanted}": ${hits.join(', ')}` : `No spec "${wanted}". Run: list`);
}

function deref(spec, node, seen = new Set()) {
  if (!node || typeof node !== 'object') return node;
  if (node.$ref) {
    if (seen.has(node.$ref)) return { circular: node.$ref };
    const target = node.$ref.replace(/^#\//, '').split('/').reduce((o, k) => o?.[k], spec);
    return deref(spec, target, new Set(seen).add(node.$ref));
  }
  if (Array.isArray(node)) return node.map((n) => deref(spec, n, seen));
  return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, deref(spec, v, seen)]));
}

// Compact one-line-per-field rendering of a JSON schema.
function describeSchema(schema, indent = '  ', depth = 0) {
  if (!schema) return '';
  if (schema.allOf) schema = Object.assign({}, ...schema.allOf.map((s) => ({ ...s, properties: { ...s.properties } })), { properties: Object.assign({}, ...schema.allOf.map((s) => s.properties || {})) });
  if (schema.type === 'array') return `${indent}[array of]\n${describeSchema(schema.items, indent + '  ', depth + 1)}`;
  const props = schema.properties;
  if (!props || depth > 3) return `${indent}(${schema.type ?? 'object'})\n`;
  const required = new Set(schema.required || []);
  return Object.entries(props)
    .map(([k, v]) => {
      const type = v.enum ? `enum(${v.enum.join('|')})` : v.type === 'array' ? `array<${v.items?.type ?? 'object'}>` : (v.type ?? 'object');
      const desc = (v.description || '').replace(/\s+/g, ' ').slice(0, 110);
      const line = `${indent}${k}${required.has(k) ? '*' : ''}: ${type}${desc ? ' — ' + desc : ''}\n`;
      const nested = v.type === 'object' && v.properties ? describeSchema(v, indent + '  ', depth + 1) : v.type === 'array' && v.items?.properties ? describeSchema(v.items, indent + '  ', depth + 1) : '';
      return line + nested;
    })
    .join('');
}

function* operations(spec) {
  for (const [p, item] of Object.entries(spec.paths || {}))
    for (const m of METHODS) if (item[m]) yield { path: p, method: m, op: item[m], item };
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const flag = (n) => { const i = rest.indexOf(n); return i >= 0 ? rest.splice(i, 2)[1] : undefined; };
  const specFilter = flag('--spec');

  if (cmd === 'refresh') {
    const names = await specNames(true);
    for (const n of names) await loadSpec(n, true);
    return console.log(`Refreshed ${names.length} specs into ${CACHE}`);
  }
  const names = await specNames();

  if (cmd === 'list') {
    const f = rest[0];
    return console.log(names.filter((n) => !f || n.includes(f)).join('\n'));
  }
  if (cmd === 'paths') {
    const spec = await loadSpec(resolveSpecName(names, rest[0]));
    for (const { path: p, method, op } of operations(spec)) console.log(`${method.toUpperCase().padEnd(6)} ${p}  — ${op.summary ?? ''}`);
    return;
  }
  if (cmd === 'search') {
    const term = rest.join(' ').toLowerCase();
    if (!term) throw new Error('search needs a term');
    const targets = specFilter ? [resolveSpecName(names, specFilter)] : names;
    let hits = 0;
    for (const n of targets) {
      const spec = await loadSpec(n);
      for (const { path: p, method, op } of operations(spec)) {
        const hay = `${p} ${op.summary ?? ''} ${op.operationId ?? ''} ${op.description ?? ''}`.toLowerCase();
        if (hay.includes(term)) { hits++; console.log(`${n}\t${method.toUpperCase().padEnd(6)} ${p}  — ${op.summary ?? ''}`); }
      }
    }
    return console.log(hits ? `\n${hits} match(es). Detail: show <spec> <METHOD> <path-fragment>` : 'No matches.');
  }
  if (cmd === 'show') {
    const [specArg, methodArg, frag] = rest;
    if (!frag) throw new Error('usage: show <spec> <METHOD> <path-fragment>');
    const name = resolveSpecName(names, specArg);
    const spec = await loadSpec(name);
    const matches = [...operations(spec)].filter((o) => o.method === methodArg.toLowerCase() && o.path.includes(frag));
    if (!matches.length) throw new Error(`No ${methodArg} operation matching "${frag}" in ${name}. Try: paths ${name}`);
    for (const { path: p, method, op, item } of matches.slice(0, 3)) {
      const o = deref(spec, op);
      console.log(`\n${method.toUpperCase()} ${p}   [${name}]\n${o.summary ?? ''}\n${(o.description ?? '').trim()}\n`);
      const params = [...(deref(spec, item.parameters) || []), ...(o.parameters || [])].filter((x) => x.name !== 'store_hash');
      if (params.length) console.log('Parameters:\n' + params.map((x) => `  ${x.in} ${x.name}${x.required ? '*' : ''}: ${x.schema?.type ?? ''}${x.schema?.enum ? ' enum(' + x.schema.enum.join('|') + ')' : ''} — ${(x.description || '').replace(/\s+/g, ' ').slice(0, 140)}`).join('\n'));
      const body = o.requestBody?.content?.['application/json']?.schema;
      if (body) console.log('\nRequest body (* = required):\n' + describeSchema(body));
      for (const [code, r] of Object.entries(o.responses || {})) {
        const s = r.content?.['application/json']?.schema;
        console.log(`\nResponse ${code}: ${(r.description || '').replace(/\s+/g, ' ')}${s ? '\n' + describeSchema(s) : ''}`);
      }
    }
    if (matches.length > 3) console.log(`\n(+${matches.length - 3} more matches — narrow the path fragment)`);
    return;
  }
  console.log('Commands: list [filter] | paths <spec> | search <term> [--spec <name>] | show <spec> <METHOD> <path-fragment> | refresh');
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; });
