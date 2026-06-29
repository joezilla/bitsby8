// FDC+ — Foundations card: tokens, type, components at a glance.

function ScreenFoundations() {
  return (
    <div
      className="fdc-root"
      style={{
        width: "100%",
        height: "100%",
        padding: 28,
        overflow: "auto",
        display: "grid",
        gridTemplateColumns: "1.1fr 1fr 1fr",
        gridTemplateRows: "auto auto auto",
        gap: 20,
        background: "var(--bg)",
      }}
    >
      {/* Wordmark + tagline */}
      <div
        style={{
          gridColumn: "1 / -1",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "20px 24px",
          background: "var(--surface)",
          border: "1px solid var(--border-1)",
          borderRadius: "var(--radius-lg)",
        }}
      >
        <div>
          <div className="fdc-label-strip" style={{ marginBottom: 6 }}>FDC+ design system · v1.0 · Cool slate</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontWeight: 600,
                fontSize: 48,
                letterSpacing: "0.02em",
                color: "var(--fg-1)",
                lineHeight: 1,
              }}
            >
              FDC<span style={{ color: "var(--accent)" }}>+</span>
            </span>
            <span style={{ font: "var(--text-body-lg)", color: "var(--fg-2)", maxWidth: 520 }}>
              A modern operator's console for the Altair 8800 — confident
              monochrome chrome, glowing signal pips, quiet vintage cues.
            </span>
          </div>
        </div>

        {/* small wordmark variants */}
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <Led color="amber" pulse md />
          <Led color="green" md />
          <Led color="cyan" md />
          <Led color="red" md />
          <Led color="off" md />
        </div>
      </div>

      {/* Colors */}
      <section className="card" style={{ padding: 18 }}>
        <SectionTitle>Colors</SectionTitle>
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 14 }}>
          <SwatchRow label="Surfaces" swatches={[
            { name: "bg",              token: "--bg" },
            { name: "surface-sunken",  token: "--surface-sunken" },
            { name: "surface",         token: "--surface" },
            { name: "surface-raised",  token: "--surface-raised" },
            { name: "surface-variant", token: "--surface-variant" },
          ]} />
          <SwatchRow label="Foreground" swatches={[
            { name: "fg-1", token: "--fg-1" },
            { name: "fg-2", token: "--fg-2" },
            { name: "fg-3", token: "--fg-3" },
            { name: "fg-4", token: "--fg-4" },
          ]} />
          <SwatchRow label="Signal" swatches={[
            { name: "accent",  token: "--accent",  glow: true },
            { name: "success", token: "--success", glow: true },
            { name: "info",    token: "--info",    glow: true },
            { name: "error",   token: "--error",   glow: true },
          ]} />
        </div>
      </section>

      {/* Type */}
      <section className="card" style={{ padding: 18 }}>
        <SectionTitle>Type</SectionTitle>
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <div className="fdc-label-strip">Display · Geist 500</div>
            <div style={{ font: "var(--text-display)", color: "var(--fg-1)", marginTop: 2 }}>
              Tend your archive
            </div>
          </div>
          <div>
            <div className="fdc-label-strip">Title · Geist 500</div>
            <div style={{ font: "var(--text-title-lg)", color: "var(--fg-1)", marginTop: 2 }}>
              Disk image library
            </div>
          </div>
          <div>
            <div className="fdc-label-strip">Body · Geist 400</div>
            <div style={{ font: "var(--text-body)", color: "var(--fg-2)", marginTop: 2 }}>
              Mount up to four virtual floppies on the FDC+ controller.
            </div>
          </div>
          <div>
            <div className="fdc-label-strip">Data · IBM Plex Mono</div>
            <div className="fdc-mono" style={{ fontSize: 14, color: "var(--fg-1)", marginTop: 2 }}>
              TRK 12 · SEC 04 · 248 KB · /dev/cu.usbserial-1410
            </div>
          </div>
          <div>
            <div className="fdc-label-strip">Label strip · Plex Mono 600, 0.18em</div>
            <div className="fdc-label-strip" style={{ marginTop: 2 }}>
              DRIVE 00 · MOUNTED · READING · TRACK 12
            </div>
          </div>
        </div>
      </section>

      {/* LED system */}
      <section className="card" style={{ padding: 18 }}>
        <SectionTitle>Signal pips</SectionTitle>
        <p style={{ font: "var(--text-body-sm)", color: "var(--fg-2)", marginTop: 8 }}>
          LED-style indicators with a soft phosphor halo. Used in the topbar
          status panel, drive cards, and inline next to system data.
        </p>
        <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "auto 1fr", rowGap: 12, columnGap: 16, alignItems: "center" }}>
          <Led color="amber" md /><span style={{ font: "var(--text-body-sm)", color: "var(--fg-2)" }}><b style={{ color: "var(--fg-1)" }}>Amber</b> — drive active / head loaded</span>
          <Led color="green" md /><span style={{ font: "var(--text-body-sm)", color: "var(--fg-2)" }}><b style={{ color: "var(--fg-1)" }}>Green</b> — mounted / healthy / online</span>
          <Led color="cyan"  md /><span style={{ font: "var(--text-body-sm)", color: "var(--fg-2)" }}><b style={{ color: "var(--fg-1)" }}>Cyan</b> — serial connected / data flow</span>
          <Led color="red"   md /><span style={{ font: "var(--text-body-sm)", color: "var(--fg-2)" }}><b style={{ color: "var(--fg-1)" }}>Red</b> — disconnected / error</span>
          <Led color="off"   md /><span style={{ font: "var(--text-body-sm)", color: "var(--fg-2)" }}><b style={{ color: "var(--fg-1)" }}>Off</b> — drive empty / inactive</span>
          <Led color="amber" md pulse /><span style={{ font: "var(--text-body-sm)", color: "var(--fg-2)" }}><b style={{ color: "var(--fg-1)" }}>Pulse</b> — recent activity / reading</span>
        </div>
      </section>

      {/* Buttons + chips */}
      <section className="card" style={{ padding: 18 }}>
        <SectionTitle>Buttons & chips</SectionTitle>
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="fdc-label-strip">Filled · Tonal · Outline · Ghost · Danger</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Btn variant="filled"  size="sm" icon="play_arrow">Run</Btn>
            <Btn variant="tonal"   size="sm" icon="save">Mount…</Btn>
            <Btn variant="outline" size="sm" icon="upload">Upload</Btn>
            <Btn variant="ghost"   size="sm" icon="refresh">Refresh</Btn>
            <Btn variant="ghost"   size="sm" icon="delete" danger>Delete</Btn>
          </div>

          <div className="fdc-label-strip">Status chips</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Chip color="amber">Reading</Chip>
            <Chip color="green">Mounted</Chip>
            <Chip color="cyan">Serial · 9600</Chip>
            <Chip color="red">Disconnected</Chip>
            <Chip>RO</Chip>
            <Chip>8" SSSD</Chip>
          </div>

          <div className="fdc-label-strip">Icon buttons</div>
          <div style={{ display: "flex", gap: 4 }}>
            <button className="iconbtn"><Icon name="save" size={18} /></button>
            <button className="iconbtn"><Icon name="content_copy" size={16} /></button>
            <button className="iconbtn"><Icon name="edit_note" size={18} /></button>
            <button className="iconbtn"><Icon name="delete" size={16} /></button>
            <button className="iconbtn on"><Icon name="dark_mode" size={18} /></button>
          </div>
        </div>
      </section>

      {/* Inputs + label strip */}
      <section className="card" style={{ padding: 18 }}>
        <SectionTitle>Inputs</SectionTitle>
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <div className="fdc-label-strip" style={{ marginBottom: 6 }}>Text field</div>
            <input className="input" defaultValue="cpm22.dsk" />
          </div>
          <div>
            <div className="fdc-label-strip" style={{ marginBottom: 6 }}>Select (mono)</div>
            <span
              style={{
                display: "inline-flex",
                width: "100%",
                alignItems: "center",
                height: 36,
                padding: "0 12px",
                background: "var(--surface-sunken)",
                border: "1px solid var(--border-2)",
                borderRadius: "var(--radius-sm)",
                font: "13px/1 var(--font-mono)",
                color: "var(--fg-1)",
              }}
            >
              <span style={{ flex: 1 }}>230400 baud</span>
              <Icon name="expand_more" size={16} style={{ color: "var(--fg-3)" }} />
            </span>
          </div>
          <div>
            <div className="fdc-label-strip" style={{ marginBottom: 6 }}>Search</div>
            <span
              style={{
                display: "inline-flex",
                width: "100%",
                alignItems: "center",
                gap: 8,
                padding: "0 14px",
                height: 36,
                borderRadius: 999,
                background: "var(--surface-sunken)",
                border: "1px solid var(--border-1)",
              }}
            >
              <Icon name="search" size={16} style={{ color: "var(--fg-3)" }} />
              <span style={{ font: "var(--text-body-sm)", color: "var(--fg-3)" }}>Filter images…</span>
            </span>
          </div>
        </div>
      </section>

      {/* Altair label strip motif */}
      <section className="card" style={{ padding: 18 }}>
        <SectionTitle>Altair label strip</SectionTitle>
        <p style={{ font: "var(--text-body-sm)", color: "var(--fg-2)", marginTop: 8 }}>
          A subtle silk-screen legend — the system's one direct vintage cue.
          Used to label nav sections, drive bays, and form fieldsets.
        </p>
        <div
          style={{
            marginTop: 14,
            padding: "10px 14px",
            background: "linear-gradient(180deg, var(--surface-variant), color-mix(in oklab, var(--surface-variant) 70%, var(--bg)))",
            border: "1px solid var(--border-1)",
            borderRadius: "var(--radius-sm)",
            display: "flex",
            gap: 18,
          }}
        >
          <span className="fdc-label-strip">FDC+</span>
          <span className="fdc-label-strip" style={{ opacity: 0.6 }}>Floppy Disk Controller</span>
          <span className="fdc-label-strip" style={{ opacity: 0.6 }}>Mits Altair 8800</span>
          <span className="fdc-label-strip" style={{ opacity: 0.4 }}>· Type 88-FDC ·</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginTop: 14 }}>
          {["PWR", "RUN", "READ", "WRITE"].map((label, i) => (
            <div
              key={label}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6,
                padding: "12px 0 8px",
                background: "var(--surface-sunken)",
                border: "1px solid var(--border-1)",
                borderRadius: "var(--radius-sm)",
              }}
            >
              <span className={cx("led", "led-md", i === 0 ? "led-green" : i === 1 ? "led-amber pulse" : i === 2 ? "led-amber" : "led-off")} />
              <span className="fdc-label-strip">{label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Toasts */}
      <section className="card" style={{ padding: 18, gridColumn: "1 / -1" }}>
        <SectionTitle>Toasts</SectionTitle>
        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          <Toast kind="success" title="Mounted cpm22.dsk on DRV-0" body="Sector size 128 · read-write" />
          <Toast kind="info"    title="Listening on /dev/cu.usbserial-1410" body="9600 8N1 · VT102" />
          <Toast kind="warning" title="Write protected" body="DRV-1 is currently read-only" />
          <Toast kind="error"   title="Serial port unavailable" body="Device disconnected" />
        </div>
      </section>
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 999, background: "var(--accent)", boxShadow: "var(--led-halo-amber)" }} />
      <span className="fdc-overline" style={{ color: "var(--fg-1)" }}>{children}</span>
    </div>
  );
}

function SwatchRow({ label, swatches }) {
  return (
    <div>
      <div className="fdc-label-strip" style={{ marginBottom: 6 }}>{label}</div>
      <div style={{ display: "flex", gap: 6 }}>
        {swatches.map((s) => (
          <div key={s.name} style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                height: 44,
                borderRadius: 8,
                background: `var(${s.token})`,
                border: "1px solid var(--border-1)",
                boxShadow: s.glow ? `0 0 0 1px var(${s.token})` : "none",
              }}
            />
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-2)", marginTop: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {s.name}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

window.ScreenFoundations = ScreenFoundations;
