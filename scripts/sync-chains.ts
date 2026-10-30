/**
 * Builds src/data/chains.json from the polkadot-js/apps endpoint lists.
 *
 * The endpoint files are fetched as TypeScript source from a pinned commit and read
 * statically with @babel/parser. Nothing from polkadot-js/apps is installed
 * or executed: @polkadot/apps-config would pull in ~750 extra packages just for this list.
 *
 * Usage: pnpm sync-chains [git-ref]   (defaults to the current HEAD of polkadot-js/apps)
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { parse } from '@babel/parser';
import type { ArrayExpression, Expression, Node, ObjectExpression } from '@babel/types';
import type { ChainInfo, RelayName } from '../src/lib/types';

const REPO = 'polkadot-js/apps';
const ENDPOINTS_PATH = 'packages/apps-config/src/endpoints';

const RELAYS: { relay: RelayName; file: string; prefix: string }[] = [
  { relay: 'polkadot', file: 'productionRelayPolkadot.ts', prefix: 'Polkadot' },
  { relay: 'kusama', file: 'productionRelayKusama.ts', prefix: 'Kusama' },
];

const resolveCommit = (ref: string) => {
  if (/^[0-9a-f]{40}$/.test(ref)) return ref;
  const output = execFileSync('git', ['ls-remote', `https://github.com/${REPO}`, ref], { encoding: 'utf8' });
  const commit = output.split('\t')[0];
  if (!commit) throw new Error(`Unknown ref ${ref} in ${REPO}`);
  return commit;
};

const fetchSource = async (commit: string, file: string) => {
  const response = await fetch(`https://raw.githubusercontent.com/${REPO}/${commit}/${ENDPOINTS_PATH}/${file}`);
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
  return response.text();
};

/** Strip `as` / `satisfies` wrappers around a literal. */
const unwrap = (node: Node): Node =>
  node.type === 'TSAsExpression' || node.type === 'TSSatisfiesExpression' ? unwrap(node.expression) : node;

const propertyValue = (object: ObjectExpression, name: string): Node | undefined => {
  for (const property of object.properties) {
    if (property.type !== 'ObjectProperty' || property.computed) continue;
    const key = property.key.type === 'Identifier' ? property.key.name : property.key.type === 'StringLiteral' ? property.key.value : undefined;
    if (key === name) return unwrap(property.value);
  }
  return undefined;
};

const stringValue = (node?: Node) => (node?.type === 'StringLiteral' ? node.value : undefined);

/** Only literal values are read; anything computed is skipped rather than evaluated. */
const providersOf = (object: ObjectExpression) => {
  const providers = propertyValue(object, 'providers');
  if (providers?.type !== 'ObjectExpression') return [];
  return providers.properties
    .map((property) => (property.type === 'ObjectProperty' ? stringValue(property.value) : undefined))
    .filter((url): url is string => !!url?.startsWith('wss://'));
};

const toChain = (relay: RelayName, object: ObjectExpression, isRelay: boolean): ChainInfo | null => {
  const paraIdNode = propertyValue(object, 'paraId');
  const paraId = paraIdNode?.type === 'NumericLiteral' ? paraIdNode.value : undefined;
  if (!isRelay && paraId === undefined) return null;
  return {
    key: isRelay ? `${relay}:relay` : `${relay}:${paraId}`,
    relay,
    paraId: isRelay ? null : paraId!,
    name: isRelay ? `${relay[0].toUpperCase()}${relay.slice(1)} Relay` : (stringValue(propertyValue(object, 'text')) ?? `Para ${paraId}`),
    homepage: stringValue(propertyValue(object, 'homepage')),
    providers: providersOf(object),
  };
};

const topLevelInitializers = (source: string) => {
  const program = parse(source, { sourceType: 'module', plugins: ['typescript'] }).program;
  const initializers = new Map<string, Node>();
  for (const statement of program.body) {
    const declaration = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement;
    if (declaration?.type !== 'VariableDeclaration') continue;
    for (const declarator of declaration.declarations) {
      if (declarator.id.type === 'Identifier' && declarator.init) {
        initializers.set(declarator.id.name, unwrap(declarator.init as Expression));
      }
    }
  }
  return initializers;
};

const ref = process.argv[2] ?? 'HEAD';
const commit = resolveCommit(ref);
const chains: ChainInfo[] = [];

for (const { relay, file, prefix } of RELAYS) {
  const initializers = topLevelInitializers(await fetchSource(commit, file));
  const relayObject = initializers.get(`prodRelay${prefix}`);
  if (relayObject?.type !== 'ObjectExpression') throw new Error(`${file}: prodRelay${prefix} not found`);
  chains.push(toChain(relay, relayObject, true)!);

  // `linked: [...prodParas<Relay>Common, ...prodParas<Relay>]`, resolved in the same order.
  const linked = propertyValue(relayObject, 'linked');
  if (linked?.type !== 'ArrayExpression') throw new Error(`${file}: linked list not found`);
  for (const element of linked.elements) {
    const name = element?.type === 'SpreadElement' && element.argument.type === 'Identifier' ? element.argument.name : undefined;
    const list = name ? initializers.get(name) : undefined;
    if (list?.type !== 'ArrayExpression') throw new Error(`${file}: cannot resolve linked entry ${name ?? element?.type}`);
    for (const item of (list as ArrayExpression).elements) {
      const chain = item?.type === 'ObjectExpression' ? toChain(relay, item, false) : null;
      if (chain) chains.push(chain);
    }
  }
}

writeFileSync(new URL('../src/data/chains.json', import.meta.url), `${JSON.stringify(chains, null, 2)}\n`);
writeFileSync(
  new URL('../src/data/chains-source.json', import.meta.url),
  `${JSON.stringify({ repository: REPO, commit, syncedAt: new Date().toISOString() }, null, 2)}\n`,
);
console.log(`Wrote ${chains.length} chains from ${REPO}@${commit.slice(0, 10)}`);
