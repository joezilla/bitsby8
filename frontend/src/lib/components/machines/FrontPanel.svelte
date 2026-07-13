<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { api } from '$lib/services/api';
  import { socket } from '$lib/services/socket';
  import { pageVisible } from '$lib/stores/pageVisible';
  import { showToast } from '$lib/stores/toast';
  import Icon from '$lib/components/shared/Icon.svelte';
  import type { FrontPanelState, FrontPanelAction } from '$lib/types/api';

  interface Props {
    instanceId: string;
    /** Expanded state — bindable so the cockpit can persist it per machine. */
    open?: boolean;
  }
  let { instanceId, open = $bindable(true) }: Props = $props();

  let panel = $state<FrontPanelState | null>(null);
  let switches = $state(0); // the operator's address/data register
  let base = $state<'oct' | 'hex'>('oct');

  // Server-pushed state (see websocket/handlers.ts). Filter by instanceId
  // since the socket is shared across the app.
  function handleState(msg: { instanceId: string; state: FrontPanelState }) {
    if (msg.instanceId === instanceId) panel = msg.state;
  }

  onMount(() => {
    socket.on('instance:frontpanel:state', handleState);
  });
  onDestroy(() => {
    socket.emit('instance:frontpanel:unsubscribe', { instanceId });
    socket.off('instance:frontpanel:state', handleState);
  });

  // Stream while the tab is visible. We deliberately do NOT gate on `open`:
  // the collapsed header still shows the live RUNNING/STOPPED chip, and the
  // socket-sampled panel is cheap (a CPU-register read + tiny emit, no
  // per-request HTTP/auth cost). Backgrounding the tab still pauses it.
  $effect(() => {
    if ($pageVisible) {
      socket.emit('instance:frontpanel:subscribe', { instanceId });
      return () => socket.emit('instance:frontpanel:unsubscribe', { instanceId });
    }
  });

  async function act(action: FrontPanelAction) {
    try {
      panel = await api.frontPanelAction(instanceId, action, switches);
    } catch (err) {
      showToast((err as Error).message, 'error');
    }
  }
  const toggle = (i: number) => (switches ^= 1 << i);

  const oct = $derived(base === 'oct');
  const fmt = (v: number, od: number, hd: number) =>
    oct ? (v >>> 0).toString(8).padStart(od, '0') : (v >>> 0).toString(16).toUpperCase().padStart(hd, '0');

  function led(on: boolean, sz: number): string {
    return on
      ? `width:${sz}px;height:${sz}px;box-sizing:border-box;border:1px solid transparent;border-radius:50%;background:radial-gradient(circle at 38% 32%,#ffe3a6 0%,#ffb020 46%,#e8860a 100%);box-shadow:inset 0 -2px 3px rgba(120,50,0,.5),inset 0 1px 2px rgba(255,255,255,.7)`
      : `width:${sz}px;height:${sz}px;box-sizing:border-box;border-radius:50%;background:radial-gradient(circle at 38% 32%,#39301f,#1a130a 82%);box-shadow:inset 0 1px 2px rgba(0,0,0,.75),inset 0 -1px 1px rgba(255,190,90,.06);border:1px solid rgba(0,0,0,.45)`;
  }

  // Status LEDs. The machine-cycle lamps decode the 8080 status byte latched
  // per instruction (the debug value when single-stepping); INTE/INT/RUN/WAIT
  // come from the CPU flags and the runner. WO is active-low (lit on a read).
  const S = { MEMR: 0x80, INP: 0x40, M1: 0x20, OUT: 0x10, HLTA: 0x08, STACK: 0x04, WO: 0x02 };
  const statusLeds = $derived.by(() => {
    const st = panel?.status ?? 0;
    return [
      { k: 'INTE', on: !!panel?.inte },
      { k: 'MEMR', on: !!(st & S.MEMR) },
      { k: 'INP', on: !!(st & S.INP) },
      { k: 'M1', on: !!(st & S.M1) },
      { k: 'OUT', on: !!(st & S.OUT) },
      { k: 'HLTA', on: !!(st & S.HLTA) },
      { k: 'STACK', on: !!(st & S.STACK) },
      { k: 'WO', on: !!(st & S.WO) },
      { k: 'INT', on: !!panel?.intPending },
      { k: 'RUN', on: !!panel?.running },
      { k: 'WAIT', on: !panel?.running },
    ];
  });

  // Bit columns grouped 3s (octal) / 4s (hex), from the MSB.
  const groups = $derived.by(() => {
    const addr = panel?.addr ?? 0;
    const data = panel?.data ?? 0;
    const sizes = oct ? [1, 3, 3, 3, 3, 3] : [4, 4, 4, 4];
    const out: { digit: string; bits: { i: number; sw: number; aOn: boolean; dOn: boolean; low: boolean }[] }[] = [];
    let start = 15;
    for (const size of sizes) {
      const bits = [];
      let val = 0;
      for (let k = 0; k < size; k++) {
        const i = start - k;
        const sw = (switches >> i) & 1;
        val = (val << 1) | sw;
        bits.push({ i, sw, aOn: !!((addr >> i) & 1), dOn: i < 8 && !!((data >> i) & 1), low: i < 8 });
      }
      out.push({ digit: oct ? String(val) : val.toString(16).toUpperCase(), bits });
      start -= size;
    }
    return out;
  });

  const CTRL: [FrontPanelAction, string][] = [
    ['run', 'RUN'], ['stop', 'STOP'], ['step', 'SINGLE STEP'], ['examine', 'EXAMINE'],
    ['examNext', 'EXAM NEXT'], ['deposit', 'DEPOSIT'], ['depNext', 'DEP NEXT'], ['reset', 'RESET'],
  ];
