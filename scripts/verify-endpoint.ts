/** Usage: tsx scripts/verify-endpoint.ts <expected-para-id> <wss-url>... — prints which URLs serve that para. */
import { getDynamicBuilder, getLookupFn } from '@polkadot-api/metadata-builders';
import { decAnyMetadata, unifyMetadata } from '@polkadot-api/substrate-bindings';
import { connectAny } from '../src/lib/rpc';

const [expected, ...urls] = process.argv.slice(2);
for (const url of urls) {
  try {
    const rpc = await connectAny([url]);
    const at = await rpc.request<string>('chain_getFinalizedHead');
    const metadata = unifyMetadata(decAnyMetadata(await rpc.request<string>('state_getMetadata', [at])));
    const storage = getDynamicBuilder(getLookupFn(metadata)).buildStorage('ParachainInfo', 'ParachainId');
    const raw = await rpc.request<string>('state_getStorage', [storage.keys.enc(), at]);
    const paraId = storage.value.dec(raw);
    console.error(paraId === Number(expected) ? 'MATCH' : 'MISMATCH', url, paraId);
    rpc.close();
  } catch (error) {
    console.error('FAIL', url, error instanceof Error ? error.message : error);
  }
}
process.exit(0);
