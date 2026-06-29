// FDC+ — Cassettes, Scripts, Config screens (paired here to share table styles)

/* ── CASSETTES ────────────────────────────────────────────── */
function ScreenCassettes() {
  const cassettes = [
    { name: "basic-4k-altair.wav",  size: "1.2 MB", dur: "2:14", desc: "Altair 4K BASIC — original MITS tape", playing: true },
    { name: "lunar-lander.wav",     size: "186 KB", dur: "0:18", desc: "Lunar Lander BASIC program",            playing: false },
    { name: "star-trek.wav",        size: "412 KB", dur: "0:42", desc: "Star Trek BASIC — Tholian variant",     playing: false },
    { name: "intro-music-tone.wav", size: "84 KB",  dur: "0:08", desc: "1 kHz calibration tone",                playing: false },
    { name: "memo-1979-03-12.wav",  size: "1.8 MB", dur: "3:21", desc: "Dictated memo — Q1 figures",            playing: false },
  ];

  return (
    <AppShell active="cassettes">
      <PageHeader
        eyebrow="Section · Audio Cassettes"
        title="Cassettes"
        subtitle="Stream tone-encoded programs and dictated memos to the controller."
        actions={
          <>
            <Btn variant="outline" size="sm" icon="upload">Upload .wav</Btn>
            <Btn variant="filled" size="sm" icon="graphic_eq">Record</Btn>
          </>
        }
      />

      <div style={{ padding: "0 28px 28px", display: "flex", flexDirection: "column", gap: 20, flex: 1, minHeight: 0, overflow: "auto" }}>

        {/* Now playing panel */}
        <div
          className="card"
          style={{
            padding: 20,
            display: "grid",
            gridTemplateColumns: "auto 1fr auto",
            gap: 20,
            alignItems: "center",
          }}
        >
          <div
            style={{
              width: 96,
              height: 96,
              borderRadius: "var(--radius-md)",
              background: "linear-gradient(135deg, var(--surface-variant), var(--surface-sunken))",
              border: "1px solid var(--border-1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              position: "relative",
              overflow: "hidden",
            }}
          >
            {/* faux cassette reels */}
            <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
              <Reel spin />
              <Reel spin />
            </div>
            <div
              style={{
                position: "absolute",
                bottom: 8,
                left: 8,
                right: 8,
                height: 3,
                background: "var(--bg)",
                borderRadius: 2,
                overflow: "hidden",
              }}
            >
              <div style={{ width: "62%", height: "100%", background: "var(--accent)" }} />
            </div>
          </div>

          <div>
            <div className="fdc-label-strip" style={{ marginBottom: 4 }}>Now playing · Side A</div>
            <div style={{ font: "var(--text-title-lg)", color: "var(--fg-1)" }}>basic-4k-altair.wav</div>
            <div style={{ font: "var(--text-body-sm)", color: "var(--fg-2)", marginTop: 2 }}>
              Altair 4K BASIC — original MITS tape · 300 baud Kansas City standard
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
              <span className="fdc-mono" style={{ fontSize: 12, color: "var(--fg-2)" }}>01:23</span>
              <div style={{ flex: 1, height: 4, background: "var(--surface-sunken)", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ width: "62%", height: "100%", background: "var(--accent)", boxShadow: "0 0 8px var(--accent)" }} />
              </div>
              <span className="fdc-mono" style={{ fontSize: 12, color: "var(--fg-3)" }}>02:14</span>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button className="iconbtn" style={{ width: 38, height: 38 }}><Icon name="fast_rewind" size={20} /></button>
            <button
              className="iconbtn"
              style={{
                width: 46,
                height: 46,
                borderRadius: 999,
                background: "var(--accent)",
                color: "var(--fg-on-accent)",
              }}
            >
              <Icon name="pause" size={22} />
            </button>
            <button className="iconbtn" style={{ width: 38, height: 38 }}><Icon name="fast_forward" size={20} /></button>
            <div style={{ width: 1, height: 24, background: "var(--border-1)", margin: "0 6px" }} />
            <button className="iconbtn" title="Volume"><Icon name="volume_up" size={18} /></button>
          </div>
        </div>

        {/* Library */}
        <div className="card" style={{ padding: 0 }}>
          <div style={{ display: "flex", alignItems: "center", padding: "14px 18px", borderBottom: "1px solid var(--border-1)" }}>
            <Icon name="album" size={20} style={{ color: "var(--fg-2)", marginRight: 10 }} />
            <h2 style={{ font: "var(--text-title)", margin: 0, color: "var(--fg-1)" }}>Cassette library</h2>
            <span className="fdc-label-strip" style={{ marginLeft: 12 }}>{cassettes.length} tapes</span>
          </div>

          <div>
            {cassettes.map((c, i) => (
              <div
                key={c.name}
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto minmax(220px, 2fr) 90px 80px minmax(220px, 3fr) 160px",
                  padding: "11px 18px",
                  borderBottom: i === cassettes.length - 1 ? "none" : "1px solid var(--border-1)",
                  gap: 16,
                  alignItems: "center",
                  background: c.playing ? "var(--accent-bg)" : "transparent",
                }}
              >
                <span className={cx("led", c.playing && "led-amber pulse")} />
                <span className="fdc-mono" style={{ fontSize: 13, color: "var(--fg-1)" }}>{c.name}</span>
                <span className="fdc-mono" style={{ fontSize: 12, color: "var(--fg-2)" }}>{c.size}</span>
                <span className="fdc-mono" style={{ fontSize: 12, color: "var(--fg-2)" }}>{c.dur}</span>
                <span style={{ font: "var(--text-body-sm)", color: "var(--fg-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.desc}</span>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 2 }}>
                  <button className="iconbtn"><Icon name="headphones" size={16} /></button>
                  <button className="iconbtn"><Icon name={c.playing ? "stop" : "play_arrow"} size={18} /></button>
                  <button className="iconbtn"><Icon name="edit_note" size={18} /></button>
                  <button className="iconbtn"><Icon name="delete" size={16} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function Reel({ spin }) {
  return (
    <span
      style={{
        width: 30,
        height: 30,
        borderRadius: 999,
        background: "radial-gradient(circle at center, var(--bg) 22%, var(--neutral-30) 23%, var(--neutral-30) 100%)",
        border: "1px solid var(--border-2)",
        position: "relative",
        animation: spin ? "fdc-reel 2s linear infinite" : "none",
        flexShrink: 0,
      }}
    >
      {[0, 60, 120, 180, 240, 300].map((deg) => (
        <span
          key={deg}
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            width: 9,
            height: 1.5,
            background: "var(--bg)",
            transformOrigin: "0 0",
            transform: `rotate(${deg}deg) translate(2px, -1px)`,
          }}
        />
      ))}
      <style>{`@keyframes fdc-reel { to { transform: rotate(360deg); } }`}</style>
    </span>
  );
}

/* ── SCRIPTS ──────────────────────────────────────────────── */
function ScreenScripts() {
  const scripts = [
    { name: "bootstrap-cpm.fdc",   mod: "today",       runs: 47, desc: "Mount cpm22.dsk on drive 0, reset controller, send PIP" },
    { name: "format-all.fdc",      mod: "2 days ago",  runs: 12, desc: "Format all drives to 8\" SSSD" },
    { name: "nightly-backup.fdc",  mod: "1 week ago",  runs: 184, desc: "Clone drives 0-1 to dated archive" },
    { name: "diag-readwrite.fdc",  mod: "3 weeks ago", runs: 6,  desc: "Read-write diagnostic — full surface sweep" },
  ];

  return (
    <AppShell active="scripts">
      <PageHeader
        eyebrow="Section · Automation · 4 scripts"
        title="Scripts"
        subtitle="Compose disk and serial routines, then run them on demand or on a schedule."
        actions={
          <>
            <Btn variant="outline" size="sm" icon="upload">Import</Btn>
            <Btn variant="filled" size="sm" icon="add">New script</Btn>
          </>
        }
      />

      <div style={{ padding: "0 28px 28px", display: "grid", gridTemplateColumns: "300px 1fr", gap: 20, flex: 1, minHeight: 0 }}>

        {/* script list */}
        <div className="card" style={{ padding: 0, overflow: "auto" }}>
          <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border-1)" }}>
            <span className="fdc-label-strip">My scripts</span>
          </div>
          {scripts.map((s, i) => (
            <button
              key={s.name}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                padding: "12px 14px",
                width: "100%",
                textAlign: "left",
                background: i === 0 ? "var(--accent-bg)" : "transparent",
                border: "none",
                borderBottom: i === scripts.length - 1 ? "none" : "1px solid var(--border-1)",
                borderLeft: i === 0 ? "3px solid var(--accent)" : "3px solid transparent",
                color: i === 0 ? "var(--fg-1)" : "var(--fg-2)",
                cursor: "pointer",
              }}
            >
              <span className="fdc-mono" style={{ fontSize: 13, color: i === 0 ? "var(--accent)" : "var(--fg-1)" }}>
                {s.name}
              </span>
              <span style={{ font: "var(--text-body-sm)", color: "var(--fg-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
                {s.desc}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
                <span className="fdc-label-strip" style={{ fontSize: 9 }}>{s.mod}</span>
                <span style={{ width: 2, height: 2, borderRadius: 999, background: "var(--fg-4)" }} />
                <span className="fdc-label-strip" style={{ fontSize: 9 }}>{s.runs} runs</span>
              </div>
            </button>
          ))}
        </div>

        {/* editor */}
        <div className="card" style={{ padding: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ display: "flex", alignItems: "center", padding: "10px 14px", borderBottom: "1px solid var(--border-1)", gap: 10 }}>
            <Icon name="terminal" size={18} style={{ color: "var(--accent)" }} />
            <span className="fdc-mono" style={{ fontSize: 14, color: "var(--fg-1)" }}>bootstrap-cpm.fdc</span>
            <Chip color="green">Saved</Chip>
            <div style={{ flex: 1 }} />
            <Btn variant="ghost" size="sm" icon="schedule">Schedule</Btn>
            <Btn variant="ghost" size="sm" icon="bug_report">Dry-run</Btn>
            <Btn variant="filled" size="sm" icon="play_arrow">Run</Btn>
          </div>
          <pre
            style={{
              margin: 0,
              padding: "16px 18px",
              fontFamily: "var(--font-mono)",
              fontSize: 13,
              lineHeight: 1.55,
              color: "var(--fg-1)",
              flex: 1,
              overflow: "auto",
              background: "var(--surface-sunken)",
            }}
          >
{`# Bootstrap CP/M on drive 0
# Author: rl  ·  Updated 2026-05-23

`}<span style={{ color: "var(--info)" }}>{`drive reset`}</span>{` 0
`}<span style={{ color: "var(--info)" }}>{`drive mount`}</span>{` 0 `}<span style={{ color: "var(--accent)" }}>{`"cpm22.dsk"`}</span>{` --readonly

# wait for the controller to settle before
# sending boot characters
sleep `}<span style={{ color: "var(--success)" }}>{`250ms`}</span>{`

# punch the cold-start sequence
serial send `}<span style={{ color: "var(--accent)" }}>{`"\\x00\\x00BOOT\\r\\n"`}</span>{`
serial expect `}<span style={{ color: "var(--accent)" }}>{`"A>"`}</span>{` --timeout `}<span style={{ color: "var(--success)" }}>{`5s`}</span>{`

# greet the operator
log `}<span style={{ color: "var(--accent)" }}>{`"CP/M ready on DRV-0"`}</span>{`
`}<span style={{ color: "var(--fg-3)" }}>{`# end`}</span>
          </pre>
          <div style={{ display: "flex", alignItems: "center", padding: "8px 14px", borderTop: "1px solid var(--border-1)", gap: 12 }}>
            <Led color="green" pulse />
            <span className="fdc-label-strip">Last run · 14:22:09 · Exit 0 · 1.4s</span>
            <div style={{ flex: 1 }} />
            <span className="fdc-mono" style={{ fontSize: 11, color: "var(--fg-3)" }}>17 lines · UTF-8</span>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

/* ── CONFIG ───────────────────────────────────────────────── */
function ScreenConfig() {
  return (
    <AppShell active="config">
      <PageHeader
        eyebrow="Section · System Configuration"
        title="Config"
        subtitle="Serial controller, disk serving, and operator preferences."
      />

      <div style={{ padding: "0 28px 28px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, flex: 1, minHeight: 0, overflow: "auto" }}>

        {/* Serial connection */}
        <ConfigCard title="Serial controller" icon="cable" status="Connected" statusColor="green">
          <ConfigRow label="Port">
            <span className="fdc-mono" style={{ fontSize: 13, color: "var(--fg-1)" }}>/dev/cu.usbserial-1410</span>
            <Btn variant="ghost" size="sm" icon="refresh">Refresh</Btn>
          </ConfigRow>
          <ConfigRow label="Baud rate">
            <SelectBox value="230400" />
            <span className="fdc-label-strip">Standard FDC+ rate</span>
          </ConfigRow>
          <ConfigRow label="Reconnect">
            <Toggle on />
            <span style={{ font: "var(--text-body-sm)", color: "var(--fg-2)" }}>
              Automatically re-establish on cable drop
            </span>
          </ConfigRow>
          <ConfigRow label="Verbose log">
            <Toggle />
            <span style={{ font: "var(--text-body-sm)", color: "var(--fg-2)" }}>
              Print every protocol frame
            </span>
          </ConfigRow>
        </ConfigCard>

        {/* Disk serving */}
        <ConfigCard title="Disk serving" icon="memory" status="Active" statusColor="green">
          <ConfigRow label="Enabled">
            <Toggle on />
            <span style={{ font: "var(--text-body-sm)", color: "var(--fg-2)" }}>
              Serve mounted images to the Altair
            </span>
          </ConfigRow>
          <ConfigRow label="Sector size">
            <SelectBox value="128 bytes" />
          </ConfigRow>
          <ConfigRow label="Write protect">
            <Toggle />
            <span style={{ font: "var(--text-body-sm)", color: "var(--fg-2)" }}>
              Refuse all write commands
            </span>
          </ConfigRow>
          <ConfigRow label="Activity LED">
            <SelectBox value="Per-drive" />
          </ConfigRow>
        </ConfigCard>

        {/* Terminal preferences */}
        <ConfigCard title="Terminal preferences" icon="monitor" status="VT102" statusColor="cyan">
          <ConfigRow label="Default port">
            <SelectBox value="/dev/cu.usbserial-1410" />
          </ConfigRow>
          <ConfigRow label="Default baud">
            <SelectBox value="9600" />
          </ConfigRow>
          <ConfigRow label="CRT mode">
            <SelectBox value="Modern" />
            <span className="fdc-label-strip">Phosphor amber · green available</span>
          </ConfigRow>
          <ConfigRow label="Echo">
            <Toggle on />
          </ConfigRow>
        </ConfigCard>

        {/* Operator */}
        <ConfigCard title="Operator" icon="badge" status="rl" statusColor="amber">
          <ConfigRow label="Theme">
            <ThemeChoice />
          </ConfigRow>
          <ConfigRow label="Density">
            <SelectBox value="Comfortable" />
          </ConfigRow>
          <ConfigRow label="Sounds">
            <Toggle />
            <span style={{ font: "var(--text-body-sm)", color: "var(--fg-2)" }}>
              Soft mechanical clicks on disk mount
            </span>
          </ConfigRow>
          <ConfigRow label="Data folder">
            <span className="fdc-mono" style={{ fontSize: 12, color: "var(--fg-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              ~/Library/Application Support/FDC+
            </span>
            <Btn variant="ghost" size="sm" icon="folder_open">Reveal</Btn>
          </ConfigRow>
        </ConfigCard>
      </div>
    </AppShell>
  );
}

function ConfigCard({ title, icon, status, statusColor, children }) {
  return (
    <div className="card" style={{ padding: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", padding: "14px 18px", borderBottom: "1px solid var(--border-1)" }}>
        <Icon name={icon} size={20} style={{ color: "var(--fg-2)", marginRight: 10 }} />
        <h2 style={{ font: "var(--text-title)", margin: 0, color: "var(--fg-1)" }}>{title}</h2>
        <div style={{ flex: 1 }} />
        <Chip color={statusColor}>{status}</Chip>
      </div>
      <div style={{ padding: "8px 18px 18px", display: "flex", flexDirection: "column" }}>
        {children}
      </div>
    </div>
  );
}

function ConfigRow({ label, children }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "140px 1fr",
        gap: 16,
        alignItems: "center",
        padding: "10px 0",
        borderBottom: "1px solid var(--border-1)",
      }}
    >
      <span className="fdc-label-strip">{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>{children}</div>
    </div>
  );
}

function Toggle({ on }) {
  return (
    <span
      style={{
        position: "relative",
        display: "inline-flex",
        width: 36,
        height: 20,
        borderRadius: 999,
        background: on ? "var(--accent)" : "var(--surface-sunken)",
        border: "1px solid",
        borderColor: on ? "var(--accent)" : "var(--border-2)",
        transition: "all 180ms",
        boxShadow: on ? "0 0 8px rgba(255,176,32,0.35)" : "none",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 1,
          left: on ? 16 : 1,
          width: 16,
          height: 16,
          borderRadius: 999,
          background: on ? "var(--fg-on-accent)" : "var(--neutral-70)",
          transition: "left 180ms",
        }}
      />
    </span>
  );
}

function SelectBox({ value }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        height: 32,
        padding: "0 10px 0 12px",
        background: "var(--surface-sunken)",
        border: "1px solid var(--border-1)",
        borderRadius: "var(--radius-sm)",
        font: "13px/1 var(--font-mono)",
        color: "var(--fg-1)",
        minWidth: 180,
      }}
    >
      <span style={{ flex: 1 }}>{value}</span>
      <Icon name="expand_more" size={16} style={{ color: "var(--fg-3)" }} />
    </span>
  );
}

function ThemeChoice() {
  return (
    <div
      style={{
        display: "inline-flex",
        padding: 3,
        borderRadius: 999,
        background: "var(--surface-sunken)",
        border: "1px solid var(--border-1)",
        gap: 2,
      }}
    >
      {[
        { id: "light", icon: "light_mode", label: "Light" },
        { id: "dark",  icon: "dark_mode",  label: "Dark",  active: true },
        { id: "auto",  icon: "contrast",   label: "Auto" },
      ].map((o) => (
        <span
          key={o.id}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 10px",
            borderRadius: 999,
            font: "12px/1 var(--font-sans)",
            background: o.active ? "var(--surface)" : "transparent",
            color: o.active ? "var(--fg-1)" : "var(--fg-3)",
            boxShadow: o.active ? "var(--elev-1)" : "none",
          }}
        >
          <Icon name={o.icon} size={14} />
          {o.label}
        </span>
      ))}
    </div>
  );
}

window.ScreenCassettes = ScreenCassettes;
window.ScreenScripts = ScreenScripts;
window.ScreenConfig = ScreenConfig;