</script>

<div class="fp2" class:collapsed={!open}>
  <div class="fp2-title">
    <button class="fp2-left" onclick={() => (open = !open)}>
      <span class="chev2">▶</span>
      <span class="fp2-ic"><Icon name="developer_board" size={20} /></span> Front panel
    </button>
    <div class="fp2-right">
      <div class="fp2-seg">
        <button class:on={oct} onclick={() => (base = 'oct')}>OCT</button>
        <button class:on={!oct} onclick={() => (base = 'hex')}>HEX</button>
      </div>
      <span class="fp2-runchip" class:running={panel?.running} class:stopped={!panel?.running}>
        <span class="d"></span>{panel?.running ? 'RUNNING' : 'STOPPED'}
      </span>
    </div>
  </div>

  {#if open}
    <div class="fp2-body">
      <!-- STATUS + PC -->
      <div class="fp2-status">
        <div class="fp2-lab">STATUS</div>
        <div class="fp2-sleds">
          {#each statusLeds as s (s.k)}
            <div class="fp2-sled"><span style={led(s.on, 16)}></span><small>{s.k}</small></div>
          {/each}
        </div>
        <div class="fp2-pc"><span class="l">PC</span><span class="v">{fmt(panel?.pc ?? 0, oct ? 6 : 4, 4)}</span></div>
      </div>

      <!-- ADDRESS / DATA LEDs over SWITCHES -->
      <div class="fp2-grid">
        <div class="fp2-rail">
          <div class="r" style="height:40px;color:#8a929d">DATA</div><div style="height:6px"></div>
          <div class="r" style="height:26px;color:#8a929d">ADDR</div><div style="height:14px"></div>
          <div class="r" style="height:48px">SET</div><div style="height:18px"></div>
          <div style="height:8px"></div>
          <div class="r" style="height:32px;color:#c89858">{oct ? 'OCTAL' : 'HEX'}</div>
        </div>
        <div class="fp2-groups">
          {#each groups as g, gi (gi)}
            <div class="fp2-group">
              <div class="fp2-grow">
                {#each g.bits as b (b.i)}
                  <div class="fp2-col">
                    <div class="fp2-dcell">
                      {#if b.low}<span class="fp2-dlab">D{b.i}</span><span style={led(b.dOn, 20)}></span>{/if}
                    </div>
                    <div class="fp2-gap6"></div>
                    <div class="fp2-acell"><span style={led(b.aOn, 20)}></span></div>
                    <div class="fp2-conn"><i></i></div>
                    <div class="fp2-scell">
                      <button class="fp2-switch" onclick={() => toggle(b.i)} title="switch bit {b.i}" aria-label="switch bit {b.i}">
                        <span class="fp2-knob" style="top:{b.sw ? 3 : 21}px"></span>
                      </button>
                    </div>
                    <div class="fp2-bnum">{b.i}</div>
                  </div>
                {/each}
              </div>
              <div class="fp2-gdigit">{g.digit}</div>
            </div>
          {/each}
        </div>
        <div class="fp2-regs">
          <div class="fp2-reg"><div class="k">ADDRESS</div><div class="v">{fmt(panel?.addr ?? 0, oct ? 6 : 4, 4)}</div></div>
          <div class="fp2-reg"><div class="k">DATA</div><div class="v">{fmt(panel?.data ?? 0, oct ? 3 : 2, 2)}</div></div>
        </div>
      </div>

      <!-- CONTROL -->
      <div class="fp2-ctrl">
        <div class="fp2-lab">CONTROL</div>
        <div class="fp2-btns">
          {#each CTRL as [a, label] (a)}
            <button
              class="fp2-btn"
              class:run={a === 'run'} class:stop={a === 'stop'}
              class:on={(a === 'run' && panel?.running) || (a === 'stop' && !panel?.running)}
              onclick={() => act(a)}
            >{label}</button>
          {/each}
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .fp2 { background: linear-gradient(180deg, #1c2027 0%, #141820 100%); border: 1px solid rgba(255,255,255,.09);
    border-radius: var(--radius-lg); box-shadow: inset 0 1px 0 rgba(255,255,255,.05); overflow: hidden;
    --mono: var(--font-mono, ui-monospace, monospace); }
  .fp2-title { display: flex; align-items: center; justify-content: space-between; padding: 20px 26px 18px;
    border-bottom: 1px solid rgba(255,255,255,.07); flex-wrap: wrap; gap: 10px; }
  .fp2.collapsed .fp2-title { border-bottom: none; }
  .fp2-left { display: flex; align-items: center; gap: 11px; font-size: 17px; font-weight: 700; letter-spacing: -.01em; color: var(--fg-1);
    background: none; border: none; cursor: pointer; padding: 0; }
  .chev2 { color: var(--fg-3); font-size: 11px; transition: transform .15s ease; }
  .fp2:not(.collapsed) .chev2 { transform: rotate(90deg); }
  .fp2-ic { display: inline-flex; color: #7a828e; }
  .fp2-right { display: flex; align-items: center; gap: 12px; }
  .fp2-seg { display: flex; padding: 3px; border-radius: 9px; background: #0d0f13; border: 1px solid rgba(255,255,255,.08); }
  .fp2-seg button { padding: 5px 12px; border-radius: 6px; border: none; background: transparent; color: #6d7580;
    font-family: var(--mono); font-size: 11px; font-weight: 600; letter-spacing: .08em; cursor: pointer; }
  .fp2-seg button.on { background: rgba(255,176,32,.16); color: #ffb020; font-weight: 700; }
  .fp2-runchip { display: inline-flex; align-items: center; gap: 7px; padding: 5px 11px; border-radius: 999px;
    font-family: var(--mono); font-size: 10px; font-weight: 600; letter-spacing: .12em; }
  .fp2-runchip.stopped { background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.1); color: #9aa2ad; }
  .fp2-runchip.running { background: rgba(52,199,89,.12); border: 1px solid rgba(52,199,89,.35); color: #5ee08a; }
  .fp2-runchip .d { width: 7px; height: 7px; border-radius: 50%; }
  .fp2-runchip.stopped .d { background: #4a525d; }
  .fp2-runchip.running .d { background: #34c759; animation: fp-pulse 1.1s ease-in-out infinite; }
  @keyframes fp-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .4; } }
  .fp2-body { padding: 0 26px 26px; overflow-x: auto; }
  .fp2-lab { width: 60px; flex: none; text-align: right; font-family: var(--mono); font-size: 10px; font-weight: 600; letter-spacing: .16em; color: #6d7580; }
  .fp2-status { display: flex; align-items: flex-start; gap: 18px; padding: 22px 0 20px; border-bottom: 1px solid rgba(255,255,255,.06); }
  .fp2-status .fp2-lab { padding-top: 4px; }
  .fp2-sleds { display: flex; gap: 14px; flex-wrap: wrap; }
  .fp2-sled { display: flex; flex-direction: column; align-items: center; width: 34px; gap: 8px; }
  .fp2-sled small { font-family: var(--mono); font-size: 10px; letter-spacing: .04em; color: #7f8792; }
  .fp2-pc { margin-left: auto; display: flex; align-items: center; gap: 12px; padding-top: 2px; }
  .fp2-pc .l { font-family: var(--mono); font-size: 11px; letter-spacing: .16em; color: #6d7580; }
  .fp2-pc .v { font-family: var(--mono); font-size: 26px; font-weight: 600; letter-spacing: .06em; color: #ffb020; text-shadow: 0 0 10px rgba(255,160,30,.35); }
  .fp2-grid { display: flex; align-items: flex-start; gap: 18px; padding: 22px 0 18px; }
  .fp2-rail { width: 60px; flex: none; padding-top: 8px; display: flex; flex-direction: column; text-align: right; font-family: var(--mono); font-size: 10px; font-weight: 600; letter-spacing: .14em; color: #6d7580; }
  .fp2-rail .r { display: flex; align-items: center; justify-content: flex-end; }
  .fp2-groups { display: flex; width: 604px; justify-content: space-between; align-items: flex-start; }
  .fp2-group { display: flex; flex-direction: column; padding: 8px 6px 0; background: rgba(0,0,0,.28); border: 1px solid rgba(255,255,255,.05); border-radius: 10px; box-shadow: inset 0 1px 3px rgba(0,0,0,.5); }
  .fp2-grow { display: flex; gap: 6px; justify-content: center; }
  .fp2-col { display: flex; flex-direction: column; align-items: center; width: 28px; }
  .fp2-dcell { height: 40px; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 5px; }
  .fp2-dlab { font-family: var(--mono); font-size: 9px; color: #6d7580; }
  .fp2-gap6 { height: 6px; }
  .fp2-acell { height: 26px; display: flex; align-items: center; justify-content: center; }
  .fp2-conn { height: 14px; display: flex; justify-content: center; align-items: center; }
  .fp2-conn i { width: 0; height: 12px; border-left: 1px dashed rgba(255,255,255,.18); }
  .fp2-scell { height: 48px; display: flex; align-items: center; justify-content: center; }
  .fp2-switch { width: 26px; height: 44px; border-radius: 7px; background: linear-gradient(180deg, #0b0d11, #191d24); border: 1px solid rgba(255,255,255,.08); box-shadow: inset 0 2px 5px rgba(0,0,0,.7); position: relative; cursor: pointer; padding: 0; }
  .fp2-knob { position: absolute; left: 3px; width: 20px; height: 20px; border-radius: 5px; background: linear-gradient(180deg, #f6f2e6, #ccc4af); box-shadow: 0 2px 3px rgba(0,0,0,.5), inset 0 1px 1px rgba(255,255,255,.85); transition: top .12s cubic-bezier(.2,0,0,1); }
  .fp2-bnum { height: 18px; display: flex; align-items: center; justify-content: center; font-family: var(--mono); font-size: 11px; color: #6d7580; }
  .fp2-gdigit { margin-top: 8px; height: 32px; display: flex; align-items: center; justify-content: center; border-top: 1px solid rgba(255,255,255,.07); font-family: var(--mono); font-size: 20px; font-weight: 700; color: #ffb020; }
  .fp2-regs { margin-left: auto; display: flex; flex-direction: column; gap: 10px; flex: none; width: 122px; }
  .fp2-reg { background: #0c0e12; border: 1px solid rgba(255,255,255,.08); border-radius: 10px; padding: 11px 14px; box-shadow: inset 0 2px 6px rgba(0,0,0,.6); }
  .fp2-reg .k { font-family: var(--mono); font-size: 9px; letter-spacing: .16em; color: #6d7580; margin-bottom: 5px; }
  .fp2-reg .v { font-family: var(--mono); font-size: 24px; font-weight: 600; letter-spacing: .06em; color: #ffb020; text-shadow: 0 0 10px rgba(255,160,30,.35); }
  .fp2-ctrl { display: flex; align-items: center; gap: 18px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,.06); flex-wrap: wrap; }
  .fp2-btns { display: flex; flex-wrap: wrap; gap: 8px; }
  .fp2-btn { display: inline-flex; align-items: center; height: 42px; padding: 0 12px; border-radius: 9px; background: #171b22; border: 1px solid rgba(255,255,255,.1); color: #c4cad3; font-family: var(--mono); font-size: 11px; font-weight: 600; letter-spacing: .05em; cursor: pointer; }
  .fp2-btn:hover { background: #1e232b; border-color: rgba(255,255,255,.16); }
  .fp2-btn.run, .fp2-btn.stop { padding: 0 17px; font-weight: 700; letter-spacing: .08em; }
  .fp2-btn.run.on { background: rgba(52,199,89,.16); border-color: rgba(52,199,89,.5); color: #5ee08a; }
  .fp2-btn.stop.on { background: rgba(255,86,79,.16); border-color: rgba(255,86,79,.5); color: #ff9a95; }
</style>
