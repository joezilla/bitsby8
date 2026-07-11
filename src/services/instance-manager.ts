/**
 * InstanceManager (Bitsby8 Story 1.5) — owns the lifecycle of virtual Machine
 * Instances. This is where the skeleton converges: Resolver (Profile →
 * MachineSpec) → 8sim `buildMachine` → drive the `MachineRunner`, with the
 * emulated disk controller wired to an in-process FDC channel
 * (`ConnectionManager.addInProcessClient`) so disk I/O reuses the existing
 * copy-on-write splinter serving.
 *
 * Ownership (AD-4): InstanceManager is the sole liveness authority for virtual
 * instances — its registry is independent of ConnectionManager's, so a
 * channel/serving teardown never by itself removes an instance; only `destroy`
 * does. Virtual instance serving ids are the reserved `inst:<uuid>` namespace
 * (AD-7), keying each instance's own splinter.
 */

import { randomUUID } from 'crypto';
import type { WebSocketLike, Machine } from '@joezilla/8sim';
import { Dependencies } from '../types';
import { ServiceError } from './service-error';
import { getSim } from './bundle-registry';
import { resolveProfile, MachineProfile } from './resolver';
import { ConsoleHub, ConsoleSubscriber, consoleSourceFromCard } from './console-hub';
import { createLogger } from '../logger';

const log = createLogger('instance-manager');

/** Prefix marking a serving clientId as a virtual instance (reserved). */
export const INSTANCE_CLIENT_PREFIX = 'inst:';

export type InstanceStatus = 'defined' | 'running' | 'stopped';

interface RunningInstance {
  id: string;
  clientId: string; // `inst:<id>`
  profileRef: string;
  transient: boolean;
  status: InstanceStatus;
  profile: MachineProfile;
  machine?: Machine;
  channel?: WebSocketLike;
  channelConnId?: string;
  console?: ConsoleHub;
}

export interface InstanceInfo {
  id: string;
  clientId: string;
  profileRef: string;
  transient: boolean;
  status: InstanceStatus;
  cpuKind: string;
  effectiveHz?: number;
  targetHz?: number | 'max';
}

export class InstanceManager {
  private instances = new Map<string, RunningInstance>();

  constructor(private deps: Dependencies) {}

  private cm() {
    const cm = this.deps.connectionManager;
    if (!cm) {
      throw new ServiceError('Disk serving is not available; cannot run a virtual instance', 409);
    }
    return cm;
  }

  /** Define a persistent, DB-backed instance (not started). */
  async define(profile: MachineProfile, profileRef = 'inline'): Promise<InstanceInfo> {
    const inst = this.register(profile, profileRef, false);
    await this.deps.database.upsertMachineInstance({
      id: inst.id,
      profile_ref: profileRef,
      client_id: inst.clientId,
      cpu_kind: profile.cpuKind,
      status: 'defined',
    });
    return this.info(inst);
  }

  /** Create AND start a transient instance — memory-only, no DB/splinter residue on destroy. */
  async createTransient(profile: MachineProfile, profileRef = 'inline'): Promise<InstanceInfo> {
    const inst = this.register(profile, profileRef, true);
    await this.startInstance(inst);
    return this.info(inst);
  }

  async start(id: string): Promise<InstanceInfo> {
    const inst = this.require(id);
    if (inst.status !== 'running') {
      await this.startInstance(inst);
      if (!inst.transient) await this.deps.database.setMachineInstanceStatus(id, 'running');
    }
    return this.info(inst);
  }

  async stop(id: string): Promise<InstanceInfo> {
    const inst = this.require(id);
    if (inst.status === 'running') {
      this.teardown(inst);
      inst.status = 'stopped';
      if (!inst.transient) await this.deps.database.setMachineInstanceStatus(id, 'stopped');
    }
    return this.info(inst);
  }

  async destroy(id: string): Promise<void> {
    const inst = this.instances.get(id);
    if (!inst) return;
    if (inst.status === 'running') this.teardown(inst);
    this.instances.delete(id);
    if (!inst.transient) await this.deps.database.deleteMachineInstance(id);
    log.info({ id, transient: inst.transient }, 'instance destroyed');
  }

  list(): InstanceInfo[] {
    return Array.from(this.instances.values()).map((i) => this.info(i));
  }

  get(id: string): InstanceInfo {
    return this.info(this.require(id));
  }

  // --- internals ---

  private register(profile: MachineProfile, profileRef: string, transient: boolean): RunningInstance {
    const id = randomUUID();
    const inst: RunningInstance = {
      id,
      clientId: `${INSTANCE_CLIENT_PREFIX}${id}`,
      profileRef,
      transient,
      status: 'defined',
      profile,
    };
    this.instances.set(id, inst);
    return inst;
  }

  private async startInstance(inst: RunningInstance): Promise<void> {
    const sim = await getSim();
    const { spec } = await resolveProfile(this.deps, inst.profile);
    // Give the machine its own in-process FDC client (own splinter).
    const { channel, id: connId } = await this.cm().addInProcessClient(inst.clientId);
    let machine: Machine;
    try {
      machine = sim.buildMachine(spec, { services: { fdc: channel } });
    } catch (err) {
      channel.close(); // tear down the served connection we just created
      throw new ServiceError(
        `Failed to build machine for instance ${inst.id}: ${(err as Error).message}`,
        500,
      );
    }
    // Wire the operator console to the designated serial card (AD-6).
    const consoleCard = inst.profile.consoleCardId
      ? machine.cards.find((c) => c.id === inst.profile.consoleCardId)
      : machine.cards.find((c) => consoleSourceFromCard(c) !== null);
    const source = consoleCard ? consoleSourceFromCard(consoleCard) : null;
    inst.console = source ? new ConsoleHub(source) : undefined;

    machine.runner.start();
    inst.machine = machine;
    inst.channel = channel;
    inst.channelConnId = connId;
    inst.status = 'running';
    log.info(
      { id: inst.id, clientId: inst.clientId, transient: inst.transient, console: !!inst.console },
      'instance started',
    );
  }

  private teardown(inst: RunningInstance): void {
    inst.machine?.runner.stop();
    inst.channel?.close(); // closes the in-process channel → ConnectionManager removes the served conn
    inst.machine = undefined;
    inst.channel = undefined;
    inst.channelConnId = undefined;
    inst.console = undefined;
  }

  /** The console hub of a running instance (throws if not running / no console). */
  getConsole(id: string): ConsoleHub {
    const inst = this.require(id);
    if (!inst.console) {
      throw new ServiceError(`Instance ${id} has no live console (not running?)`, 409);
    }
    return inst.console;
  }

  /** Subscribe to a running instance's console output; returns an unsubscribe fn. */
  subscribeConsole(id: string, sub: ConsoleSubscriber): () => void {
    return this.getConsole(id).subscribe(sub);
  }

  /** Send input to a running instance's console (RX). */
  writeConsole(id: string, data: Uint8Array | string): void {
    this.getConsole(id).write(data);
  }

  private require(id: string): RunningInstance {
    const inst = this.instances.get(id);
    if (!inst) throw new ServiceError(`Machine instance not found: ${id}`, 404);
    return inst;
  }

  private info(i: RunningInstance): InstanceInfo {
    return {
      id: i.id,
      clientId: i.clientId,
      profileRef: i.profileRef,
      transient: i.transient,
      status: i.status,
      cpuKind: i.profile.cpuKind,
      effectiveHz: i.machine?.runner.effectiveHz,
      targetHz: i.machine?.runner.targetHz,
    };
  }
}
