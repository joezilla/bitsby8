/**
 * Built-in kernel-card seeder (Bitsby8 Story 5.2).
 *
 * 8sim's behavior kernels (VDM-1, Dazzler, keyboard, RTC, bank RAM) are only
 * reachable through the card-authoring flow, so out of the box a fresh Catalog
 * has no card you can drop on a backplane for them. This seeds one built-in
 * authored card per kernel at startup — idempotent (content-addressed upsert) —
 * so the new hardware is addable, and presets can reference it by Identity.
 */

import { Dependencies } from '../types';
import { authorCard } from './card-authoring';
import { listKernels } from './bundle-registry';
import type { CardBehavior } from './authored-bundle';
import { createLogger } from '../logger';

const log = createLogger('kernel-cards-seed');

interface BuiltinKernelCard {
  name: string;
  kernel: string;
  maker: string;
  summary: string;
}

/** One card per kernel; `name@1.0.0` is the ref presets/backplanes use. */
const KERNEL_CARDS: BuiltinKernelCard[] = [
  { name: 'vdm-1-video', kernel: 'vdm-video', maker: 'Processor Technology', summary: 'VDM-1 memory-mapped 64×16 character display.' },
  { name: 'cromemco-dazzler', kernel: 'dazzler-video', maker: 'Cromemco', summary: 'Dazzler DMA colour-graphics card (two I/O ports).' },
  { name: 'ascii-keyboard', kernel: 'keyboard', maker: 'generic', summary: 'Parallel ASCII keyboard input port (data + status).' },
  { name: 'mm58167-rtc', kernel: 'mm58167-rtc', maker: 'National', summary: 'MM58167 real-time clock — BCD time on a 32-register I/O window.' },
  { name: 'bank-ram', kernel: 'bank-ram', maker: 'generic', summary: 'Bank-switching RAM — N banks behind a fixed window (MMU).' },
  { name: 'boot-rom', kernel: 'boot-rom', maker: 'generic', summary: 'Boot/phantom ROM overlay — shadows a window at reset, pages out on a control-port write.' },
];

/** Register the built-in kernel cards into the Catalog. Non-fatal + idempotent. */
export async function loadSeedKernelCards(deps: Dependencies): Promise<number> {
  const available = new Set((await listKernels().catch(() => [])).map((k) => k.id));
  let n = 0;
  for (const c of KERNEL_CARDS) {
    if (!available.has(c.kernel)) continue; // engine build predates this kernel
    try {
      await authorCard(deps, {
        name: c.name,
        version: '1.0.0',
        maker: c.maker,
        summary: c.summary,
        behavior: { resolvesTo: 'io', kernel: c.kernel } as CardBehavior,
      });
      n++;
    } catch (err) {
      log.debug(`kernel card ${c.name} not seeded: ${(err as Error).message}`);
    }
  }
  if (n) log.info(`seeded ${n} built-in kernel cards into the Catalog`);
  return n;
}
